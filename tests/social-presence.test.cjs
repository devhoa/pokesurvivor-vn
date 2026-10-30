const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js/net/social.js'), 'utf8');

function social() {
  const refs = new Map(), friend = {
    id: 'friendship',
    data: () => ({ from: 'me', to: 'friend', status: 'ok', names: { me: 'Me', friend: 'Pal' } })
  };
  let ownPresencePath = '';
  const rtdb = {
    online: false,
    goOnline() { this.online = true; },
    goOffline() { this.online = false; },
    ref(path) {
      if (path.startsWith('presence/me/')) ownPresencePath = path;
      if (!refs.has(path)) refs.set(path, {
        listeners: new Set(), value: undefined, disconnected: false,
        on(event, fn) { this.listeners.add(fn); },
        off(event, fn) { this.listeners.delete(fn); },
        set(value) { this.value = value; return Promise.resolve(); },
        remove() { this.value = null; return Promise.resolve(); },
        onDisconnect() {
          return {
            remove: () => { this.disconnected = true; return Promise.resolve(); },
            cancel: () => Promise.resolve()
          };
        }
      });
      return refs.get(path);
    }
  };
  const G = {
    DB: {
      online: true, user: 'Me', nameAccount: false, fb: { uid: 'me', rtdb },
      onLeave() {}, setName() {}
    }
  };
  const context = {
    G,
    firebase: { database: { ServerValue: { TIMESTAMP: 1 } }, firestore: { FieldValue: { serverTimestamp: () => 1 } } },
    localStorage: { getItem: key => key === 'ps.nick.me' ? 'Me' : null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(Error('not needed')),
    console, Date, Map, Set, Promise, Math, URLSearchParams, setTimeout, clearTimeout
  };
  vm.runInNewContext(source, context);

  const collection = name => ({
    where(field) {
      return {
        onSnapshot(callback) {
          if (name === 'friendships') callback({ docs: field === 'from' ? [friend] : [] });
          return () => {};
        }
      };
    }
  });
  G.DB.fb.fs = { collection };
  return { G, refs, rtdb };
}

test('Realtime Database presence tracks own connection and accepted friends', async () => {
  const { G, refs, rtdb } = social();
  assert.equal(await G.Social.start(), 'ok');
  assert.equal(rtdb.online, true);

  await G.Social.ensureFriends();
  const friend = G.Social.friends[0];
  assert.equal(friend.online, null);

  const connected = refs.get('.info/connected');
  [...connected.listeners][0]({ val: () => true });
  await Promise.resolve();
  const ownPresence = refs.get([...refs.keys()].find(path => path.startsWith('presence/me/')));
  assert.equal(ownPresence.value, true);
  assert.equal(ownPresence.disconnected, true);

  const friendPresence = refs.get('presence/friend');
  const onValue = [...friendPresence.listeners][0];
  onValue({ val: () => ({ tab1: true, tab2: true }) });
  assert.equal(G.Social.friends[0].online, true);
  onValue({ val: () => ({ tab2: true }) });
  assert.equal(G.Social.friends[0].online, true);
  onValue({ val: () => null });
  assert.equal(G.Social.friends[0].online, false);

  [...connected.listeners][0]({ val: () => false });
  assert.equal(G.Social.friends[0].online, null);
  await G.Social.stop();
  assert.equal(ownPresence.value, null);
  assert.equal(rtdb.online, false);
});
