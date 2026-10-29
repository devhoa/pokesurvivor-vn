const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js/data/shop.js'), 'utf8');

function shop(save) {
  const commits = [];
  const G = {
    DB: { save, commit: () => commits.push(save.coins) },
    TM_MOVES: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`tm-${i}`, []])),
    Mons: { canLearn: () => false, learnable: () => [] }
  };
  vm.runInNewContext(SRC, { G, Intl, Date, Math, Object, Number });
  return { Shop: G.Shop, commits };
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
