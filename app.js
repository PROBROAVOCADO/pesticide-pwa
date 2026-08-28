import { calcRange, formatRange, formatWater, toHectares } from './calc.js';
import {
  addFavorite,
  allCached,
  cacheDrugs,
  cacheRanges,
  dbAvailable,
  deleteApplication,
  deleteField,
  exportBackup,
  getCached,
  importBackup,
  listApplications,
  listFavorites,
  listFields,
  removeFavorite,
  requestPersistence,
  saveApplication,
  saveField,
  searchCachedDrugs,
} from './db.js';
import { drugTitle, filterDrugs, license, loadRanges, matchesCrop, searchDrugs, statusRank, text } from './moa.js';
import {
  buildIcs,
  buildRecordText,
  googleCalendarUrl,
  harvestInfo,
  pendingHarvests,
  todayKey,
} from './records.js';
import {
  calcViewHtml,
  conversionText,
  detailHtml,
  fieldFormHtml,
  fieldsSheetHtml,
  itemOutputHtml,
  itemResultsHtml,
  modalHtml,
  recordDetailHtml,
  recordFormHtml,
  recordsViewHtml,
  searchResultsHtml,
  searchViewHtml,
  settingsViewHtml,
  toastHtml,
} from './views.js';

/* ------------------------------------------------------------------ */
/* 常數                                                                */
/* ------------------------------------------------------------------ */

const VERSION = 'v1.4.0';
const LINE_URL = 'https://line.me/ti/p/7OorqI3Zzk';
const APHIA_URL = 'https://pesticide.aphia.gov.tw/information/';

/** 一次最多畫幾張結果卡。再多手機捲起來會卡，用結果篩選欄縮小範圍即可。 */
const SEARCH_DISPLAY_LIMIT = 120;

/** 本機儲存的專屬前綴，避免與同帳號的其他 GitHub Pages 站台互相干擾。 */
const APP_ID = 'field-meds';

/* ------------------------------------------------------------------ */
/* localStorage（只放輕量的偏好設定，資料本體在 IndexedDB）            */
/* ------------------------------------------------------------------ */

const store = {
  get(name) {
    try {
      return localStorage.getItem(`${APP_ID}:${name}`);
    } catch {
      return null;
    }
  },
  set(name, value) {
    try {
      localStorage.setItem(`${APP_ID}:${name}`, value);
    } catch {
      /* 無痕模式等情況下安靜略過 */
    }
  },
};

/* ------------------------------------------------------------------ */
/* 狀態                                                                */
/* ------------------------------------------------------------------ */

let nextItemId = 1;
const emptyItem = () => ({
  id: nextItemId++,
  query: '',
  filter: '', // 在已取得的結果裡再篩一次
  results: [],
  visible: [],
  // 以許可證號為鍵，這樣排序與篩選都不會讓標記對錯人
  approvalOf: {}, // { 許可證: 'yes' | 'no' | 'none' }
  scanning: false,
  scanned: 0,
  scanTotal: 0,
  drug: null,
  ranges: [],
  rangeStatus: '', // ok | no-link | empty | failed
  cropMissing: false,
  selected: 0,
  loading: false,
  error: '',
});

const state = {
  tab: 'search',
  search: {
    query: '',
    crop: '',
    filter: '', // 在已取得的結果裡再篩一次（例如查完亞托敏再找大卡稱）
    drugs: [],
    loading: false,
    message: '填藥劑名稱、作物，或兩個都填',
    note: '',
    capped: false,
  },
  calc: { crop: '', area: '1', areaUnit: 'fen', water: '200', items: [emptyItem()], fieldId: '' },
  records: { month: new Date(), selected: null, filterFieldId: '' },
  fields: [],
  applications: [],
  favorites: [],
  overlay: null, // { kind, ... }
  installPrompt: null,
  persisted: false,
  dbError: '',
};

const areaHa = () => toHectares(Number(state.calc.area) || 0, state.calc.areaUnit);
const waterLiters = () => Number(state.calc.water) || 0;
const findItem = (id) => state.calc.items.find((i) => i.id === Number(id));
const findApp = (id) => state.applications.find((a) => a.id === id);

const screenEl = document.getElementById('screen');
const overlayEl = document.getElementById('overlay');
const tabsEl = document.getElementById('tabs');
const fileInput = document.getElementById('import-file');

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

// 選好藥就能記錄。查不到核准範圍也照樣可以記 ——
// 紀錄的職責是忠實反映實際發生的事，不是替官方把關。
const canRecord = () => state.calc.items.some((i) => i.drug);

const views = {
  search: () => {
    const s = state.search;
    const visible = filterDrugs(s.drugs, s.filter);
    return searchViewHtml({
      ...s,
      drugs: visible.slice(0, SEARCH_DISPLAY_LIMIT),
      total: s.drugs.length,
      matched: visible.length,
      shownLimit: SEARCH_DISPLAY_LIMIT,
      allApproved: Boolean(s.crop.trim() && s.query.trim()),
    });
  },
  calc: () => calcViewHtml(state.calc, state.fields, areaHa(), canRecord(), favoriteOptions()),
  records: () =>
    recordsViewHtml({
      month: state.records.month,
      applications: state.applications,
      selected: state.records.selected,
      pending: pendingHarvests(state.applications),
      filterFieldId: state.records.filterFieldId,
      fields: state.fields,
    }),
  settings: () =>
    settingsViewHtml({
      version: VERSION,
      aphiaUrl: APHIA_URL,
      fieldCount: state.fields.length,
      appCount: state.applications.length,
      persisted: state.persisted,
      dbError: state.dbError,
    }),
};

