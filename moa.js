/**
 * 農業部農藥登記公開資料的存取與欄位處理。
 */

const MOA_API = 'https://data.moa.gov.tw/Service/OpenData/FromM/PesticideData.aspx';

/** 把可能是 null／undefined 的欄位值轉成去頭尾空白的字串。 */
export const text = (v) => String(v ?? '').trim();

/** 目前只收錄仍有效（未撤銷）的殺菌劑與殺蟲劑。 */
export const isAllowed = (d) =>
  ['殺菌劑', '殺蟲劑'].includes(text(d['農藥分類中文意義'])) && !text(d['撤銷類別']);

/** 許可證字號，也是這份資料裡最穩定的唯一識別。 */
export const license = (d) => `${text(d['許可證字'])}${text(d['許可證號'])}`;

/** 卡片主標題：優先顯示廠牌名稱，其次普通名稱，最後退回許可證號。 */
export const drugTitle = (d) => text(d['廠牌名稱']) || text(d['中文名稱']) || license(d);

/** 卡片副標題：普通名稱・含量・劑型。 */
export const drugSubtitle = (d) =>
  [text(d['中文名稱']), text(d['含量']), text(d['劑型'])].filter(Boolean).join('・');

/**
 * 作物名稱正規化。
 * 官方資料裡「臺／台」「蕃／番」混用，也常夾雜空白與各種連字號，
 * 比對前一律拉平，否則使用者打「番茄」會查不到「蕃茄」。
 */
export function normalize(s) {
  return String(s ?? '')
    .replace(/[臺台]/g, '台')
    .replace(/[蕃番]/g, '番')
    .replace(/[\s－—–_]/g, '')
    .toLowerCase();
}

/** 使用範圍的作物是否符合使用者輸入的作物。空字串代表不篩選。 */
export function matchesCrop(range, crop) {
  const a = normalize(text(range['作物名稱']));
  const b = normalize(crop);
  return !b || a.includes(b) || b.includes(a);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`官方資料暫時無法讀取（${response.status}）`);
  return response.json();
}

/** 去除重複許可證，並濾掉不在收錄範圍內的藥劑。 */
export function uniqueDrugs(rows) {
  const seen = new Set();
  return rows.filter((d) => {
    const key = `${text(d['許可證字'])}-${text(d['許可證號'])}`;
    if (!key || seen.has(key) || !isAllowed(d)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 以普通名稱、廠牌名稱、農藥代號三個欄位同時查詢，再合併去重。
 * 單一欄位查不到就回空陣列，不讓一個欄位的失敗拖垮整次查詢。
 */
export async function searchDrugs(query) {
  const q = String(query ?? '').trim();
  if (q.length < 2) throw new Error('請至少輸入兩個字');

  const batches = await Promise.all(
    ['中文名稱', '廠牌名稱', '農藥代號'].map(async (field) => {
      const filter = encodeURIComponent(`${field} like ${q}`);
      try {
        return await fetchJson(`${MOA_API}?$top=80&$filter=${filter}`);
      } catch {
        return [];
      }
    }),
  );

  return uniqueDrugs(batches.flat()).slice(0, 80);
}

/** 取得一項藥劑的核准使用範圍。官方欄位有時是 http，統一升級為 https 以免被瀏覽器擋掉。 */
export async function loadRanges(drug) {
  const url = text(drug['農藥使用範圍']);
  return url ? fetchJson(url.replace(/^http:/, 'https:')) : [];
}
