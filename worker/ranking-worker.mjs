const API = 'https://firestore.googleapis.com/v1';
const AUTH_LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const OAUTH = 'https://oauth2.googleapis.com/token';
const ALLOWED_ORIGINS = new Set([
  'https://pokesurvivor.com',
  'https://www.pokesurvivor.com',
  'https://devhoa.github.io'
]);
const TOP = 50;
const TOP_ONLY = new Set(['d', 'w', 'm', 'p']);
const PERIODS = ['d', 'w', 'm', 'a'];
const ALL = 'all4';

let accessToken = null;
let tokenExpires = 0;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
});

function cors(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

function b64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function pemBytes(pem) {
  const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  return fromBase64(body);
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(value)));
  return [...signature].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function verifySeal(secret, uid, seal, now, runTime) {
  if (!seal || !Number.isSafeInteger(seal.s) || !/^[0-9a-f]{64}$/.test(seal.g || '')) return false;
  const elapsed = now - seal.s;
  if (elapsed < 0 || elapsed > 48 * 3600_000 || elapsed + 30_000 < runTime * 1000) return false;
  const expected = await hmac(secret, `${uid}:${seal.s}`);
  const expectedBytes = fromHex(expected), actualBytes = fromHex(seal.g);
  let difference = 0;
  for (let i = 0; i < expectedBytes.length; i++) difference |= expectedBytes[i] ^ actualBytes[i];
  return difference === 0;
}

function fromHex(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function authenticatedUid(request, env) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  if (!match) throw new HttpError(401, 'missing-token');
  const response = await fetch(`${AUTH_LOOKUP}?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: match[1] })
  });
  if (!response.ok) throw new HttpError(401, 'invalid-token');
  const result = await response.json();
  const user = result.users && result.users[0];
  if (!user || !user.localId || user.disabled) throw new HttpError(401, 'invalid-account');
  return user.localId;
}

async function googleToken(env) {
  if (accessToken && Date.now() < tokenExpires - 60_000) return accessToken;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64url(utf8(JSON.stringify({
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: OAUTH,
    iat: now,
    exp: now + 3600
  })));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(env.GOOGLE_PRIVATE_KEY), {
    name: 'RSASSA-PKCS1-v1_5',
    hash: 'SHA-256'
  }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(unsigned)));
  const assertion = `${unsigned}.${b64url(signature)}`;
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });
  const response = await fetch(OAUTH, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form
  });
  if (!response.ok) throw new Error(`Google OAuth failed (${response.status})`);
  const token = await response.json();
  accessToken = token.access_token;
  tokenExpires = Date.now() + token.expires_in * 1000;
  return accessToken;
}

function boardIds(date = new Date()) {
  const parts = {};
  for (const item of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)) parts[item.type] = item.value;
  const y = +parts.year, m = +parts.month, d = +parts.day;
  const thursday = new Date(Date.UTC(y, m - 1, d));
  const weekday = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = String(Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7)).padStart(2, '0');
  const pad = n => String(n).padStart(2, '0');
  return {
    d: `d${y}${pad(m)}${pad(d)}a`,
    w: `w${thursday.getUTCFullYear()}-${week}a`,
    m: `m${y}${pad(m)}a`,
    a: ALL
  };
}

function validateEntry(mode, uid, input, now) {
  if (!input || !['s', 'g'].includes(mode)) throw new HttpError(400, 'invalid-submission');
  const t = input.t;
  if (!Number.isSafeInteger(t) || t < 120 || t > 86400) throw new HttpError(400, 'invalid-time');
  const uids = input.uids;
  if (!Array.isArray(uids) || uids.length < 1 || uids.length > 4
      || uids.some(x => typeof x !== 'string' || !x || x.length > 128)
      || new Set(uids).size !== uids.length) throw new HttpError(400, 'invalid-members');
  if (mode === 's' && (uids.length !== 1 || uids[0] !== uid)) throw new HttpError(403, 'not-owner');
  if (mode === 'g' && (uids.length < 2 || !uids.includes(uid) || [...uids].sort().join('_') !== uids.join('_'))) {
    throw new HttpError(403, 'invalid-team');
  }
  const id = mode === 's' ? uid : uids.join('_');
  const arr = (key, max) => {
    const value = input[key];
    if (!Array.isArray(value) || value.length !== uids.length || value.some(x => !Number.isSafeInteger(x) || x < 1 || x > max)) {
      throw new HttpError(400, `invalid-${key}`);
    }
    return value;
  };
  const names = input.names;
  if (!Array.isArray(names) || names.length !== uids.length || names.some(x => typeof x !== 'string' || !x.trim() || x.length > 24)) {
    throw new HttpError(400, 'invalid-names');
  }
  const dex = arr('dex', 2000);
  const shiny = input.shiny;
  if (!Array.isArray(shiny) || shiny.length !== uids.length || shiny.some(x => typeof x !== 'boolean')) {
    throw new HttpError(400, 'invalid-shiny');
  }
  if (!Number.isSafeInteger(input.lv) || input.lv < 1 || input.lv > 10 + Math.floor(t / 4)) {
    throw new HttpError(400, 'invalid-level');
  }
  const kills = input.kills;
  if (!Number.isSafeInteger(kills) || kills < 0 || kills > 100 + t * 12) throw new HttpError(400, 'invalid-kills');
  const maxDmg = t < 1800 ? 0 : (t - 1799) * 50000;
  const dmg = input.dmg;
  if (!Number.isSafeInteger(dmg) || dmg < 0 || dmg > maxDmg) throw new HttpError(400, 'invalid-damage');
  const seals = input.seal;
  if (!Array.isArray(seals) || seals.length !== uids.length) throw new HttpError(400, 'invalid-seals');
  return { id, entry: { t, rt: t, lv: input.lv, kills, dmg, uids, names, dex, shiny, seal: seals }, seals };
}

function decodeValue(value) {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeValue(value)]));
}

function encodeValue(value) {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isSafeInteger(value)
    ? { integerValue: String(value) }
    : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
  throw new TypeError('Unsupported Firestore value');
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]));
}

function documentName(project, collection, id, subcollection, subId) {
  const base = `projects/${project}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
  return subcollection ? `${base}/${subcollection}/${encodeURIComponent(subId)}` : base;
}

async function firestoreRequest(env, path, options = {}) {
  const token = await googleToken(env);
  const isDocumentMethod = path.startsWith('documents:');
  const endpoint = isDocumentMethod
    ? `${API}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/${path}`
    : `${API}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const response = await fetch(endpoint, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  return response;
}

async function readDocument(env, name) {
  const response = await firestoreRequest(env, name.replace(
    `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/`, ''
  ));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore read failed (${response.status})`);
  const document = await response.json();
  return { name: document.name, updateTime: document.updateTime, data: decodeFields(document.fields) };
}

