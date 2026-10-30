const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js/ui/social-ui.js'), 'utf8');

function lobby({ uid, host, isHost, ready = true }) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      className: '',
      classList: {
        values: new Set(),
        add(name) { this.values.add(name); },
        remove(name) { this.values.delete(name); },
        toggle(name, force) {
          if (force) this.values.add(name);
          else this.values.delete(name);
        },
        contains(name) { return this.values.has(name); }
      },
      dataset: {},
      style: { setProperty() {} },
      appendChild() {},
      insertAdjacentHTML() {},
      querySelectorAll() { return []; }
    });
    return elements.get(id);
  };
  const room = {
    id: 'room',
    host,
    isHost,
    lost: false,
    members: [
      { uid: host, name: 'Host', dex: 1 },
      { uid: uid === host ? 'guest' : uid, name: 'Guest', dex: 2 }
    ]
  };
  const G = {
    UI: { $: element, isOpen: () => false, spriteCanvas: () => ({}) },
    U: { esc: String },
    Social: { uid, room, MAX_PLAYERS: 4, friends: [], on() {} },
    Net: { ready: () => ready, mode: () => 'direct', viaTurn: () => false, onPeer() {} },
    Coop: { COLORS: ['#fff', '#fff', '#fff', '#fff'] },
    DEX_BY: { 1: { name: 'Hostmon' }, 2: { name: 'Guestmon' } },
    T: value => value
  };
  vm.runInNewContext(source, { G, document: { createElement: () => element('child') } });
  G.LobbyUI.render();
  return element('lobby-start');
}

test('host sees an enabled start button even if the cached isHost flag is stale', () => {
  const button = lobby({ uid: 'host', host: 'host', isHost: false });
  assert.equal(button.classList.contains('hidden'), false);
  assert.equal(button.disabled, false);
});

test('non-host sees the start button disabled instead of having it disappear', () => {
  const button = lobby({ uid: 'guest', host: 'host', isHost: false });
  assert.equal(button.classList.contains('hidden'), false);
  assert.equal(button.disabled, true);
});