/** 重畫整個分頁。使用者正在打字時不要呼叫，游標會跑掉。 */
function render() {
  screenEl.innerHTML = views[state.tab]();
  for (const button of tabsEl.querySelectorAll('button')) {
    button.setAttribute('aria-current', String(button.dataset.tab === state.tab));
  }
  renderOverlay();
}

/**
 * 目前面板的識別。同一個面板重畫時要保住捲動位置 ——
 * 在紀錄表單底部按「加一項添加物」卻被彈回頁首，是很惱人的事。
 */
const overlayKey = (o) => (o ? `${o.kind}:${o.id ?? o.modal ?? ''}` : '');

let lastOverlayKey = '';

function renderOverlay() {
  const o = state.overlay;
  const key = overlayKey(o);
  const sameSheet = key === lastOverlayKey;
  const keepScroll = sameSheet ? (overlayEl.querySelector('.sheet')?.scrollTop ?? null) : null;
  lastOverlayKey = key;

  if (!o) {
    overlayEl.innerHTML = '';
    return;
  }

  if (o.kind === 'detail') {
    overlayEl.innerHTML = detailHtml({
      drug: o.drug,
      ranges: o.ranges,
      loading: o.loading,
      crop: o.crop,
      shown: o.ranges.filter((r) => matchesCrop(r, o.crop)),
      pinned: state.favorites.some((f) => f.key === license(o.drug)),
      rangeStatus: o.rangeStatus,
    });
  } else if (o.kind === 'fields') {
    overlayEl.innerHTML = fieldsSheetHtml(state.fields);
  } else if (o.kind === 'field-form') {
    overlayEl.innerHTML = fieldFormHtml(o.form);
  } else if (o.kind === 'record-form') {
    overlayEl.innerHTML = recordFormHtml(o.draft);
  } else if (o.kind === 'record-detail') {
    const app = findApp(o.id);
    overlayEl.innerHTML = app ? recordDetailHtml(app, o.confirmDelete) : '';
  } else if (o.kind === 'modal') {
    overlayEl.innerHTML = modalHtml(o.modal, { version: VERSION, lineUrl: LINE_URL, message: o.message });
  }

  // 同一個面板就停在原地，換了面板才回到頂端。
  const sheet = overlayEl.querySelector('.sheet');
  if (sheet) sheet.scrollTop = keepScroll ?? 0;
  overlayEl.scrollTop = 0;
}

/**
 * 只更新受面積／用水量影響的區塊，讓輸入框本身不被重建，游標才不會跳掉。
 */
function renderOutputsOnly() {
  const conversion = document.getElementById('area-conversion');
  if (conversion) conversion.textContent = conversionText(areaHa());

  for (const item of state.calc.items) {
    const holder = screenEl.querySelector(`[data-output="${item.id}"]`);
    if (holder) holder.innerHTML = itemOutputHtml(item, areaHa(), waterLiters());
  }
}

/** 只重畫搜尋結果，讓篩選欄的輸入框不被拆掉重建。 */
function renderSearchResultsOnly() {
  const holder = document.getElementById('search-results');
  if (!holder) return;
  const s = state.search;
  const visible = filterDrugs(s.drugs, s.filter);
  holder.innerHTML = searchResultsHtml({
    drugs: visible.slice(0, SEARCH_DISPLAY_LIMIT),
    loading: s.loading,
    allApproved: Boolean(s.crop.trim() && s.query.trim()),
    total: s.drugs.length,
    matched: visible.length,
    shownLimit: SEARCH_DISPLAY_LIMIT,
    keyword: s.filter.trim() || s.query,
  });
}

/** 只更新藥劑面板裡的使用範圍列表，同樣是為了保住輸入游標。 */
function renderDetailRangesOnly() {
  const holder = document.getElementById('detail-ranges');
  if (!holder || state.overlay?.kind !== 'detail') return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderOverlayHtmlForDetail();
  const fresh = wrapper.querySelector('#detail-ranges');
  if (fresh) holder.innerHTML = fresh.innerHTML;
}

function renderOverlayHtmlForDetail() {
  const o = state.overlay;
  return detailHtml({
    drug: o.drug,
    ranges: o.ranges,
    loading: o.loading,
    crop: o.crop,
    shown: o.ranges.filter((r) => matchesCrop(r, o.crop)),
    pinned: state.favorites.some((f) => f.key === license(o.drug)),
    rangeStatus: o.rangeStatus,
  });
}

let toastTimer = null;
function toast(message) {
  const holder = document.getElementById('toast-host');
  holder.innerHTML = toastHtml(message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    holder.innerHTML = '';
  }, 2600);
}

const notice = (title, body) => {
  state.overlay = { kind: 'modal', modal: 'notice', message: { title, body } };
  renderOverlay();
};

/* ------------------------------------------------------------------ */
/* 查詢（含離線快取備援）                                              */
/* ------------------------------------------------------------------ */

