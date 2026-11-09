import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { syncItemCrop } from '../assets/js/calc-state.js';
import { calcViewHtml, searchViewHtml } from '../assets/js/views.js';

const avocado = { 作物名稱: '酪梨', 病蟲害名稱: '疫病', 稀釋倍數: '1000', 安全採收期: '7' };
const tomato = { 作物名稱: '番茄', 病蟲害名稱: '晚疫病', 稀釋倍數: '2000', 安全採收期: '14' };
const tomato2 = { 作物名稱: '番茄', 病蟲害名稱: '葉斑病', 稀釋倍數: '1500' };
const makeItem = () => ({ allRanges: [avocado, tomato, tomato2], ranges: [avocado], selected: 0, rangeStatus: 'ok' });

describe('切換作物', () => {
  it('保留完整用途，切換後可切回原作物，並更新用量及採收期來源', () => {
    const item = makeItem();
    syncItemCrop(item, '番茄');
    assert.deepEqual(item.ranges, [tomato, tomato2]);
    assert.equal(item.ranges[item.selected].稀釋倍數, '2000');
    assert.equal(item.ranges[item.selected].安全採收期, '14');
    item.selected = 1;
    syncItemCrop(item, ' 番茄 ');
    assert.equal(item.ranges[item.selected], tomato2);
    syncItemCrop(item, '酪梨');
    assert.equal(item.ranges[item.selected], avocado);
    assert.equal(item.cropMissing, false);
  });
  it('找不到新作物時清楚標記，仍保留全部用途供查閱', () => {
    const item = makeItem();
    syncItemCrop(item, '不存在作物');
    assert.equal(item.cropMissing, true);
    assert.equal(item.ranges.length, 3);
    syncItemCrop(item, '');
    assert.equal(item.ranges.length, 3);
    assert.equal(item.cropMissing, false);
  });
  it('讀取失敗不誤判為沒有核准用途', () => {
    const item = { allRanges: [], ranges: [], selected: 0, rangeStatus: 'failed' };
    syncItemCrop(item, '酪梨');
    assert.equal(item.cropMissing, false);
  });
});

it('查詢及試算共用常用管理卡片，可以查看詳情及移除釘選', () => {
  const favorites = { pinned: [{ key: 'a"b', name: '<藥劑>' }], recent: [], expanded: true };
  const calc = calcViewHtml({ crop: '', area: '1', areaUnit: 'fen', water: '200', items: [], fieldId: '' },
    [], 1, false, favorites);
  const search = searchViewHtml({ query: '', filter: '', drugs: [], favorites });
  const panel = (page) => page.match(/<details class="favorites-panel"[\s\S]*?<\/details>/)?.[0];
  const html = panel(calc);
  assert.ok(html);
  assert.equal(panel(search), html);
  assert.ok(html.includes('data-favorites-panel open'));
  assert.ok(html.includes('已釘選 1 支'));
  assert.ok(html.includes('data-action="open-pinned-favorite" data-key="a&quot;b"'));
  assert.ok(html.includes('data-action="remove-pinned-favorite" data-key="a&quot;b"'));
  assert.ok(html.includes('&lt;藥劑&gt;'));
  assert.ok(html.includes('最近用過'));
  assert.ok(html.includes('施作紀錄會保留'));
});

it('沒有常用藥劑時仍顯示管理入口及如何釘選', () => {
  const html = searchViewHtml({ query: '', filter: '', drugs: [] });
  assert.ok(html.includes('已釘選 0 支'));
  assert.ok(html.includes('還沒有釘選藥劑'));
  assert.ok(!html.includes('data-action="remove-pinned-favorite"'));
});
