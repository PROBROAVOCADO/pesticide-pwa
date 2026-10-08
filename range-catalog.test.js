import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, it } from 'node:test';
import {
  clearRangeCatalogCache,
  contentKey,
  loadCatalogRanges,
  rangeShard,
  selectCatalogRanges,
} from './range-catalog.js';

const drug = { 農藥代號: 'F246', 中文名稱: '銅右滅達樂', 劑型: 'WP', 含量: '71.600 (%)' };
const units = [
  {
    form: 'WP',
    content: '71.6 (%) (w/w)',
    contentKey: '71.6',
    ranges: [{ 作物名稱: '酪梨', 病蟲害名稱: '疫病', 稀釋倍數: '1,000' }],
  },
  {
    form: 'SC',
    content: '20 (%)',
    contentKey: '20',
    ranges: [{ 作物名稱: '水稻', 病蟲害名稱: '稻熱病' }],
  },
];

afterEach(() => clearRangeCatalogCache());

describe('使用範圍快照的精準配對', () => {
  it('含量的小數尾零與標示補充文字不影響比對', () => {
    assert.equal(contentKey('71.600 (%)'), contentKey('71.6 (%) (w/w)'));
  });

  it('以農藥代號前兩碼決定分片', () => {
    assert.equal(rangeShard(drug), 'F2');
  });

  it('代號相同時仍須同時符合劑型與含量', () => {
    assert.deepEqual(selectCatalogRanges(drug, units), units[0].ranges);
    assert.deepEqual(selectCatalogRanges({ ...drug, 劑型: 'SC' }, units), []);
    assert.deepEqual(selectCatalogRanges({ ...drug, 含量: '50 (%)' }, units), []);
  });

  it('只讀取需要的分片並回傳匹配範圍', async () => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ _meta: { generatedAt: '2026-10-08' }, items: { F246: units } }) };
    };
    const result = await loadCatalogRanges(drug, fetcher);
    assert.equal(result.status, 'ok');
    assert.equal(result.ranges[0].作物名稱, '酪梨');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].endsWith('/ranges/F2.json'));
  });

  it('快照沒有完全相同的劑型與含量時回傳 mismatch，不亂套用途', async () => {
    const result = await loadCatalogRanges(
      { ...drug, 含量: '50 (%)' },
      async () => ({ ok: true, status: 200, json: async () => ({ items: { F246: units } }) }),
    );
    assert.equal(result.status, 'mismatch');
    assert.deepEqual(result.ranges, []);
  });

  it('正式快照包含銅右滅達樂用於酪梨疫病的官方範圍', async () => {
    const data = JSON.parse(await readFile(new URL('./ranges/F2.json', import.meta.url), 'utf8'));
    const ranges = selectCatalogRanges(drug, data.items.F246);
    const avocado = ranges.find((range) => range.作物名稱 === '酪梨' && range.病蟲害名稱 === '疫病');
    assert.ok(avocado);
    assert.equal(avocado.每公頃使用用藥量, '0.8-1.6公斤');
    assert.equal(avocado.稀釋倍數, '1,000');
    assert.equal(avocado.安全採收期, '12');
  });
});