async function searchWithFallback(query) {
  try {
    const { drugs, capped } = await searchDrugs(query);
    cacheDrugs(drugs);
    return { rows: drugs, capped, fromCache: false };
  } catch (error) {
    const cached = await searchCachedDrugs(query);
    if (cached.length) return { rows: cached, capped: false, fromCache: true };
    throw error;
  }
}

/**
 * 取得使用範圍，並帶回「為什麼沒有資料」。
 *
 * 不再往外丟例外 —— 呼叫端需要的是狀態，不是錯誤：
 * 「這支藥沒登記用途」跟「我讀不到」對使用者是完全不同的兩件事。
 */
async function rangesWithFallback(drug) {
  const key = license(drug);
  try {
    const { ranges, status } = await loadRanges(drug);
    if (status === 'ok') cacheRanges(key, ranges);
    return { ranges, status };
  } catch {
    const cached = await getCached(key);
    if (cached?.ranges?.length) return { ranges: cached.ranges, status: 'ok' };
    return { ranges: [], status: 'failed' };
  }
}

/**
 * 作物不在 PesticideData 裡 —— 它藏在每一支藥各自的「農藥使用範圍」子資料。
 * 所以「藥名＋作物」只能先用藥名查，再逐一拓展範圍比對作物。
 * 每一支都是一次網路請求，所以要限制筆數與同時數，而且被截掉的部分一定要講出來。
 */
const CROP_SCAN_LIMIT = 24;
const CROP_SCAN_CONCURRENCY = 6;

async function filterDrugsByCrop(drugs, crop, onProgress) {
  const candidates = drugs.slice(0, CROP_SCAN_LIMIT);
  const hits = new Array(candidates.length).fill(null);
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < candidates.length) {
      const i = next++;
      const { ranges } = await rangesWithFallback(candidates[i]);
      // 用索引位置回填，結果才會保持原本的相關度排序。
      if (ranges.some((r) => matchesCrop(r, crop))) hits[i] = candidates[i];
      onProgress((done += 1), candidates.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CROP_SCAN_CONCURRENCY, candidates.length) }, worker),
  );

  return {
    matched: hits.filter(Boolean),
    scanned: candidates.length,
    truncated: drugs.length > CROP_SCAN_LIMIT,
  };
}

/** 只填作物時的備援：翻查這台裝置已經抓過使用範圍的藥劑。 */
async function searchCachedByCrop(crop) {
  const rows = await allCached();
  return rows
    .filter((r) => r.drug && Array.isArray(r.ranges) && r.ranges.some((x) => matchesCrop(x, crop)))
    .map((r) => r.drug);
}

/** 掃描進度直接改寫那一行小字，不重畫整頁，免得使用者的輸入框被重建。 */
function setSearchProgress(message) {
  const el = document.querySelector('#search-form small');
  if (el) el.textContent = message;
}

async function runMainSearch() {
  const query = state.search.query.trim();
  const crop = state.search.crop.trim();

  if (!query && !crop) {
    state.search.message = '請填藥劑名稱，或填作物';
    render();
    return;
  }
  if (query && query.length < 2) {
    state.search.message = '藥劑名稱請至少輸入兩個字';
    render();
    return;
  }

  state.search.loading = true;
  state.search.drugs = [];
  state.search.note = '';
  state.search.capped = false;
  state.search.filter = '';

  // 只填作物：官方端無法用作物搜尋，只能翻本機查過的。
  if (!query) {
    state.search.message = `正在翻查這台裝置查過的藥劑…`;
    render();
    const rows = await searchCachedByCrop(crop);
    state.search.drugs = rows;
    state.search.message = rows.length
      ? `找到 ${rows.length} 筆核准用於「${crop}」的藥劑`
      : `這台裝置還沒查過核准用於「${crop}」的藥劑`;
    state.search.note =
      '官方資料沒有辦法直接用作物搜尋，所以只填作物時，這裡翻的是這台裝置查過的藥。一併填入藥劑名稱可以查得更完整。';
    state.search.loading = false;
    render();
    return;
  }

  state.search.message = '正在翻閱官方登記資料…';
  render();

  try {
    const { rows, capped, fromCache } = await searchWithFallback(query);
    state.search.capped = capped;

    if (!crop) {
      state.search.drugs = rows;
      state.search.message = rows.length
        ? `找到 ${rows.length} 筆${fromCache ? '本機保存的' : '登記'}藥劑`
        : '沒有找到符合的藥劑';
      const notes = [];
      if (fromCache) notes.push('目前連不上官方資料，以下是這台裝置查過的藥劑。');
      if (capped) {
        notes.push(
          '官方單次最多只給這麼多筆，可能還有沒列出來的產品。找不到想要的廠牌時，直接用廠牌名稱查（例如「大卡稱」）最準。',
        );
      }
      state.search.note = notes.join('');
    } else {
      state.search.message = `找到 ${rows.length} 筆，正在逐一比對「${crop}」…`;
      render();

      const { matched, scanned, truncated } = await filterDrugsByCrop(rows, crop, (n, total) =>
        setSearchProgress(`正在比對「${crop}」…（${n}／${total}）`),
      );

      state.search.drugs = matched;
      state.search.message = matched.length
        ? `${scanned} 筆之中，有 ${matched.length} 筆核准用於「${crop}」`
        : `查到的 ${scanned} 筆藥劑都沒有核准用於「${crop}」`;

      const notes = [];
      if (fromCache) notes.push('目前連不上官方資料，以下是這台裝置查過的藥劑。');
      if (truncated) {
        notes.push(
          `藥劑名稱符合的有 ${rows.length} 筆，為了不讓查詢太慢，只比對了前 ${scanned} 筆。把藥劑名稱打得更完整可以縮小範圍。`,
        );
      }
      state.search.note = notes.join('');
    }
  } catch (error) {
    state.search.message = `${error.message}。這台裝置也還沒有查過符合的藥劑。`;
  } finally {
    state.search.loading = false;
    render();
  }
}

