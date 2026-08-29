import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cachedRangesIfFresh } from './db.js';

describe('cachedRangesIfFresh：核准範圍的 24 小時快取判斷', () => {
  const now = 2_000_000;
  const oneDay = 24 * 60 * 60 * 1000;

  it('期限內的已核准範圍可以立即使用', () => {
    const result = cachedRangesIfFresh(
      { ranges: [{ 作物名稱: '酪梨' }], rangeStatus: 'ok', rangesFetchedAt: now - 1000 },
      oneDay,
      now,
    );
    assert.equal(result.status, 'ok');
    assert.equal(result.fromCache, true);
  });

  it('沒有使用範圍的結果也能暫存，避免每次重查', () => {
    const result = cachedRangesIfFresh(
      { ranges: [], rangeStatus: 'empty', rangesFetchedAt: now - 1000 },
      oneDay,
      now,
    );
    assert.deepEqual(result.ranges, []);
    assert.equal(result.status, 'empty');
  });

  it('超過期限就回 null，讓程式重新向官方確認', () => {
    const result = cachedRangesIfFresh(
      { ranges: [{ 作物名稱: '酪梨' }], rangeStatus: 'ok', rangesFetchedAt: now - oneDay - 1 },
      oneDay,
      now,
    );
    assert.equal(result, null);
  });

  it('舊版有非空 ranges 與 fetchedAt 的資料仍可相容', () => {
    const result = cachedRangesIfFresh(
      { ranges: [{ 作物名稱: '酪梨' }], fetchedAt: now - 1000 },
      oneDay,
      now,
    );
    assert.equal(result.status, 'ok');
  });
});
