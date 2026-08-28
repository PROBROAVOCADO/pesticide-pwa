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

/**
 * 使用範圍的作物是否符合使用者輸入的作物。
 *
 * 使用者沒填作物就不篩選，全部通過。
 * 但官方那一筆的作物名稱是空的時候必須算「不符合」——
 * 空字串會被任何字串 includes 到，放著不管的話，
 * 一支藥只要有一筆沒填作物的範圍，就會被誤判成核准用於所有作物。
 */
export function matchesCrop(range, crop) {
  const wanted = normalize(crop);
  if (!wanted) return true;

  const official = normalize(text(range['作物名稱']));
  if (!official) return false;

  return official.includes(wanted) || wanted.includes(official);
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
 *
 * 單一欄位失敗不影響其他欄位，但三個欄位全部失敗就要丟出錯誤 ——
 * 那代表連不上官方資料，不是「查無此藥」。
 * 分清楚這兩件事，離線備援才有機會接手。
 */
export async function searchDrugs(query) {
  const q = String(query ?? '').trim();
  if (q.length < 2) throw new Error('請至少輸入兩個字');

  const batches = await Promise.all(
    ['中文名稱', '廠牌名稱', '農藥代號'].map(async (field) => {
      const filter = encodeURIComponent(`${field} like ${q}`);
      try {
        return { ok: true, rows: await fetchJson(`${MOA_API}?$top=80&$filter=${filter}`) };
      } catch {
        return { ok: false, rows: [] };
      }
    }),
  );

  if (batches.every((b) => !b.ok)) throw new Error('目前連不上農業部的資料服務');

  return uniqueDrugs(batches.flatMap((b) => b.rows)).slice(0, 80);
}

/**
 * 卡片副標題第二行：用來分辨同名藥劑。
 *
 * 官方資料裡很多產品的「廠牌名稱」是空的，標題只好退回普通名稱，
 * 於是一整排都顯示「賽洛寧」。廠商名稱與許可證號才分得出是哪一支。
 */
export const drugIdentity = (d) =>
  [text(d['廠商名稱']), license(d)].filter(Boolean).join('・');

/**
 * 取得一項藥劑的核准使用範圍。
 *
 * 回傳 { ranges, status }，status 用來區分三種「沒有資料」：
 *   ok       正常取得
 *   no-link  這筆登記本身就沒有附使用範圍的連結（原體、或官方尚未提供）
 *   empty    連結有，但官方回傳空清單
 *
 * 分清楚很重要 —— 使用者看到「沒有核准範圍」時，
 * 應該知道是這支藥真的沒登記用途，還是我們讀不到。
 */
export async function loadRanges(drug) {
  const url = text(drug['農藥使用範圍']);
  if (!url) return { ranges: [], status: 'no-link' };

  const ranges = await fetchJson(url.replace(/^http:/, 'https:'));
  const rows = Array.isArray(ranges) ? ranges : [];
  return { ranges: rows, status: rows.length ? 'ok' : 'empty' };
}