function rowT(entry) {
  const row = { t: entry.t, uids: entry.uids, names: entry.names, dex: entry.dex, lv: entry.lv, kills: entry.kills };
  if (entry.shiny.some(Boolean)) row.shiny = entry.shiny;
  return row;
}

function rowD(entry) {
  const row = { d: entry.dmg, uids: entry.uids, names: entry.names, dex: entry.dex };
  if (entry.shiny.some(Boolean)) row.shiny = entry.shiny;
  return row;
}

function summaryOut(top, dtop, me, ev, dev) {
  return Object.keys(dtop).length ? { top, dtop, me, ev, dev: dev || '' } : { top, me, ev };
}

function byTime(top) {
  return Object.entries(top).sort((a, b) => a[1].t - b[1].t);
}

function byDamage(top) {
  return Object.entries(top).sort((a, b) => a[1].d - b[1].d);
}

async function writeBoard(env, board, period, id, entry) {
  const project = env.FIREBASE_PROJECT_ID;
  const sumName = documentName(project, 'lbs', board);
  const entryName = documentName(project, 'lb', board, 'e', id);
  for (let attempt = 0; attempt < 4; attempt++) {
    const [sumDoc, oldDoc] = await Promise.all([
      readDocument(env, sumName),
      readDocument(env, entryName)
    ]);
    const old = oldDoc && oldDoc.data;
    const top = { ...((sumDoc && sumDoc.data.top) || {}) };
    const dtop = { ...((sumDoc && sumDoc.data.dtop) || {}) };
    const oldTime = old ? old.t || 0 : 0;
    const oldDamage = old ? old.dmg || 0 : 0;
    const improveTime = entry.t > oldTime;
    const improveDamage = period !== 'p' && entry.dmg > oldDamage;
    if (!improveTime && !improveDamage) return false;

    const saved = {
      ...entry,
      dmg: Math.max(entry.dmg, oldDamage),
      at: new Date()
    };
    if (!improveTime) Object.assign(saved, { t: oldTime, lv: old.lv, kills: old.kills });

    let ev = '', dev = '', inTime = false, inDamage = false;
    if (improveTime) {
      if (id in top || Object.keys(top).length < TOP) inTime = true;
      else {
        const [lowId, low] = byTime(top)[0];
        if (low.t < saved.t) { ev = lowId; delete top[lowId]; inTime = true; }
      }
      if (inTime) top[id] = rowT(saved);
    }
    if (improveDamage) {
      if (id in dtop || Object.keys(dtop).length < TOP) inDamage = true;
      else {
        const [lowId, low] = byDamage(dtop)[0];
        if (low.d < saved.dmg) { dev = lowId; delete dtop[lowId]; inDamage = true; }
      }
      if (inDamage) dtop[id] = rowD(saved);
    }

    const writes = [];
    if (inTime || inDamage || (!TOP_ONLY.has(period) && improveTime)) {
      writes.push({
        update: { name: entryName, fields: encodeFields(saved) },
        currentDocument: oldDoc ? { updateTime: oldDoc.updateTime } : { exists: false }
      });
    }
    if (inTime || inDamage) {
      writes.push({
        update: { name: sumName, fields: encodeFields(summaryOut(top, dtop, id, ev, dev)) },
        currentDocument: sumDoc ? { updateTime: sumDoc.updateTime } : { exists: false }
      });
    }
    if (!writes.length) return false;
    const response = await firestoreRequest(env, 'documents:commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ writes })
    });
    if (response.ok) return true;
    const details = await response.text();
    if (response.status === 409 || /ABORTED|FAILED_PRECONDITION/.test(details)) continue;
    throw new Error(`Firestore write failed (${response.status})`);
  }
  throw new Error('Firestore write contention; retry later');
}