async function openDetail(drug) {
  state.overlay = { kind: 'detail', drug, ranges: [], loading: true, crop: '' };
  renderOverlay();
  const { ranges, status } = await rangesWithFallback(drug);
  if (state.overlay?.kind === 'detail') {
    state.overlay.ranges = ranges;
    state.overlay.rangeStatus = status;
    state.overlay.loading = false;
    renderOverlay();
  }
}

/** 一次掃幾支藥來判斷有沒有核准用於目前作物。每一支都是一次網路請求。 */
const APPROVAL_SCAN_LIMIT = 40;
const APPROVAL_SCAN_CONCURRENCY = 6;

const approvalRank = (a) => (a === 'yes' ? 0 : a === undefined ? 1 : a === 'no' ? 2 : 3);

/** 篩選後的可見結果。 */
function refreshVisible(item) {
  item.visible = filterDrugs(item.results, item.filter);
}

/** 只重畫這張藥劑卡的結果清單，並保住捲動位置。 */
function renderItemResultsOnly(item) {
  const holder = screenEl.querySelector(`[data-results="${item.id}"]`);
  if (!holder) return;
  const keep = holder.querySelector('.result-list')?.scrollTop ?? 0;
  holder.innerHTML = itemResultsHtml(item, state.calc.crop.trim());
  const list = holder.querySelector('.result-list');
  if (list) list.scrollTop = keep;
}

/**
 * 幫搜尋結果標上「有沒有核准用於這個作物」，並把已核准的排到前面。
 *
 * 每一支藥都要單獨發一次請求，所以只能掃前 APPROVAL_SCAN_LIMIT 支。
 * 掃描期間標記逐一浮現、順序不動（正在看的清單被抽換很惱人），
 * 全部掃完才重排一次。畫面上一定要寫清楚掃到第幾支 ——
 * 一個只保證前面幾支準確的「已核准優先」，比不排序更會誤導人。
 */
async function scanApprovals(item, crop) {
  const candidates = item.results.slice(0, APPROVAL_SCAN_LIMIT);
  if (!crop || !candidates.length) return;

  item.approvalOf = {};
  item.scanning = true;
  item.scanned = 0;
  item.scanTotal = candidates.length;
  renderItemResultsOnly(item);

  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const drug = candidates[next++];
      const { ranges, status } = await rangesWithFallback(drug);
      // 讀不到就不標：不知道不等於未核准。
      if (status === 'ok') {
        item.approvalOf[license(drug)] = ranges.some((r) => matchesCrop(r, crop)) ? 'yes' : 'no';
      } else if (status !== 'failed') {
        item.approvalOf[license(drug)] = 'none';
      }
      item.scanned += 1;
      renderItemResultsOnly(item);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(APPROVAL_SCAN_CONCURRENCY, candidates.length) }, worker),
  );

  // 已核准的排前面；同樣核准時，有效的排在過期與撤銷的前面。
  // 把一張 2017 年就到期的許可證推到第一名，等於在推薦一個買不到也不該用的東西。
  item.results = item.results
    .map((drug, i) => ({
      drug,
      approval: approvalRank(item.approvalOf[license(drug)]),
      status: statusRank(drug),
      i,
    }))
    .sort((a, b) => a.approval - b.approval || a.status - b.status || a.i - b.i)
    .map((o) => o.drug);

  item.scanning = false;
  refreshVisible(item);
  renderItemResultsOnly(item);
}

async function runItemSearch(item) {
  if (item.query.trim().length < 2) {
    item.error = '請至少輸入兩個字';
    render();
    return;
  }

  item.loading = true;
  item.error = '';
  item.filter = '';
  item.approvalOf = {};
  item.scanTotal = 0;
  render();

  try {
    const { rows, capped, fromCache } = await searchWithFallback(item.query);
    item.results = rows;
    refreshVisible(item);
    const notes = [];
    if (fromCache) notes.push('目前連不上官方資料，以下是本機保存的藥劑。');
    if (capped) notes.push('官方單次只給這麼多筆，可能還有沒列出來的產品；直接用廠牌名稱查會更準。');
    item.error = notes.join('');
    item.loading = false;
    render();
    await scanApprovals(item, state.calc.crop.trim());
  } catch (error) {
    item.error = error.message;
    item.loading = false;
    render();
  }
}

