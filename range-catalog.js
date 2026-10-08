/**
 * 隨 PWA 發布的農藥使用範圍快照。
 *
 * 防檢署現行查詢站會依「農藥代號＋劑型＋含量」列出使用範圍，
 * 但不允許瀏覽器跨網域讀取，因此更新程式會把資料切成小型 JSON 分片。
 * 執行時只下載目前藥劑代號所在的分片，不會一次載入整份資料。
 */

const shardCache = new Map();

export const normalizePesticideCode = (value) => String(value ?? '').trim().toUpperCase();
export const normalizeFormulation = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase();

/** 71.600 (%) 與 71.6 (%) (w/w) 會得到相同的 71.6。 */
export const contentKey = (value) =>
  [...String(value ?? '').replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)]
    .map((match) => String(Number(match[0])))
    .join('|');

export const rangeShard = (drugOrCode) => {
  const code = typeof drugOrCode === 'object' ? normalizePesticideCode(drugOrCode?.['農藥代號']) : normalizePesticideCode(drugOrCode);
  return code.slice(0, 2).replace(/[^A-Z0-9]/g, '_') || '';
};

const rangeKey = (range) =>
  [
    range['作物名稱'],
    range['病蟲害名稱'],
    range['每公頃使用用藥量'],
    range['稀釋倍數'],
    range['使用時期'],
    range['安全採收期'],
  ]
    .map((value) => String(value ?? '').trim())
    .join('|');

/**
 * 同一普通名稱可能有不同含量或劑型，絕不能只憑名稱把用途混在一起。
 * 只有農藥代號、劑型與含量全部吻合時才回傳範圍。
 */
export function selectCatalogRanges(drug, units) {
  const formulation = normalizeFormulation(drug?.['劑型']);
  const strength = contentKey(drug?.['含量']);
  if (!formulation || !strength || !Array.isArray(units)) return [];

  const matched = units.filter(
    (unit) => normalizeFormulation(unit.form) === formulation && String(unit.contentKey || contentKey(unit.content)) === strength,
  );

  const seen = new Set();
  const ranges = [];
  for (const unit of matched) {
    for (const range of unit.ranges || []) {
      const key = rangeKey(range);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      ranges.push(range);
    }
  }
  return ranges;
}

async function loadShard(shard, fetcher) {
  if (!shardCache.has(shard)) {
    const url = new URL(`./ranges/${shard}.json`, import.meta.url);
    const request = fetcher(url, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`使用範圍快照暫時無法讀取（${response.status}）`);
        return response.json();
      })
      .catch((error) => {
        shardCache.delete(shard);
        throw error;
      });
    shardCache.set(shard, request);
  }
  return shardCache.get(shard);
}

export async function loadCatalogRanges(drug, fetcher = fetch) {
  const code = normalizePesticideCode(drug?.['農藥代號']);
  const shard = rangeShard(code);
  if (!code || !shard) return { ranges: [], status: 'missing', source: 'catalog' };

  const data = await loadShard(shard, fetcher);
  const units = data?.items?.[code];
  if (!units) return { ranges: [], status: 'missing', source: 'catalog', updatedAt: data?._meta?.generatedAt || '' };

  const ranges = selectCatalogRanges(drug, units);
  return {
    ranges,
    status: ranges.length ? 'ok' : 'mismatch',
    source: 'catalog',
    updatedAt: data?._meta?.generatedAt || '',
  };
}

export function clearRangeCatalogCache() {
  shardCache.clear();
}