async function validateSeals(secret, uid, prepared, now) {
  for (let i = 0; i < prepared.entry.uids.length; i++) {
    if (!await verifySeal(secret, prepared.entry.uids[i], prepared.seals[i], now, prepared.entry.t)) {
      throw new HttpError(403, 'invalid-seal');
    }
  }
}

async function submit(body, env, uid) {
  const mode = body.mode;
  const now = Date.now();
  const prepared = validateEntry(mode, uid, body.entry, now);
  await validateSeals(env.SEAL_SECRET, uid, prepared, now);
  const ids = boardIds(new Date(now));
  const boards = PERIODS.map(period => [`${mode}_${ids[period]}`, period]);
  if (prepared.entry.t >= 600) {
    for (const dex of new Set(prepared.entry.dex)) boards.push([`${mode}_${ALL}_p${dex}`, 'p']);
  }
  const better = [];
  for (const [board, period] of boards) {
    if (await writeBoard(env, board, period, prepared.id, prepared.entry) && !better.includes(period)) {
      better.push(period);
    }
  }
  return { better };
}

async function submitDeferred(body, env, uid) {
  const prepared = validateEntry('s', uid, body.entry, Date.now());
  await validateSeals(env.SEAL_SECRET, uid, prepared, Date.now());
  const board = `s_${ALL}`;
  const name = documentName(env.FIREBASE_PROJECT_ID, 'lb', board, 'e', uid);
  for (let attempt = 0; attempt < 4; attempt++) {
    const old = await readDocument(env, name);
    if (old && old.data.t >= prepared.entry.t) return { ok: true };
    const data = { ...prepared.entry, at: new Date() };
    const response = await firestoreRequest(env, 'documents:commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ writes: [{
        update: { name, fields: encodeFields(data) },
        currentDocument: old ? { updateTime: old.updateTime } : { exists: false }
      }] })
    });
    if (response.ok) return { ok: true };
    const details = await response.text();
    if (response.status === 409 || /ABORTED|FAILED_PRECONDITION/.test(details)) continue;
    throw new Error(`Firestore write failed (${response.status})`);
  }
  throw new Error('Firestore write contention; retry later');
}

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function handle(request, env) {
  const origin = request.headers.get('origin') || '';
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'origin_denied' }, 403);
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);

  try {
    const uid = await authenticatedUid(request, env);
    const url = new URL(request.url);
    if (url.pathname === '/v1/seal') {
      const s = Date.now();
      return json({ s, g: await hmac(env.SEAL_SECRET, `${uid}:${s}`) }, 200, headers);
    }
    const text = await request.text();
    if (text.length > 40_000) return json({ error: 'request_too_large' }, 413, headers);
    let body;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, 'invalid-json'); }
    if (url.pathname === '/v1/submit') {
      return json(await submit(body, env, uid), 200, headers);
    }
    if (url.pathname === '/v1/deferred') {
      return json(await submitDeferred(body, env, uid), 200, headers);
    }
    return json({ error: 'not_found' }, 404, headers);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status, headers);
    console.error('[ranking-worker]', error);
    return json({ error: 'ranking_unavailable' }, 503, headers);
  }
}

export default { fetch: handle };

export const rankingWorkerInternals = {
  boardIds,
  decodeFields,
  encodeFields,
  validateEntry,
  verifySeal,
  writeBoard
};