async function pickItemDrug(item, drug) {
  item.drug = drug;
  item.results = [];
  item.visible = [];
  item.loading = true;
  item.error = '';
  render();

  const { ranges, status } = await rangesWithFallback(drug);
  const matched = ranges.filter((r) => matchesCrop(r, state.calc.crop));

  // 沒對上作物時仍然列出全部用途，並標記起來讓畫面說明狀況。
  item.ranges = matched.length ? matched : ranges;
  item.selected = 0;
  item.rangeStatus = status;
  item.cropMissing = status === 'ok' && !matched.length;
  item.loading = false;
  render();
}

/* ------------------------------------------------------------------ */
/* 常用藥劑                                                            */
/* ------------------------------------------------------------------ */

/** 「最近用過」最多列幾支。釘選的沒有上限，因為那是使用者自己挑的。 */
const RECENT_DRUG_LIMIT = 10;

/**
 * 下拉選單的內容：手動釘選的排上面，施作紀錄自動累積的「最近用過」排下面。
 * 只放名稱與許可證號，真正的官方資料等到選取時才從快取取出，
 * 這樣釘選清單不會保存到過期的用法。
 */
function favoriteOptions() {
  const pinnedKeys = new Set(state.favorites.map((f) => f.key));
  const pinned = state.favorites.map((f) => ({ key: f.key, name: f.name || f.key }));

  const seen = new Map();
  // state.applications 已經是日期新到舊，所以第一次遇到的就是最近一次。
  for (const app of state.applications) {
    for (const drug of app.drugs) {
      if (!drug.license || pinnedKeys.has(drug.license) || seen.has(drug.license)) continue;
      seen.set(drug.license, { key: drug.license, name: drug.name || drug.license });
    }
  }

  return { pinned, recent: [...seen.values()].slice(0, RECENT_DRUG_LIMIT) };
}

async function pickFavorite(item, key) {
  const drug = state.favorites.find((f) => f.key === key)?.drug || (await getCached(key))?.drug;

  if (!drug) {
    // 換手機匯入備份後會發生：紀錄裡有這支藥，但官方資料沒跟著過來。
    toast('這台裝置沒有保存這支藥的官方資料，請用下面的欄位查一次');
    render();
    return;
  }

  pickItemDrug(item, drug);
}

