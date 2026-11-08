import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import vm from 'node:vm';
import { syncItemCrop } from '../assets/js/calc-state.js';
import { matchesCrop } from '../assets/js/moa.js';

async function harness() {
  const source = (await readFile(new URL('../assets/js/app.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '')
    .split("if ('serviceWorker' in navigator)")[0];
  const handlers = {};
  const holder = { innerHTML: '', addEventListener() {} };
  let favorites = [{ key: 'one', name: '藥一' }];
  const context = vm.createContext({
    Date, console, syncItemCrop, matchesCrop,
    document: { getElementById: () => holder, addEventListener: (type, handler) => { handlers[type] = handler; } },
    window: { addEventListener() {} },
    toHectares: () => 1, calcItemsHtml: () => 'updated',
    removeFavorite: async (key) => { favorites = favorites.filter((f) => f.key !== key); },
    listFavorites: async () => favorites,
  });
  vm.runInContext(source + '\nrender = () => {}; toast = () => {}; globalThis.api = {state, pickField, pickItemDrug, removePinnedFavorite};', context);
  return { ...context.api, context, handlers, holder };
}

it('實際作物輸入與土地選取事件都會同步已選藥劑，移除常用不移除藥劑或紀錄', async () => {
  const app = await harness();
  const a = { 作物名稱: '酪梨', 病蟲害名稱: '疫病' };
  const b = { 作物名稱: '番茄', 病蟲害名稱: '晚疫病' };
  const item = app.state.calc.items[0];
  Object.assign(item, { drug: {}, allRanges: [a, b], ranges: [a], rangeStatus: 'ok' });
  app.handlers.input({ target: { dataset: { field: 'crop' }, value: '番茄' } });
  assert.equal(item.ranges[0], b);
  assert.equal(app.holder.innerHTML, 'updated');
  app.state.fields.push({ id: 'field', crop: '酪梨', area: 2, unit: 'fen' });
  app.pickField('field');
  assert.equal(item.ranges[0], a);
  app.state.favorites = [{ key: 'one' }];
  app.state.applications = [{ drugs: [{ license: 'one' }] }];
  await app.removePinnedFavorite('one');
  assert.equal(app.state.favorites.length, 0);
  assert.equal(app.state.applications.length, 1);
  assert.equal(app.state.calc.items[0], item);
});

it('藥劑載入中更改作物，完成時採用最新作物，過時回應不覆蓋新藥劑', async () => {
  const app = await harness();
  let resolve;
  app.context.rangesWithFallback = () => new Promise((done) => { resolve = done; });
  const item = app.state.calc.items[0];
  const drug = {};
  const pending = app.pickItemDrug(item, drug);
  app.state.calc.crop = '番茄';
  resolve({ status: 'ok', ranges: [{ 作物名稱: '酪梨' }, { 作物名稱: '番茄' }] });
  await pending;
  assert.equal(item.ranges[0].作物名稱, '番茄');
  const stale = app.pickItemDrug(item, drug);
  item.drug = {};
  resolve({ status: 'ok', ranges: [{ 作物名稱: '過時' }] });
  await stale;
  assert.equal(item.ranges[0].作物名稱, '番茄');
});
