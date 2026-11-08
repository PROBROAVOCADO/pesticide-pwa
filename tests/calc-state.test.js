import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { syncItemCrop } from '../assets/js/calc-state.js';
import { calcViewHtml } from '../assets/js/views.js';

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

it('常用管理列出每支釘選的移除按鈕，並說明最近用過與紀錄仍保留', () => {
  const html = calcViewHtml({ crop: '', area: '1', areaUnit: 'fen', water: '200', items: [], fieldId: '' },
    [], 1, false, { pinned: [{ key: 'a"b', name: '<藥劑>' }], recent: [] });
  assert.ok(html.includes('管理常用藥劑（1）'));
  assert.ok(html.includes('data-action="remove-pinned-favorite" data-key="a&quot;b"'));
  assert.ok(html.includes('&lt;藥劑&gt;'));
  assert.ok(html.includes('最近用過'));
  assert.ok(html.includes('施作紀錄會保留'));
});
