const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const worker = require('../worker/ranking-worker.mjs');
const internals = worker.rankingWorkerInternals;

const SECRET = 'ranking-test-secret';
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
async function sealFor(uid, s) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${uid}:${s}`));
  return { s, g: hex(signature) };
}

test('board ids follow Madrid calendar and ISO week', () => {
  assert.deepEqual(internals.boardIds(new Date('2026-10-29T12:00:00Z')), {
    d: 'd20261029a', w: 'w2026-44a', m: 'm202610a', a: 'all4'
  });
});

test('server accepts only bounded, authenticated-member submissions and valid seals', async () => {
  const now = Date.now(), seal = await sealFor('U1', now - 120_000);
  const prepared = internals.validateEntry('s', 'U1', {
    t: 120, lv: 40, kills: 1540, dmg: 0, uids: ['U1'], names: ['Ash'],
    dex: [25], shiny: [false], seal: [seal]
  }, now);
  assert.equal(prepared.id, 'U1');
  assert.equal(await internals.verifySeal(SECRET, 'U1', seal, now, 120), true);
  assert.equal(await internals.verifySeal(SECRET, 'U2', seal, now, 120), false);
  const team = internals.validateEntry('g', 'U1', {
    t: 120, lv: 40, kills: 1540, dmg: 0, uids: ['U1', 'U2'], names: ['Ash', 'Misty'],
    dex: [25, 7], shiny: [false, true], seal: [seal, await sealFor('U2', now - 120_000)]
  }, now);
  assert.equal(team.id, 'U1_U2');
  assert.throws(() => internals.validateEntry('g', 'U1', {
    t: 120, lv: 40, kills: 100, dmg: 0, uids: ['U2', 'U1'], names: ['Misty', 'Ash'],
    dex: [7, 25], shiny: [false, false], seal: [seal, seal]
  }, now), /invalid-team/);
  assert.throws(() => internals.validateEntry('s', 'U2', {
    t: 120, lv: 40, kills: 100, dmg: 0, uids: ['U1'], names: ['Ash'],
    dex: [25], shiny: [false], seal: [seal]
  }, now), /not-owner/);
  assert.throws(() => internals.validateEntry('s', 'U1', {
    t: 120, lv: 999, kills: 100, dmg: 0, uids: ['U1'], names: ['Ash'],
    dex: [25], shiny: [false], seal: [seal]
  }, now), /invalid-level/);
});

test('Worker authenticates a score and writes Firestore entry and summary as one commit', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const env = {
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_API_KEY: 'test-api-key',
    GOOGLE_CLIENT_EMAIL: 'worker@test-project.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: pem,
    SEAL_SECRET: SECRET
  };
  const docs = new Map();
  let commits = 0;
  const originalFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      return Response.json({ users: [{ localId: 'U1' }] });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'service-token', expires_in: 3600 });
    }
    if (url.includes('/documents:commit')) {
      commits++;
      const { writes } = JSON.parse(options.body);
      for (const write of writes) {
        const path = write.update.name.split('/documents/')[1];
        docs.set(`https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents/${path}`, {
          name: write.update.name,
          updateTime: new Date().toISOString(),
          fields: write.update.fields
        });
      }
      return Response.json({ writeResults: writes.map(() => ({})) });
    }
    if (options.method === 'GET' || !options.method) {
      const document = docs.get(url);
      return document ? Response.json(document) : Response.json({ error: 'missing' }, { status: 404 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const now = Date.now(), seal = await sealFor('U1', now - 120_000);
    const makeRequest = () => new Request('https://ice.pokesurvivor.com/v1/submit', {
      method: 'POST',
      headers: { origin: 'https://pokesurvivor.com', authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 's', entry: {
        t: 120, lv: 40, kills: 1540, dmg: 0, uids: ['U1'], names: ['Ash'],
        dex: [25], shiny: [false], seal: [seal]
      } })
    });
    const response = await worker.default.fetch(makeRequest(), env);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).better.sort(), ['a', 'd', 'm', 'w']);
    assert.equal(commits, 4);
    assert.equal(docs.size, 8);

    const duplicate = await worker.default.fetch(makeRequest(), env);
    assert.equal(duplicate.status, 200);
    assert.deepEqual((await duplicate.json()).better, []);
    assert.equal(commits, 4, 'same mark does not create duplicate writes');
  } finally {
    global.fetch = originalFetch;
  }
});
