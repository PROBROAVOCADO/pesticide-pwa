/**
 * 農業部農藥登記公開資料的存取與欄位處理。
 */

const MOA_API = 'https://data.moa.gov.tw/Service/OpenData/FromM/PesticideData.aspx';

/** 把可能是 null／undefined 的欄位值轉成去頭尾空白的字串。 */
export const text = (v) => String(v ?? '').trim();

/**
 * 民國日期轉西元：「106/12/13」→「2017-12-13」。
 * 官方的有效期限與撤銷日期都用這個格式，空白時是「   /  /  」。
 */
export function parseRocDate(raw) {
  const m = String(raw ?? '').match(/(\d{2,3})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  if (!y || !mo || !d) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${y + 1911}-${pad(mo)}-${pad(d)}`;
}

/**
 * 這張許可證的狀態。
 *
 * 有效期限過了但「撤銷類別」是空的，這種資料官方照樣給 ——
 * 例如農藥進02068 的有效期限是 106/12/13（2017 年）。
 * 只看撤銷類別會把它當成有效藥劑列出來，那是「顯示成可用、實際不可用」，
 * 比查不到還危險。所以兩個欄位都要看。
 */
export function licenseStatus(drug, today = new Date().toISOString().slice(0, 10)) {
  const revoked = text(drug['撤銷類別']);
  if (revoked) {
    return { state: 'revoked', label: `已撤銷（${revoked}）`, date: parseRocDate(drug['撤銷日期']) };
  }

  const until = parseRocDate(drug['有效期限']);
  if (until && until < today) return { state: 'expired', label: '許可證已到期', date: until };

  return { state: 'valid', label: '', date: until };
}

/**
 * 分類的顯示樣式。
 *
 * 這裡刻意不再拿分類來過濾搜尋結果 —— 把農友真的會用的藥藏起來，
 * 比列出來讓他自己判斷危險得多。改成標示，讓人一眼看得出這是什麼藥。
 */
export function classTone(kind) {
  if (kind.includes('殺菌')) return 'fungicide';
  if (kind.includes('殺蟲') || kind.includes('殺蟎')) return 'insecticide';
  if (kind.includes('除草')) return 'herbicide';
  return 'other';
}

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

/**
 * 把藥名搜尋到的每一筆登記都翻開，比對是否核准用於指定作物。
 *
 * 使用範圍不在藥劑主清單裡，所以這裡必須逐筆讀取；不能只掃前幾筆，
 * 否則同成分但排序較後面的廠牌會被誤判成「未核准」。
 * loader 由畫面層傳入，讓正式環境可以沿用本機快取，也方便單元測試。
 */
export async function scanDrugsByCrop(
  drugs,
  crop,
  loader,
  { concurrency = 8, onProgress = () => {}, onMatch = () => {} } = {},
) {
  const candidates = Array.isArray(drugs) ? drugs : [];
  const hits = new Array(candidates.length).fill(null);
  let next = 0;
  let done = 0;
  let failed = 0;
  let cached = 0;
  let stale = 0;

  const worker = async () => {
    while (next < candidates.length) {
      const i = next++;
      try {
        const result = await loader(candidates[i]);
        const ranges = Array.isArray(result) ? result : result?.ranges;
        if (result?.status === 'failed') failed += 1;
        if (result?.stale) stale += 1;
        else if (result?.fromCache) cached += 1;
        if (Array.isArray(ranges) && ranges.some((range) => matchesCrop(range, crop))) {
          hits[i] = candidates[i];
          onMatch(candidates[i], i);
        }
      } catch {
        failed += 1;
      } finally {
        onProgress((done += 1), candidates.length);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), candidates.length) }, worker),
  );

  return {
    matched: hits.filter(Boolean),
    scanned: candidates.length,
    failed,
    cached,
    stale,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`官方資料暫時無法讀取（${response.status}）`);
  return response.json();
}

/** 排序用：有效的排前面，到期的其次，撤銷的最後。 */
export const statusRank = (drug) => {
  const state = licenseStatus(drug).state;
  return state === 'valid' ? 0 : state === 'expired' ? 1 : 2;
};

/**
 * 只做去重，不再過濾分類或撤銷狀態。
 *
 * 撤銷與過期的許可證照樣列出 —— 農友手上可能還有庫存，
 * 知道「這支已經到期了」比完全查不到它更有用。狀態交給畫面標示。
 */
export function uniqueDrugs(rows) {
  const seen = new Set();
  return rows.filter((d) => {
    const key = `${text(d['許可證字'])}-${text(d['許可證號'])}`;
    if (key === '-' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 每個欄位一次跟官方要幾筆。
 *
 * 像「亞托敏」這種普通名稱，登記產品可以上百支。以前一次只要 80 筆，
 * 排在後面的廠牌（例如大卡稱）會直接被截掉，而畫面上完全看不出來，
 * 使用者只會以為那支藥沒登記 —— 這比查不到更危險。
 */
const MOA_TOP = 200;

/**
 * 以普通名稱、廠牌名稱、農藥代號三個欄位同時查詢，再合併去重。
 *
 * 單一欄位失敗不影響其他欄位，但三個欄位全部失敗就要丟出錯誤 ——
 * 那代表連不上官方資料，不是「查無此藥」。
 * 分清楚這兩件事，離線備援才有機會接手。
 *
 * 回傳 { drugs, capped }。capped 表示至少有一個欄位被 MOA_TOP 截斷，
 * 也就是「還有更多沒拿到」，畫面必須把這件事講出來。
 */
export async function searchDrugs(query) {
  const q = String(query ?? '').trim();
  if (q.length < 2) throw new Error('請至少輸入兩個字');

  const batches = await Promise.all(
    ['中文名稱', '廠牌名稱', '農藥代號'].map(async (field) => {
      const filter = encodeURIComponent(`${field} like ${q}`);
      try {
        const rows = await fetchJson(`${MOA_API}?$top=${MOA_TOP}&$filter=${filter}`);
        return { ok: true, rows: Array.isArray(rows) ? rows : [] };
      } catch {
        return { ok: false, rows: [] };
      }
    }),
  );

  if (batches.every((b) => !b.ok)) throw new Error('目前連不上農業部的資料服務');

  // 有效的排前面。過期或撤銷的照樣列出，但不該擋在有效藥劑前面。
  const drugs = uniqueDrugs(batches.flatMap((b) => b.rows))
    .map((drug, i) => ({ drug, rank: statusRank(drug), i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((o) => o.drug);

  return { drugs, capped: batches.some((b) => b.rows.length >= MOA_TOP) };
}

/** 在已經拿到的結果裡再篩一次。查完普通名稱後想找特定廠牌時用。 */
export function filterDrugs(drugs, keyword) {
  const k = normalize(keyword);
  if (!k) return drugs;
  return drugs.filter((d) =>
    ['廠牌名稱', '中文名稱', '廠商名稱', '農藥代號'].some((f) => normalize(text(d[f])).includes(k)) ||
    normalize(license(d)).includes(k),
  );
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
