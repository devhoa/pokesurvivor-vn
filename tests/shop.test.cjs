const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js/data/shop.js'), 'utf8');
const TMS_SRC = fs.readFileSync(path.join(__dirname, '..', 'js/data/tms.js'), 'utf8');
const MONS_SRC = fs.readFileSync(path.join(__dirname, '..', 'js/systems/mons.js'), 'utf8');
const STARTERS_SRC = fs.readFileSync(path.join(__dirname, '..', 'js/data/starters.js'), 'utf8');

function shop(save, { moveTypes = {}, partnerTypes = [], clock = { value: Date.UTC(2026, 0, 1) } } = {}) {
  const commits = [];
  const availableMoves = Object.keys(moveTypes).length
    ? moveTypes
    : Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`tm-${i}`, 'normal']));
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.value])); }
  }
  const moves = Object.fromEntries(Object.keys(availableMoves).map(id => [id, { type: availableMoves[id] }]));
  const G = {
    DB: { save, commit: () => commits.push(save.coins) },
    TM_MOVES: Object.fromEntries(Object.keys(availableMoves).map(id => [id, []])),
    Moves: { BY_ID: moves },
    DEX_BY: { 25: { types: partnerTypes } },
    Mons: { canLearn: () => false, learnable: () => [] }
  };
  vm.runInNewContext(SRC, { G, Intl, Date: TestDate, Math, Object, Number });
  return { Shop: G.Shop, commits, clock };
}

test('reroll costs 20 PokéCoins, changes the offers, and persists for the day', () => {
  const save = { coins: 60, partner: null, tmShop: { day: '', rerolls: 0 } };
  const first = shop(save);
  const before = first.Shop.dailyTms();

  assert.equal(first.Shop.rerollDailyTms().ok, true);
  const after = first.Shop.dailyTms();
  assert.equal(save.coins, 40);
  assert.equal(first.commits.length, 1);
  assert.equal(after.length, 8);
  assert.equal(new Set(after).size, 8);
  assert.notDeepEqual(after, before);

  const reloaded = shop(save);
  assert.deepEqual(reloaded.Shop.dailyTms(), after);
  assert.equal(reloaded.Shop.rerollDailyTms().ok, true);
  assert.notDeepEqual(reloaded.Shop.dailyTms(), after);
  assert.equal(save.coins, 20);
});

test('reroll does not charge or save when the player has fewer than 20 coins', () => {
  const save = { coins: 19, partner: null, tmShop: { day: '', rerolls: 0 } };
  const { Shop, commits } = shop(save);
  const before = Shop.dailyTms();

  const result = Shop.rerollDailyTms();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'No tienes Pokémonedas suficientes.');
  assert.equal(save.coins, 19);
  assert.deepEqual(Shop.dailyTms(), before);
  assert.equal(commits.length, 0);
});

test('rerolls increasingly favor TMs matching the selected Pokémon type, up to the cap', () => {
  const moveTypes = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`tm-${i}`, i < 25 ? 'fire' : 'water']));
  const save = { coins: 0, partner: 25, tmShop: { day: '', rerolls: 0 } };
  const { Shop, clock } = shop(save, { moveTypes, partnerTypes: ['fire'] });
  const rerolls = [0, 1, 3, 6], matching = new Map(rerolls.map(n => [n, 0]));
  const samples = 150;

  for (let day = 0; day < samples; day++) {
    clock.value = Date.UTC(2026, 0, 1 + day);
    for (const count of rerolls) {
      save.tmShop = { day: Shop.today(), rerolls: count };
      matching.set(count, matching.get(count) + Shop.dailyTms().filter(id => moveTypes[id] === 'fire').length);
    }
  }

  const average = count => matching.get(count) / samples;
  assert.ok(average(1) > average(0) + 0.3, `1 reroll: ${average(1)} vs ${average(0)}`);
  assert.ok(average(3) > average(1) + 0.3, `3 rerolls: ${average(3)} vs ${average(1)}`);
  assert.ok(average(6) > average(3) + 0.3, `6 rerolls: ${average(6)} vs ${average(3)}`);
});

test('Greninja can buy and learn Whirlpool through a TM', () => {
  const save = { created: 1, ptm: {}, tms: { whirlpool: 1 } };
  const G = {
    DB: { save },
    DEX: [],
    DEX_BY: { 658: { dex: 658, name: 'Greninja', types: ['water', 'dark'] } },
    Moves: { BY_ID: { whirlpool: { id: 'whirlpool' } }, poolFor: () => ['whirlpool'] },
    Shop: { takeTm: id => {
      if (!save.tms[id]) return false;
      if (--save.tms[id] <= 0) delete save.tms[id];
      return true;
    } },
    NATURES: [],
    DEX_ABIL: {}
  };

  vm.runInNewContext(TMS_SRC, { G, Object });
  vm.runInNewContext(MONS_SRC, { G, Math, Object, Date });

  assert.ok(G.TM_MOVES.whirlpool);
  assert.ok(G.Mons.canLearn(658, 'whirlpool'));
  assert.equal(G.Mons.teach(658, 'whirlpool'), true);
  assert.equal(save.ptm[658][0], 'whirlpool');
  assert.equal(save.tms.whirlpool, undefined);
  assert.equal(G.Mons.canLearn(658, 'whirlpool'), false);
});

test('Greninja can select Aqua Ring as a starting move', () => {
  const G = {
    DEX: [],
    DB: { save: { pstart: { 658: 'aqua-ring' }, pupg: { 658: { start: true } } } },
    DEX_BY: {
      658: { dex: 658, name: 'Greninja', types: ['water', 'dark'] },
      25: { dex: 25, name: 'Pikachu', types: ['electric'] }
    },
    Moves: {
      BY_ID: {
        'aqua-ring': { id: 'aqua-ring', kind: 'buff' },
        'water-gun': { id: 'water-gun', kind: 'projectile' }
      },
      poolFor: () => ['water-gun'],
      startFor: () => 'water-gun'
    }
  };

  vm.runInNewContext(STARTERS_SRC, { G, Object });

  assert.ok(G.startChoices(658).includes('aqua-ring'));
  assert.ok(!G.startChoices(25).includes('aqua-ring'));
  assert.equal(G.startMoveOf(658), 'aqua-ring');
});