async function toggleFavorite() {
  const drug = state.overlay?.drug;
  if (!drug) return;

  const key = license(drug);
  const pinned = state.favorites.some((f) => f.key === key);

  try {
    if (pinned) await removeFavorite(key);
    else await addFavorite(key, drug);
    state.favorites = await listFavorites();
    renderOverlay();
    render();
    toast(pinned ? '已取消釘選' : '已加入常用藥劑');
  } catch (error) {
    toast(`存不進去：${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* 土地                                                                */
/* ------------------------------------------------------------------ */

async function reloadFields() {
  try {
    state.fields = await listFields();
  } catch (error) {
    state.dbError = `${error.message}。`;
  }
}

function pickField(id) {
  const field = state.fields.find((f) => f.id === id);
  if (!field) return;
  state.calc.fieldId = state.calc.fieldId === id ? '' : id;
  if (state.calc.fieldId) {
    state.calc.area = field.area;
    state.calc.areaUnit = field.unit;
    if (field.crop) state.calc.crop = field.crop;
  }
  render();
}

async function saveFieldForm() {
  const form = state.overlay.form;
  if (!form.name.trim()) {
    form.error = '請輸入土地名稱';
    renderOverlay();
    return;
  }
  if (!(Number(form.area) > 0)) {
    form.error = '面積要填一個大於零的數字';
    renderOverlay();
    return;
  }

  try {
    await saveField(form);
    await reloadFields();
    state.overlay = { kind: 'fields' };
    renderOverlay();
    render();
  } catch (error) {
    form.error = `存不進去：${error.message}`;
    renderOverlay();
  }
}

/* ------------------------------------------------------------------ */
/* 施作紀錄                                                            */
/* ------------------------------------------------------------------ */

async function reloadApplications() {
  try {
    state.applications = await listApplications();
  } catch (error) {
    state.dbError = `${error.message}。`;
  }
}

const round1 = (n) => String(Math.round(n * 10) / 10);

/** 依目前試算結果，替一種藥劑準備預填的實際用量與參考值。 */
function suggestAmount(range) {
  const result = calcRange(
    text(range['每公頃使用用藥量']),
    text(range['稀釋倍數']),
    areaHa(),
    waterLiters(),
  );

  if (result.kind === 'cross' && result.agreed) {
    return { amount: round1(result.agreed.min), unit: result.base, suggestion: formatRange(result.agreed, result.base) };
  }
  if (result.kind === 'cross') {
    return { amount: '', unit: result.base, suggestion: `用水量需調整到 ${formatWater(result.suggestedWater)}` };
  }
  if (result.kind === 'area-only') {
    return { amount: round1(result.byArea.min), unit: result.base, suggestion: formatRange(result.byArea, result.base) };
  }
  if (result.kind === 'water-only') {
    return { amount: round1(result.byWater.min), unit: '公克', suggestion: `${round1(result.byWater.min)} 公克或毫升` };
  }
  return { amount: '', unit: '公克', suggestion: '' };
}

function recomputeHarvest(draft) {
  const info = harvestInfo(draft.date, draft.drugs);
  draft.harvestDate = info.date;
  draft.harvestDays = info.days;
  draft.harvestUnknown = info.unknown;
}

function openRecordForm() {
  // 只要選了藥就能記錄，即使查不到核准範圍 —— 那些欄位留空由使用者自己填。
  const items = state.calc.items.filter((i) => i.drug);
  if (!items.length) return;

  const field = state.fields.find((f) => f.id === state.calc.fieldId);

  const drugs = items.map((item) => {
    const range = item.ranges[item.selected];
    const { amount, unit, suggestion } = range
      ? suggestAmount(range)
      : { amount: '', unit: '公克', suggestion: '' };

    return {
      name: drugTitle(item.drug),
      license: license(item.drug),
      ingredient: text(item.drug['化學成分']),
      maker: text(item.drug['廠商名稱']),
      target: range ? text(range['病蟲害名稱']) : '',
      cropOfficial: range ? text(range['作物名稱']) : '',
      dilution: range ? text(range['稀釋倍數']) : '',
      dosePerHa: range ? text(range['每公頃使用用藥量']) : '',
      phi: range ? text(range['安全採收期']) : '',
      interval: range ? text(range['施藥間隔']) : '',
      offLabel: item.cropMissing || !range,
      amount,
      amountUnit: unit,
      water: '',
      suggestion,
    };
  });

  const now = new Date();
  const draft = {
    id: null,
    date: todayKey(),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    fieldId: state.calc.fieldId,
    fieldName: field?.name || '',
    crop: state.calc.crop,
    area: state.calc.area,
    unit: state.calc.areaUnit,
    mode: drugs.length > 1 ? 'tank' : 'tank',
    water: state.calc.water,
    drugs,
    additives: [],
    note: '',
    error: '',
  };

  recomputeHarvest(draft);
  state.overlay = { kind: 'record-form', draft };
  renderOverlay();
}

function openRecordFormForEdit(app) {
  const draft = {
    ...app,
    drugs: app.drugs.map((d) => ({ ...d })),
    additives: (app.additives || []).map((a) => ({ ...a })),
    error: '',
  };
  recomputeHarvest(draft);
  state.overlay = { kind: 'record-form', draft };
  renderOverlay();
}

async function saveRecord() {
  const draft = state.overlay.draft;

  if (!draft.date) {
    draft.error = '請選施作日期';
    renderOverlay();
    return;
  }
  if (!draft.fieldName.trim()) {
    draft.error = '請填土地名稱，之後查紀錄才找得到';
    renderOverlay();
    return;
  }
  if (draft.drugs.some((d) => !(Number(d.amount) > 0))) {
    draft.error = '每一種藥劑都要填實際用量';
    renderOverlay();
    return;
  }
  if (draft.mode === 'tank' && !(Number(draft.water) > 0)) {
    draft.error = '同桶混用要填實際總用水量';
    renderOverlay();
    return;
  }
  if (draft.mode === 'separate' && draft.drugs.some((d) => !(Number(d.water) > 0))) {
    draft.error = '分開施用時，每一次都要填自己的用水量';
    renderOverlay();
    return;
  }

  recomputeHarvest(draft);

  const record = {
    id: draft.id || undefined,
    createdAt: draft.createdAt,
    date: draft.date,
    time: draft.time,
    fieldId: draft.fieldId,
    fieldName: draft.fieldName.trim(),
    crop: draft.crop.trim(),
    area: draft.area,
    unit: draft.unit,
    areaHa: toHectares(Number(draft.area) || 0, draft.unit),
    mode: draft.mode,
    water: draft.mode === 'tank' ? Number(draft.water) : null,
    drugs: draft.drugs.map((d) => ({
      name: d.name,
      license: d.license,
      ingredient: d.ingredient,
      target: d.target,
      dilution: d.dilution,
      dosePerHa: d.dosePerHa,
      phi: d.phi,
      interval: d.interval,
      amount: String(d.amount),
      amountUnit: d.amountUnit,
      water: draft.mode === 'separate' ? Number(d.water) : null,
    })),
    additives: draft.additives
      .filter((a) => a.name.trim())
      .map((a) => ({
        name: a.name.trim(),
        amount: String(a.amount || '').trim(),
        unit: String(a.unit || '').trim(),
        note: String(a.note || '').trim(),
      })),
    note: draft.note.trim(),
    harvestDate: draft.harvestDate,
    harvestDays: draft.harvestDays,
    harvestUnknown: draft.harvestUnknown,
  };

  try {
    const saved = await saveApplication(record);
    await reloadApplications();
    state.tab = 'records';
    state.records.month = new Date(...saved.date.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
    state.records.selected = saved.date;
    state.overlay = { kind: 'record-detail', id: saved.id };
    render();
    toast('已保存到這支手機');
  } catch (error) {
    draft.error = `存不進去：${error.message}`;
    renderOverlay();
  }
}

/* ------------------------------------------------------------------ */
/* 輸出：剪貼簿、行事曆、備份                                          */
/* ------------------------------------------------------------------ */

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // 舊版瀏覽器或權限被擋時的備援
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 讓瀏覽器把內容存成檔案。
 *
 * 注意：部分 Chromium 版本遇到含中文的 download 屬性會整個放棄，
 * 存成沒有副檔名的 "download"。備份檔用中文（使用者要在檔案 App 裡找得到），
 * 行事曆檔用英數字（副檔名掉了就完全打不開）。
 */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  // 連結與網址都要等下載真的開始才移除，太早清掉檔名會變成預設的 "download"。
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}

async function doExportBackup() {
  try {
    const data = await exportBackup();
    downloadFile(`田間用藥${todayKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('備份已下載');
  } catch (error) {
    notice('匯出失敗', error.message);
  }
}

async function doImportBackup(file) {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    await Promise.all([reloadFields(), reloadApplications()]);
  state.favorites = await listFavorites();
    render();
    notice('匯入完成', `已寫入 ${result.fields} 筆土地與 ${result.applications} 筆施作紀錄。相同的紀錄會被覆寫，本機原有而備份沒有的資料會保留。`);
  } catch (error) {
    notice('匯入失敗', error instanceof SyntaxError ? '這個檔案不是有效的備份檔。' : error.message);
  }
}

/* ------------------------------------------------------------------ */
/* 安裝                                                                */
/* ------------------------------------------------------------------ */

async function install() {
  const prompt = state.installPrompt;
  if (prompt && typeof prompt.prompt === 'function') {
    await prompt.prompt();
    state.overlay = null;
    renderOverlay();
  } else {
    // iOS 沒有 beforeinstallprompt，只能給手動加入主畫面的說明。
    state.overlay = { kind: 'modal', modal: 'install' };
    renderOverlay();
  }
}

function closeOverlay() {
  if (state.overlay?.kind === 'modal' && state.overlay.modal === 'release') {
    // 關掉更新說明才算「看過」，中途離開下次還會再提醒一次。
    store.set('seen-version', VERSION);
  }
  state.overlay = null;
  renderOverlay();
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

const ACTIONS = {
  tab: (d) => {
    state.tab = d.tab;
    render();
  },

  /* 查詢 */
  'open-detail': (d) => openDetail(state.search.drugs[Number(d.idx)]),

  /* 試算 */
  'add-item': () => {
    state.calc.items.push(emptyItem());
    render();
  },
  'item-remove': (d) => {
    state.calc.items = state.calc.items.filter((i) => i.id !== Number(d.id));
    render();
  },
  'item-search': (d) => runItemSearch(findItem(d.id)),
  'item-pick': (d) => {
    const item = findItem(d.id);
    const drug = item.results.find((x) => license(x) === d.key);
    if (drug) pickItemDrug(item, drug);
  },
  'item-reset': (d) => {
    Object.assign(findItem(d.id), {
      drug: null,
      ranges: [],
      query: '',
      filter: '',
      results: [],
      visible: [],
      approvalOf: {},
      scanTotal: 0,
      error: '',
      selected: 0,
    });
    render();
  },

  /* 土地 */
  'open-fields': () => {
    state.overlay = { kind: 'fields' };
    renderOverlay();
  },
  'new-field': () => {
    state.overlay = { kind: 'field-form', form: { id: null, name: '', area: '', unit: 'fen', crop: '', error: '' } };
    renderOverlay();
  },
  'edit-field': (d) => {
    const field = state.fields.find((f) => f.id === d.id);
    state.overlay = { kind: 'field-form', form: { ...field, error: '' } };
    renderOverlay();
  },
  'save-field': () => saveFieldForm(),
  'delete-field': async (d) => {
    await deleteField(d.id);
    if (state.calc.fieldId === d.id) state.calc.fieldId = '';
    await reloadFields();
    renderOverlay();
    render();
  },
  'pick-field': (d) => pickField(d.id),

  /* 紀錄 */
  'open-record-form': () => openRecordForm(),
  'record-mode': (d) => {
    state.overlay.draft.mode = d.mode;
    renderOverlay();
  },
  'record-drug-remove': (d) => {
    const draft = state.overlay.draft;
    draft.drugs.splice(Number(d.idx), 1);
    recomputeHarvest(draft);
    renderOverlay();
  },
  'additive-add': () => {
    state.overlay.draft.additives.push({ name: '', amount: '', unit: '', note: '' });
    renderOverlay();
  },
  'additive-remove': (d) => {
    state.overlay.draft.additives.splice(Number(d.idx), 1);
    renderOverlay();
  },
  'save-record': () => saveRecord(),
  'open-record': (d) => {
    state.overlay = { kind: 'record-detail', id: d.id };
    renderOverlay();
  },
  'edit-record': (d) => openRecordFormForEdit(findApp(d.id)),
  'delete-record': () => {
    state.overlay.confirmDelete = true;
    renderOverlay();
  },
  'delete-record-cancel': () => {
    state.overlay.confirmDelete = false;
    renderOverlay();
  },
  'delete-record-confirm': async (d) => {
    await deleteApplication(d.id);
    await reloadApplications();
    state.overlay = null;
    render();
    toast('已刪除');
  },

  /* 月曆 */
  'month-prev': () => {
    const m = state.records.month;
    state.records.month = new Date(m.getFullYear(), m.getMonth() - 1, 1);
    render();
  },
  'month-next': () => {
    const m = state.records.month;
    state.records.month = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    render();
  },
  'pick-date': (d) => {
    state.records.selected = state.records.selected === d.date ? null : d.date;
    render();
  },
  'clear-date': () => {
    state.records.selected = null;
    render();
  },

  /* 輸出 */
  'copy-record': async (d) => {
    const ok = await copyText(buildRecordText(findApp(d.id)));
    toast(ok ? '已複製，可以貼到行事曆備註' : '複製失敗，請手動選取');
  },
  'download-ics': (d) => {
    const app = findApp(d.id);
    downloadFile(`spray-${app.date}.ics`, buildIcs(app), 'text/calendar;charset=utf-8');
    toast('已下載，開啟檔案即可加入行事曆');
  },
  'open-google-calendar': (d) => {
    window.open(googleCalendarUrl(findApp(d.id)), '_blank', 'noopener');
  },
  'export-backup': () => doExportBackup(),
  'import-backup': () => fileInput.click(),

  'toggle-favorite': () => toggleFavorite(),

  /* 其他 */
  install: () => install(),
  modal: (d) => {
    state.overlay = { kind: 'modal', modal: d.modal };
    renderOverlay();
  },
  'close-overlay': () => closeOverlay(),
};

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  // 點背景關閉時，只有點到背景本身才算，點到面板內容不算。
  if (target.classList.contains('sheet-backdrop') && event.target !== target) return;

  const handler = ACTIONS[target.dataset.action];
  if (handler) handler(target.dataset);
});

