/* ============ net.js — conexión entre los jugadores de una sala ============
 * Topología en estrella: el ANFITRIÓN habla con cada invitado; los invitados
 * sólo hablan con el anfitrión (él reenvía lo que haga falta).
 *
 * Dos caminos, a la vez:
 *   directo  WebRTC (canal de datos entre navegadores), con STUN gratuito de
 *            Google. La negociación y la señalización van por la base de datos.
 *   relé     Realtime Database sólo si falla el canal directo, con topes de
 *            frecuencia y tamaño para limitar lecturas, escrituras y tráfico.
 *
 * Se envía por el canal directo si está abierto; si no, por el relé. El que
 * recibe escucha los dos, así que no hace falta ponerse de acuerdo.
 *
 * API:  open(roomId, isHost, hostUid) · close() · send(to, msg) · toHost(msg)
 *       broadcast(msg) · on(fn(from, msg)) · onPeer(fn(uid, state))
 *       peers() · mode(uid) -> 'connecting' | 'direct' | 'relay' | 'closed'
 */
G.Net = (() => {
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const DIRECT_TIMEOUT = 9000;          // ms para conseguir canal
  const ALLOW_RELAY = true, RETRY_MS = 15000;
  const RELAY_MAX_BYTES = 12000, RELAY_MAX_BYTES_PER_SECOND = 24000, RELAY_MAX_FRAMES_PER_SECOND = 3;
  const ICE_BATCH = 250, ICE_MAX = 40;    // candidatos: se juntan 250 ms (o 40) en un mensaje (ver newPeer)


  let rtdb = null, uid = null, roomId = null, isHost = false, hostUid = null;
  let qref = null;
  const peers = new Map();         // uid -> { pc, dc, mode, timer }
  const handlers = new Set(), peerHandlers = new Set();
  const stats = { sent: 0, recv: 0, relaySent: 0,
    sentBytes: 0, jsonBytes: 0, recvBytes: 0, binarySent: 0, binaryRecv: 0, invalidBinary: 0,
    relayBytes: 0, relayDropped: 0, relayOversize: 0 };
  const relayUsage = new Map();
  const pendingEvents = new Map();
  const received = new Map();

  function emitPeer(u) {
    const p = peers.get(u);
    peerHandlers.forEach(fn => { try { fn(u, p ? p.mode : 'closed'); } catch (e) { console.warn(e); } });
  }

  // ---------------- apertura ----------------

  function open(id, host, hostId) {
    if (roomId === id) return;
    close();
    const fb = G.DB.fb;
    rtdb = fb.rtdb; uid = fb.uid;
    roomId = id; isHost = host; hostUid = hostId;
    qref = rtdb.ref('rooms/' + id + '/q/' + uid);
    const receive = s => {
      const raw = s.val();
      const key = s.key || '';
      if (received.get(key) === raw) return;
      received.set(key, raw);
      let m;
      try { m = JSON.parse(raw); } catch (e) { s.ref.remove().catch(err => console.warn('[Net] borrar mensaje:', err.code || err.message)); return; }
      s.ref.remove().then(() => { if (received.get(key) === raw) received.delete(key); })
        .catch(e => console.warn('[Net] borrar mensaje:', e.code || e.message));
      if (!m || !m.f || (m.ts && Date.now() - m.ts > 15000)) return;
      if (m.sig) onSignal(m.f, m.sig);
      else deliver(m.f, m.d);
    };
    qref.on('child_added', receive);
    qref.on('child_changed', receive);
    // Invitado: hueco para el anfitrión desde ya (se sustituye al llegar su
    // oferta). Así, si no llega nunca, se sigue por el relé y se sabe cuándo se va.
    if (!isHost) {
      const p = { pc: null, dc: null, mode: 'connecting', timer: 0 };
      p.timer = setTimeout(() => { if (p.mode === 'connecting') { p.mode = ALLOW_RELAY ? 'relay' : 'failed'; emitPeer(hostId); } }, DIRECT_TIMEOUT + 3000);
      peers.set(hostId, p);
    }
  }

  function close() {
    for (const u of [...peers.keys()]) drop(u);
    if (qref) { qref.off(); qref = null; }
    received.clear(); relayUsage.clear(); pendingEvents.clear();
    relayWarnings.clear();
    roomId = null; isHost = false; hostUid = null;
  }

  /** El anfitrión llama a esto cuando cambian los miembros de la sala. */
  function syncMembers(uids) {
    if (!roomId) return;
    if (isHost) {
      for (const u of uids) if (u !== uid && !peers.has(u)) connect(u);
      for (const u of [...peers.keys()]) if (!uids.includes(u)) drop(u);
    } else if (!uids.includes(hostUid)) {
      drop(hostUid);
    }
  }

  // ---------------- WebRTC ----------------

  function newPeer(u) {
    const p = { pc: null, dc: null, mode: 'connecting', timer: 0 };
    peers.set(u, p);
    // Sin WebRTC (navegador antiguo o bloqueado): directamente por el relé.
    let pc;
    try { pc = p.pc = new RTCPeerConnection({ iceServers: ICE }); }
    catch (e) { p.mode = 'relay'; emitPeer(u); return p; }
    /*
     * Los candidatos de conexión se juntan ICE_BATCH ms y van en un solo mensaje
     * ({ cs: [...] }), y en cuanto no hay más (candidate null), al momento.
     * Antes iba uno por mensaje: unos 4.000 por minuto por la base de datos
     * (25-10-2026), lo que más se descargaba de ella. Quien recibe entiende los
     * dos (las versiones de antes mandan { c }).
     */
    const iceOut = [];
    let iceT = 0;
    const flushIce = () => { clearTimeout(iceT); iceT = 0; if (iceOut.length && peers.get(u) === p) signal(u, { cs: iceOut.splice(0) }); };
    pc.onicecandidate = e => {
      if (!e.candidate) { flushIce(); return; }
      iceOut.push(e.candidate.toJSON());
      if (iceOut.length >= ICE_MAX) flushIce();
      else if (!iceT) iceT = setTimeout(flushIce, ICE_BATCH);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && p.mode !== 'closed') {
        if (p.mode === 'direct') p.mode = 'connecting';
        useRelay(u);
      }
    };
    // Si en unos segundos no hay canal directo, se sigue por el relé.
    p.timer = setTimeout(() => { if (p.mode === 'connecting') useRelay(u); }, DIRECT_TIMEOUT);
    emitPeer(u);
    return p;
  }

  function wireChannel(u, p, dc) {
    p.dc = dc;
    p.binaryVersion = 0;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      clearTimeout(p.timer); p.mode = 'direct';
      // Aviso de que entendemos binario (las versiones viejas lo ignoran); hasta que el otro
      // mande el suyo, se le habla en JSON.
      try { dc.send(JSON.stringify({ k: 'net-cap', binary: G.NetCodec.version })); } catch (e) { /* el JSON sigue valiendo */ }
      emitPeer(u);
    };
    dc.onclose = () => { if (p.mode === 'direct') { p.mode = 'connecting'; useRelay(u); } };
    dc.onmessage = e => {
      let m;
      if (typeof e.data === 'string') {
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m && m.k === 'net-cap') {
          p.binaryVersion = m.binary === G.NetCodec.version ? m.binary : 0;
          return;
        }
        stats.recvBytes += G.NetCodec.size(e.data);
      } else {
        try {
          if (p.binaryVersion !== G.NetCodec.version) throw Error('unnegotiated binary');
          m = G.NetCodec.decode(e.data);
          if (!m || m.k !== 'f') throw Error('not a frame');
        } catch (err) { stats.invalidBinary++; return; }
        stats.recvBytes += e.data.byteLength; stats.binaryRecv++;
      }
      deliver(u, m);
    };
  }

  function useRelay(u) {
    const p = peers.get(u);
    if (!p || p.mode === 'direct' || p.mode === 'closed' || p.mode === 'failed') return;
    clearTimeout(p.timer);
    p.mode = ALLOW_RELAY ? 'relay' : 'failed';
    try { if (p.dc) p.dc.close(); } catch (e) { /* nada */ }
    try { if (p.pc) p.pc.close(); } catch (e) { /* nada */ }
    emitPeer(u);
    if (ALLOW_RELAY) return;
    if (!isHost) return;
    p.timer = setTimeout(() => { if (peers.get(u) === p && p.mode === 'failed' && roomId) { drop(u, true); connect(u); } }, RETRY_MS);
  }

  /** Anfitrión: abre conexión con un invitado. */
  async function connect(u) {
    if (!roomId || peers.has(u)) return;
    const p = newPeer(u);
    if (!p.pc) return;
    wireChannel(u, p, p.pc.createDataChannel('g', { ordered: true }));
    try {
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      signal(u, { sdp: p.pc.localDescription.toJSON() });
    } catch (e) { useRelay(u); }
  }

  const pendingIce = new Map();     // candidatos que llegan antes que la oferta

  async function onSignal(from, sig) {
    let p = peers.get(from);
    try {
      if (sig.sdp && sig.sdp.type === 'offer') {
        if (isHost) return;
        if (p) drop(from, true);
        p = newPeer(from);
        if (!p.pc) return;
        p.pc.ondatachannel = e => wireChannel(from, p, e.channel);
        await p.pc.setRemoteDescription(sig.sdp);
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        signal(from, { sdp: p.pc.localDescription.toJSON() });
        for (const c of pendingIce.get(from) || []) await p.pc.addIceCandidate(c).catch(() => {});
        pendingIce.delete(from);
      } else if (sig.sdp && sig.sdp.type === 'answer') {
        if (p && p.pc) await p.pc.setRemoteDescription(sig.sdp);
      } else if (sig.c || Array.isArray(sig.cs)) {
        for (const c of sig.cs || [sig.c]) {
          if (p && p.pc && p.pc.remoteDescription) await p.pc.addIceCandidate(c).catch(() => {});
          else { if (!pendingIce.has(from)) pendingIce.set(from, []); pendingIce.get(from).push(c); }
        }
      }
    } catch (e) {
      console.warn('[Net] señalización:', e.message);
      useRelay(from);
    }
  }

  function signal(to, sig) { relayPush(to, { f: uid, sig }); }

  function drop(u, silent) {
    const p = peers.get(u);
    if (!p) return;
    clearTimeout(p.timer);
    p.mode = 'closed';
    try { if (p.dc) p.dc.close(); } catch (e) { /* nada */ }
    try { if (p.pc) p.pc.close(); } catch (e) { /* nada */ }
    peers.delete(u);
    if (!silent) emitPeer(u);
  }

  // ---------------- envío / recepción ----------------

  /*
   * Cada remitente tiene 100 huecos por destinatario (tuUid_00 ... tuUid_99) y
   * los va usando en orden; quien recibe borra cada mensaje al leerlo. Antes cada
   * mensaje era nuevo (push) y sin tope de tamaño, y el 23-10-2026 se llenó la
   * base de datos de basura (ver social.js, createRoom). Las reglas
   * (database.rules.json) sólo admiten estos huecos y mensajes de hasta 16.000.
   */
  let slot = Math.floor(Math.random() * 100);
  const relayWarnings = new Set();
  const MAX_PENDING_EVENTS = 512, MAX_PENDING_EVENT_BYTES = 8000;

  function reportRelayLimit(to, message) {
    if (relayWarnings.has(to)) return;
    relayWarnings.add(to);
    console.warn('[Net] relé: ' + message);
  }

  function relayPush(to, env, msg) {
    if (!rtdb || !roomId) return false;
    let raw;
    try { raw = JSON.stringify({ ...env, ts: Date.now() }); }
    catch (e) { console.warn('[Net] relé: mensaje no serializable', e); return false; }
    const bytes = G.NetCodec.size(raw);
    if (raw.length > 16000 || bytes > 16000) {
      stats.relayOversize++;
      reportRelayLimit(to, 'mensaje supera el límite de tamaño');
      return false;
    }
    if (msg && msg.k === 'f') {
      const now = Date.now();
      let use = relayUsage.get(to);
      if (!use || now - use.start >= 1000) use = { start: now, frames: 0, bytes: 0 };
      const frameBytes = G.NetCodec.size(JSON.stringify(msg));
      if (frameBytes > RELAY_MAX_BYTES) {
        stats.relayOversize++;
        stats.relayDropped++;
        reportRelayLimit(to, 'frame supera los 12 KB y no se envió');
        return false;
      }
      if (use.frames >= RELAY_MAX_FRAMES_PER_SECOND ||
          use.bytes + frameBytes > RELAY_MAX_BYTES_PER_SECOND) {
        relayUsage.set(to, use);
        stats.relayDropped++;
        reportRelayLimit(to, 'límite de frecuencia o tráfico alcanzado');
        return false;
      }
      use.frames++;
      use.bytes += frameBytes;
      relayUsage.set(to, use);
    }
    const key = uid + '_' + String(slot++ % 100).padStart(2, '0');
    rtdb.ref('rooms/' + roomId + '/q/' + to + '/' + key).set(raw).catch(e => console.warn('[Net] relé:', e.code || e.message));
    stats.relaySent++;
    stats.relayBytes += bytes;
    return true;
  }

  function send(to, msg) {
    if (!roomId) return;
    const p = peers.get(to);
    stats.sent++;
    const pending = pendingEvents.get(to);
    const outgoing = msg && msg.k === 'f' && pending && pending.length
      ? { ...msg, ev: pending.concat(Array.isArray(msg.ev) ? msg.ev : []) }
      : msg;
    if (p && p.mode === 'direct' && p.dc && p.dc.readyState === 'open') {
      try {
        const json = JSON.stringify(outgoing), jsonBytes = G.NetCodec.size(json);
        const packed = p.binaryVersion === G.NetCodec.version && outgoing && outgoing.k === 'f'
          ? G.NetCodec.encode(outgoing) : null;
        const binary = packed && packed.byteLength < jsonBytes;
        p.dc.send(binary ? packed : json);
        stats.sentBytes += binary ? packed.byteLength : jsonBytes;
        stats.jsonBytes += jsonBytes;
        if (binary) stats.binarySent++;
        if (outgoing && outgoing.k === 'f') pendingEvents.delete(to);
        return;
      } catch (e) {
        p.mode = 'connecting';
        useRelay(to);
      }
    }
    if (!ALLOW_RELAY && !(outgoing && outgoing.k === 'start')) return;
    if (relayPush(to, { f: uid, d: outgoing }, outgoing)) {
      if (outgoing && outgoing.k === 'f') pendingEvents.delete(to);
      return;
    }
    if (outgoing && outgoing.k === 'f' && Array.isArray(outgoing.ev) && outgoing.ev.length) {
      const rawEvents = JSON.stringify(outgoing.ev);
      if (outgoing.ev.length <= MAX_PENDING_EVENTS && G.NetCodec.size(rawEvents) <= MAX_PENDING_EVENT_BYTES) {
        pendingEvents.set(to, outgoing.ev.slice());
      } else {
        reportRelayLimit(to, 'eventos pendientes exceden el límite de cola');
      }
    }
  }

  function toHost(msg) { if (!isHost && hostUid) send(hostUid, msg); }
  function broadcast(msg, except) { for (const u of peers.keys()) if (u !== except) send(u, msg); }

  function deliver(from, msg) {
    stats.recv++;
    handlers.forEach(fn => { try { fn(from, msg); } catch (e) { console.error('[Net] mensaje:', e); } });
  }

  return {
    open, close, syncMembers, send, toHost, broadcast,
    on(fn) { handlers.add(fn); }, off(fn) { handlers.delete(fn); },
    onPeer(fn) { peerHandlers.add(fn); },
    mode(u) { const p = peers.get(u); return p ? p.mode : 'closed'; },
    ready(u) {
      const p = peers.get(u);
      if (p && ALLOW_RELAY && p.mode === 'relay') return true;
      return !!(p && p.mode === 'direct' && p.dc && p.dc.readyState === 'open' &&
        (!p.pc || (p.pc.connectionState !== 'failed' && p.pc.connectionState !== 'closed')));
    },
    viaRelay(u) { const p = peers.get(u); return !!(p && p.mode === 'relay'); },
    /** ¿Va por el relé (o no hay conexión)? Entonces se manda menos a menudo. */
    slow(u) { const p = peers.get(u); return !p || p.mode !== 'direct'; },
    peers() { return [...peers.keys()]; },
    get open_() { return !!roomId; },
    get isHost() { return isHost; },
    get uid() { return uid; },
    get hostUid() { return hostUid; },
    stats
  };
})();