document.addEventListener('input', (event) => {
  const { field, id, idx } = event.target.dataset;
  if (!field) return;
  const value = event.target.value;
  const draft = state.overlay?.draft;
  const form = state.overlay?.form;

  switch (field) {
    case 'search-query':
      state.search.query = value;
      break;
    case 'search-crop':
      state.search.crop = value;
      break;
    case 'search-filter':
      state.search.filter = value;
      renderSearchResultsOnly();
      break;
    case 'item-query':
      findItem(id).query = value;
      break;
    case 'item-filter': {
      const item = findItem(id);
      item.filter = value;
      refreshVisible(item);
      renderItemResultsOnly(item);
      break;
    }
    case 'detail-crop':
      state.overlay.crop = value;
      renderDetailRangesOnly();
      break;
    case 'crop':
      state.calc.crop = value;
      break;
    case 'area':
    case 'water':
      state.calc[field] = value;
      renderOutputsOnly();
      break;

    case 'field-name':
      form.name = value;
      break;
    case 'field-area':
      form.area = value;
      break;
    case 'field-crop':
      form.crop = value;
      break;

    case 'record-field-name':
      draft.fieldName = value;
      break;
    case 'record-crop':
      draft.crop = value;
      break;
    case 'record-area':
      draft.area = value;
      break;
    case 'record-water':
      draft.water = value;
      break;
    case 'record-note':
      draft.note = value;
      break;
    case 'record-time':
      draft.time = value;
      break;
    case 'record-amount':
      draft.drugs[Number(idx)].amount = value;
      break;
    case 'record-drug-water':
      draft.drugs[Number(idx)].water = value;
      break;
    case 'additive-name':
      draft.additives[Number(idx)].name = value;
      break;
    case 'additive-amount':
      draft.additives[Number(idx)].amount = value;
      break;
    case 'additive-unit':
      draft.additives[Number(idx)].unit = value;
      break;
    case 'additive-note':
      draft.additives[Number(idx)].note = value;
      break;
    default:
      break;
  }
});

document.addEventListener('change', (event) => {
  const { field, id, idx } = event.target.dataset;
  const value = event.target.value;
  const draft = state.overlay?.draft;

  if (field === 'areaUnit') {
    state.calc.areaUnit = value;
    renderOutputsOnly();
  } else if (field === 'item-range') {
    findItem(id).selected = Number(value);
    renderOutputsOnly();
  } else if (field === 'item-favorite') {
    if (value) pickFavorite(findItem(id), value);
  } else if (field === 'filter-field') {
    state.records.filterFieldId = value;
    render();
  } else if (field === 'field-unit') {
    state.overlay.form.unit = value;
  } else if (field === 'record-unit') {
    draft.unit = value;
  } else if (field === 'record-amount-unit') {
    draft.drugs[Number(idx)].amountUnit = value;
  } else if (field === 'record-date') {
    // 日期變了，參考採收日要跟著重算。
    draft.date = value;
    recomputeHarvest(draft);
    renderOverlay();
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'search-form') {
    event.preventDefault();
    runMainSearch();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.overlay) {
    closeOverlay();
    return;
  }
  if (event.key === 'Enter' && event.target.dataset.field === 'item-query') {
    event.preventDefault();
    runItemSearch(findItem(event.target.dataset.id));
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) doImportBackup(file);
  fileInput.value = '';
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
});

/* ------------------------------------------------------------------ */
/* 啟動                                                                */
/* ------------------------------------------------------------------ */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

if (store.get('seen-version') !== VERSION) {
  state.overlay = { kind: 'modal', modal: 'release' };
}

render();

(async () => {
  if (!dbAvailable) state.dbError = '這個瀏覽器不允許本機資料庫。';
  await Promise.all([reloadFields(), reloadApplications()]);
  state.favorites = await listFavorites();
  const persistence = await requestPersistence();
  state.persisted = persistence.persisted;
  render();
})();
