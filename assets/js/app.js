import { parseDose, toBaseDose, toHectares } from './calc.js';
import { syncItemCrop } from './calc-state.js';
import {
  addFavorite,
  allCached,
  cachedRangesIfFresh,
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
  newId,
  removeFavorite,
  requestPersistence,
  saveApplication,
  saveField,
  searchCachedDrugs,
} from './db.js';
import { drugTitle, filterDrugs, license, loadRanges, matchesCrop, scanDrugsByCrop, searchDrugs, statusRank, text } from './moa.js';
import {
  buildIcs,
  buildRecordText,
  googleCalendarUrl,
  harvestInfo,
  harvestOverview,
  matchingRecordRanges,
  legacyRecordRange,
  recordWater,
  todayKey,
  verifiedRecordRange,
} from './records.js';
import {
  calcViewHtml,
  calcItemsHtml,
  conversionText,
  customDilutionHtml,
  detailHtml,
  fieldFormHtml,
  favoritesSheetHtml,
  fieldsSheetHtml,
  itemOutputHtml,
  itemResultsHtml,
  modalHtml,
  recordDetailHtml,
  recordFormHtml,
  recordGuidanceHtml,
  recordReviewHtml,
  recordsViewHtml,
  searchResultsHtml,
  searchViewHtml,
  settingsViewHtml,
  toastHtml,
} from './views.js';

/* ------------------------------------------------------------------ */
/* 常數                                                                */
/* ------------------------------------------------------------------ */

const VERSION = 'v1.6.8';
const LINE_URL = 'https://line.me/ti/p/7OorqI3Zzk';
const APHIA_URL = 'https://pesticide.aphia.gov.tw/information/';

/** 一次最多畫幾張結果卡。再多手機捲起來會卡，用結果篩選欄縮小範圍即可。 */
const SEARCH_DISPLAY_LIMIT = 120;

/** 本機儲存的專屬前綴，避免與同帳號的其他 GitHub Pages 站台互相干擾。 */
const APP_ID = 'field-meds';

/** 搜尋比對先使用 24 小時內的本機範圍；真正點開或選用時仍向官方確認。 */
const RANGE_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

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
  allRanges: [],
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
  records: { month: new Date(), selected: null, filterFieldId: '', query: '', from: '', to: '' },
  recordDraft: readRecordDraft(),
  lastBackup: store.get('last-backup') || '',
  fields: [],
  applications: [],
  favorites: [],
  favoritesExpanded: false,
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
      favorites: favoriteOptions(),
    });
  },
  calc: () => calcViewHtml(state.calc, state.fields, areaHa(), canRecord(), favoriteOptions()),
  records: () =>
    recordsViewHtml({
      month: state.records.month,
      applications: state.applications,
      selected: state.records.selected,
      ...harvestOverview(state.applications),
      draftAvailable: Boolean(state.recordDraft),
      query: state.records.query,
      from: state.records.from,
      to: state.records.to,
      filterFieldId: state.records.filterFieldId,
      fields: state.fields,
    }),
  settings: () =>
    settingsViewHtml({
      version: VERSION,
      lastBackup: state.lastBackup,
      aphiaUrl: APHIA_URL,
      lineUrl: LINE_URL,
      fieldCount: state.fields.length,
      favoriteCount: state.favorites.length,
      appCount: state.applications.length,
      persisted: state.persisted,
      dbError: state.dbError,
    }),
};

// 保留篩選欄位的 DOM，避免原生日曆在輸入過程中失去焦點。
function refreshRecordSearchResults() {
  const results = screenEl.querySelector('[data-record-search-results]');
  if (!results) return;
  const next = document.createElement('template');
  next.innerHTML = views.records();
  results.replaceWith(next.content.querySelector('[data-record-search-results]'));
  const clear = screenEl.querySelector('[data-action="clear-record-search"]');
  if (clear) clear.disabled = !(state.records.query || state.records.from || state.records.to);
}

let renderedTab;

/** 重畫整個分頁。使用者正在打字時不要呼叫，游標會跑掉。 */
function render() {
  const favoritesPanel = screenEl.querySelector('[data-favorites-panel]');
  if (favoritesPanel) state.favoritesExpanded = favoritesPanel.open;
  screenEl.innerHTML = views[state.tab]();
  if (renderedTab !== state.tab) screenEl.scrollTop = 0;
  renderedTab = state.tab;
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
    overlayEl.innerHTML = fieldFormHtml(o.form, state.fields, favoriteOptions().pinned, Boolean(o.returnTo));
  } else if (o.kind === 'favorites') {
    overlayEl.innerHTML = favoritesSheetHtml(favoriteOptions().pinned);
  } else if (o.kind === 'record-form') {
    persistRecordDraft(o.draft);
    const field = state.fields.find((entry) => entry.id === o.draft.fieldId);
    const history = field ? state.applications.filter((app) => app.fieldId === field.id) : [];
    overlayEl.innerHTML = recordFormHtml(o.draft, recentAdditiveOptions(), state.fields, {
      ...favoriteOptions(), templates: field?.templates || [], history, canEditTemplates: Boolean(field),
      historyQuery: o.historyQuery || '',
      saving: o.saving,
    });
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

/** 只更新施作卡片裡的面積用量參考與實際濃度警示，保留正在輸入的游標。 */
function renderRecordGuidanceOnly() {
  if (state.overlay?.kind !== 'record-form') return;
  const { draft } = state.overlay;
  draft.drugs.forEach((drug, index) => {
    const holder = overlayEl.querySelector(`[data-record-guidance="${index}"]`);
    if (holder) holder.innerHTML = recordGuidanceHtml(draft, drug);
  });
}

function renderRecordReviewOnly(draft) {
  const holder = overlayEl.querySelector('[data-record-review]');
  if (holder) holder.innerHTML = recordReviewHtml(draft);
}

function updateBucketTotal(draft) {
  const waterInput = overlayEl.querySelector('[data-field="record-water"]');
  if (waterInput && draft.buckets?.length) waterInput.value = recordWater(draft);
}

/** 自訂配方輸入時只更新實際稀釋資訊，避免整張表單重畫而中斷打字。 */
function renderCustomDilutionsOnly() {
  if (state.overlay?.kind !== 'record-form') return;
  const { draft } = state.overlay;
  const customOnly = !(draft.drugs || []).length;
  if (!customOnly) return;

  (draft.additives || []).forEach((additive, index) => {
    const holder = overlayEl.querySelector(`[data-custom-dilution="${index}"]`);
    if (holder) holder.innerHTML = customDilutionHtml(draft, additive);
  });
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
const officialRangeRequests = new Map();

/** 同一張許可證同時只向官方請求一次，搜尋與點開明細不會重複排隊。 */
function loadOfficialRangesOnce(drug, key) {
  const requestKey = key || text(drug['農藥使用範圍']);
  if (requestKey && officialRangeRequests.has(requestKey)) return officialRangeRequests.get(requestKey);

  const request = loadRanges(drug)
    .then(({ ranges, status }) => {
      if (key && status !== 'failed') cacheRanges(key, ranges, status);
      return { ranges, status, fromCache: false };
    })
    .finally(() => {
      if (requestKey) officialRangeRequests.delete(requestKey);
    });

  if (requestKey) officialRangeRequests.set(requestKey, request);
  return request;
}

async function rangesWithFallback(drug, { forceNetwork = false } = {}) {
  const key = license(drug);
  const cached = key ? await getCached(key) : null;

  if (!forceNetwork) {
    const fresh = cachedRangesIfFresh(cached, RANGE_CACHE_MAX_AGE);
    if (fresh) return fresh;
  }

  try {
    const result = await loadOfficialRangesOnce(drug, key);
    if (result.status === 'failed' && cached?.ranges?.length) {
      return { ranges: cached.ranges, status: 'ok', fromCache: true, stale: true };
    }
    return result;
  } catch {
    if (cached?.ranges?.length) return { ranges: cached.ranges, status: 'ok', fromCache: true, stale: true };
    return { ranges: [], status: 'failed' };
  }
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

      const progressive = new Map();
      let revealTimer = null;
      const revealMatches = () => {
        state.search.drugs = [...progressive.values()]
          .sort((a, b) => a.index - b.index)
          .map((entry) => entry.drug);
        renderSearchResultsOnly();
        revealTimer = null;
      };

      const { matched, scanned, failed, cached, stale } = await scanDrugsByCrop(
        rows,
        crop,
        rangesWithFallback,
        {
          concurrency: 10,
          onProgress: (n, total) => setSearchProgress(`正在完整比對「${crop}」…（${n}／${total}）`),
          onMatch: (drug, index) => {
            progressive.set(license(drug), { drug, index });
            if (!revealTimer) revealTimer = setTimeout(revealMatches, 120);
          },
        },
      );

      if (revealTimer) clearTimeout(revealTimer);

      state.search.drugs = matched;
      state.search.message = matched.length
        ? `完整比對 ${scanned} 筆，其中 ${matched.length} 筆核准用於「${crop}」`
        : failed
          ? `已比對 ${scanned} 筆，但有 ${failed} 筆使用範圍無法確認，暫時不能判定「${crop}」是否核准`
          : `完整比對的 ${scanned} 筆藥劑都沒有核准用於「${crop}」`;

      const notes = [];
      if (cached) notes.push(`其中 ${cached} 筆使用 24 小時內的本機資料加速比對；點開明細或選用時會再向官方確認。`);
      if (stale) notes.push(`另有 ${stale} 筆因官方暫時讀不到，使用較早保存的範圍；點開前請特別核對產品標示。`);
      if (fromCache) notes.push('目前連不上官方資料，以下是這台裝置查過的藥劑。');
      if (failed) {
        notes.push(
          `其中 ${failed} 筆使用範圍暫時讀不到，沒有把未知狀態誤標成未核准，稍後可再查一次。`,
        );
      }
      if (capped) notes.push('官方藥劑主清單已達單次回傳上限，可能仍有未取得的登記產品。');
      state.search.note = notes.join('');
    }
  } catch (error) {
    state.search.message = `${error.message}。這台裝置也還沒有查過符合的藥劑。`;
  } finally {
    state.search.loading = false;
    render();
  }
}

async function openDetail(drug, returnTo = null) {
  const detail = { kind: 'detail', drug, ranges: [], loading: true, crop: '', returnTo };
  state.overlay = detail;
  renderOverlay();
  const { ranges, status } = await rangesWithFallback(drug, { forceNetwork: true });
  if (state.overlay === detail) {
    state.overlay.ranges = ranges;
    state.overlay.rangeStatus = status;
    state.overlay.loading = false;
    renderOverlay();
  }
}

/** 一次掃幾支藥來判斷有沒有核准用於目前作物。每一支都是一次網路請求。 */
const APPROVAL_SCAN_LIMIT = 40;
const APPROVAL_SCAN_CONCURRENCY = 8;

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
  const scanToken = item.scanToken = (item.scanToken || 0) + 1;
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
      if (item.scanToken !== scanToken) return;
      // 讀不到就不標：不知道不等於未核准。
      if (status === 'ok') {
        item.approvalOf[license(drug)] = ranges.some((r) => matchesCrop(r, crop)) ? 'yes' : 'no';
      } else if (status !== 'failed') {
        item.approvalOf[license(drug)] = 'none';
      }
      item.scanned += 1;
      // 快取命中時可能一瞬間完成很多筆；每四筆重畫一次，避免手機反覆重建整份清單。
      if (item.scanned % 4 === 0 || item.scanned === item.scanTotal) renderItemResultsOnly(item);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(APPROVAL_SCAN_CONCURRENCY, candidates.length) }, worker),
  );

  if (item.scanToken !== scanToken) return;

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

  const { ranges, status } = await rangesWithFallback(drug, { forceNetwork: true });
  if (item.drug !== drug || findItem(item.id) !== item) return;

  // 沒對上作物時仍然列出全部用途，並標記起來讓畫面說明狀況。
  item.allRanges = ranges;
  item.ranges = [];
  item.selected = 0;
  item.rangeStatus = status;
  syncItemCrop(item, state.calc.crop);
  item.loading = false;
  render();
}

function syncCalcCrop() {
  for (const item of state.calc.items) {
    if (item.drug) syncItemCrop(item, state.calc.crop);
    item.scanToken = (item.scanToken || 0) + 1;
    item.approvalOf = {};
    item.scanning = false;
    item.scanned = 0;
    item.scanTotal = 0;
  }
  // 只更新藥劑區，保留作物輸入框、游標及中文輸入狀態。
  const holder = document.getElementById('calc-items');
  if (holder) holder.innerHTML = calcItemsHtml(state.calc, areaHa(), favoriteOptions());
  for (const item of state.calc.items) {
    if (item.results.length && state.calc.crop.trim()) scanApprovals(item, state.calc.crop.trim());
  }
}

async function removePinnedFavorite(key) {
  if (!state.favorites.some((favorite) => favorite.key === key)) return;
  try {
    await removeFavorite(key);
    state.favorites = await listFavorites();
    render();
    toast('已移除常用，施作紀錄仍保留');
  } catch (error) {
    toast(`無法移除：${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* 常用藥劑                                                            */
/* ------------------------------------------------------------------ */

/** 「最近用過」最多列幾支。釘選的沒有上限，因為那是使用者自己挑的。 */
const RECENT_DRUG_LIMIT = 10;
const RECENT_ADDITIVE_LIMIT = 12;

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
    for (const drug of app.drugs || []) {
      if (!drug.license || pinnedKeys.has(drug.license) || seen.has(drug.license)) continue;
      seen.set(drug.license, { key: drug.license, name: drug.name || drug.license });
    }
  }

  return { pinned, recent: [...seen.values()].slice(0, RECENT_DRUG_LIMIT), expanded: state.favoritesExpanded, draftDrugs: state.recordDraft?.drugs, editingRecord: Boolean(state.recordDraft?.createdAt) };
}

/** 過去真正保存過的添加物才列為常用；只帶名稱與單位，不沿用上次用量。 */
function recentAdditiveOptions() {
  const seen = new Map();
  for (const app of state.applications) {
    for (const additive of app.additives || []) {
      const name = String(additive.name || '').trim();
      const key = name.replace(/\s+/g, '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.set(key, { name, unit: String(additive.unit || '').trim() });
    }
  }
  return [...seen.values()].slice(0, RECENT_ADDITIVE_LIMIT);
}

async function pickFavorite(item, key) {
  const drug = rememberedDrug(key) || (await getCached(key))?.drug;

  if (!drug) {
    // 換手機匯入備份後會發生：紀錄裡有這支藥，但官方資料沒跟著過來。
    toast('這台裝置沒有保存這支藥的官方資料，請用下面的欄位查一次');
    render();
    return;
  }

  pickItemDrug(item, drug);
}

async function pinRecentDrug(key) {
  const overlay = state.overlay;
  try {
    const drug = rememberedDrug(key) || (await getCached(key))?.drug;
    if (!drug || license(drug) !== key) {
      toast('找不到這支藥的完整資料，請從藥劑查詢開啟詳情後釘選');
      return;
    }
    await addFavorite(key, drug);
    state.favorites = await listFavorites();
    if (state.overlay === overlay) renderOverlay();
    toast('已加入常用藥劑');
  } catch (error) {
    toast('無法加入常用藥劑：' + error.message);
  }
}

function rememberedDrug(key) {
  return state.favorites.find((favorite) => favorite.key === key)?.drug ||
    state.applications.flatMap((app) => app.drugs || []).find((drug) => drug.license === key && drug.source)?.source;
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
    if (field.water) state.calc.water = field.water;
  }
  syncCalcCrop();
  render();
}

async function saveFieldForm() {
  const panel = state.overlay;
  if (panel.saving || panel.form.templateEditor) return;
  const form = panel.form;
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

  if (form.water && !positiveNumber(form.water)) {
    form.error = '用水量請填大於零的公升數，或留空';
    renderOverlay();
    return;
  }

  panel.saving = true;
  try {
    const current = panel.returnTo && state.fields.find((field) => field.id === form.id);
    if (panel.returnTo && !current) throw new Error('找不到這塊土地');
    await saveField(current ? { ...current, templates: form.templates } : form);
    await reloadFields();
    state.overlay = panel.returnTo || { kind: 'fields' };
    render();
    if (panel.returnTo) toast('已儲存常用組合');
  } catch (error) {
    panel.saving = false;
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

/** 從標示的每公頃用量判斷最適合的實際用量單位；沒有資料時保守用公克。 */
function amountUnitFor(range) {
  const parsed = parseDose(text(range?.['每公頃使用用藥量']));
  return (parsed && toBaseDose(parsed)?.base) || '公克';
}

const emptyAdditive = () => ({ name: '', amount: '', unit: '', note: '' });
const positiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

function readRecordDraft() {
  try {
    const draft = JSON.parse(store.get('record-draft'));
    return Array.isArray(draft?.drugs) && Array.isArray(draft?.additives) ? draft : null;
  } catch {
    return null;
  }
}

function persistRecordDraft(draft) {
  state.recordDraft = draft;
  const { error, ...saved } = draft;
  const drugs = saved.drugs.map(({ ranges, checking, ...drug }) => drug);
  store.set('record-draft', JSON.stringify({ ...saved, drugs }));
}

function clearRecordDraft() {
  state.recordDraft = null;
  store.set('record-draft', '');
}

function recomputeHarvest(draft) {
  const info = harvestInfo(draft.date, draft.drugs);
  draft.harvestDate = info.date;
  draft.harvestDays = info.days;
  draft.harvestUnknown = info.unknown;
}

function recordDrug(drug, range) {
  return {
    name: drugTitle(drug),
    license: license(drug),
    ingredient: text(drug['化學成分']),
    source: drug,
    amount: '',
    amountUnit: amountUnitFor(range),
    water: '',
  };
}

function applyRecordRange(drug, range) {
  drug.cropOfficial = text(range?.['作物名稱']);
  drug.target = text(range?.['病蟲害名稱']);
  drug.dilution = text(range?.['稀釋倍數']);
  drug.dosePerHa = text(range?.['每公頃使用用藥量']);
  drug.phi = text(range?.['安全採收期']);
  drug.interval = text(range?.['施藥間隔']);
  drug.rangeVerified = Boolean(range);
  if (range && !drug.amount && !drug.amountUnitChosen) drug.amountUnit = amountUnitFor(range);
}

function syncRecordDrug(drug, crop) {
  const matches = matchingRecordRanges(drug.ranges || [], crop);
  const previous = drug.rangeVerified && matches.find((range) =>
    text(range['病蟲害名稱']) === drug.target &&
    text(range['安全採收期']) === drug.phi &&
    text(range['每公頃使用用藥量']) === drug.dosePerHa &&
    text(range['稀釋倍數']) === drug.dilution);
  applyRecordRange(drug, previous || (matches.length === 1 ? matches[0] : null));
}

function refreshRecordRanges(draft) {
  for (const drug of draft.drugs) syncRecordDrug(drug, draft.crop);
  recomputeHarvest(draft);
  renderOverlay();
  draft.drugs.filter((drug) => !drug.ranges).forEach((drug) => loadRecordDrug(draft, drug));
}

async function loadRecordDrug(draft, drug) {
  if (drug.checking) return;
  drug.checking = true;
  renderOverlay();
  try {
    let source = drug.source || (await getCached(drug.license))?.drug;
    if (!source && drug.license) {
      const { rows } = await searchWithFallback(drug.license);
      source = rows.find((entry) => license(entry) === drug.license);
    }
    if (source) {
      drug.source = source;
      const result = await rangesWithFallback(source);
      drug.ranges = result.ranges;
      drug.rangeStatus = result.status;
      if (state.overlay?.draft === draft && draft.drugs.includes(drug)) syncRecordDrug(drug, draft.crop);
    } else {
      drug.rangeStatus = 'failed';
    }
  } catch {
    drug.rangeStatus = 'failed';
    // 仍可照實記錄施作，等連線後再重新比對。
  } finally {
    drug.checking = false;
    if (state.overlay?.draft === draft && draft.drugs.includes(drug)) {
      recomputeHarvest(draft);
      renderOverlay();
    }
  }
}

function showRecordDraft(draft) {
  recomputeHarvest(draft);
  state.overlay = { kind: 'record-form', draft };
  renderOverlay();
}

function openRecordForm(fromCalc = false, onlyItem = null) {
  if (state.recordDraft) {
    resumeRecordDraft();
    return;
  }

  const fieldId = fromCalc ? state.calc.fieldId :
    state.records.filterFieldId || (state.fields.length === 1 ? state.fields[0].id : '');
  const field = state.fields.find((entry) => entry.id === fieldId);
  const crop = fromCalc ? state.calc.crop : field?.crop || '';
  const drugs = fromCalc ? (onlyItem ? [onlyItem] : state.calc.items.filter((item) => item.drug))
    .map((item) => drugFromCalc(item, crop)) : [];
  showRecordDraft({
    date: todayKey(),
    time: '',
    fieldId,
    fieldName: field?.name || '',
    crop,
    area: fromCalc ? state.calc.area : field?.area || '',
    unit: fromCalc ? state.calc.areaUnit : field?.unit || 'fen',
    mode: 'tank',
    water: field?.water || '',
    buckets: [],
    drugs,
    additives: [],
    note: '',
    error: '',
  });
}

function drugFromCalc(item, crop) {
  const selected = item.ranges[item.selected];
  const drug = recordDrug(item.drug);
  drug.ranges = item.allRanges || item.ranges;
  const matching = matchingRecordRanges(drug.ranges, crop);
  applyRecordRange(drug, matching.includes(selected) ? selected : matching.length === 1 ? matching[0] : null);
  return drug;
}

function toggleCalcDraftDrug(id) {
  const item = findItem(id);
  if (!item?.drug || item.loading) return;
  const draft = state.recordDraft;
  if (!draft) {
    openRecordForm(true, item);
    return;
  }
  if (draft.createdAt) {
    toast('請先完成正在編輯的舊紀錄');
    return;
  }
  const key = license(item.drug);
  const index = draft.drugs.findIndex((drug) => drug.license === key);
  if (index >= 0) {
    draft.drugs.splice(index, 1);
    if (!draft.drugs.length) draft.mode = 'tank';
  } else {
    draft.drugs.push(drugFromCalc(item, draft.crop));
  }
  recomputeHarvest(draft);
  persistRecordDraft(draft);
  render();
  toast(index >= 0 ? '已從本次施作移除' : '已加入本次施作');
}

function resumeRecordDraft() {
  if (!state.recordDraft) return;
  const draft = state.recordDraft;
  if (draft.cropDirty) {
    draft.cropDirty = false;
    for (const drug of draft.drugs) applyRecordRange(drug, null);
  }
  for (const drug of draft.drugs) if (!drug.rangeVerified && drug.ranges) syncRecordDrug(drug, draft.crop);
  showRecordDraft(draft);
  draft.drugs.filter((drug) => !drug.rangeVerified && drug.source && !drug.ranges)
    .forEach((drug) => loadRecordDrug(draft, drug));
}

function openRecordFormForEdit(app) {
  if (state.recordDraft) {
    toast('請先完成或捨棄目前的施作草稿');
    resumeRecordDraft();
    return;
  }
  const drugs = (app.drugs || []).map((drug) => ({
    ...drug,
    rangeVerified: legacyRecordRange(drug) ? undefined : verifiedRecordRange(drug, app.crop),
  }));
  showRecordDraft({ ...app, drugs, additives: (app.additives || []).map((a) => ({ ...a })), error: '' });
}

function recordTemplate(record, name) {
  return {
    id: newId(),
    name,
    mode: record.mode,
    drugs: (record.drugs || []).map(({ name, license, ingredient, source, amountUnit }) =>
      ({ name, license, ingredient, source, amountUnit })),
    additives: (record.additives || []).map(({ name, unit }) => ({ name, unit })),
  };
}

function applyRecordTemplate(draft, template) {
  if (!template) return;
  if ((draft.drugs.length || draft.additives.length) && !window.confirm('要以選取的組合取代這份草稿的藥劑和資材嗎？')) return;
  draft.mode = template.drugs.length && template.mode === 'separate' ? 'separate' : 'tank';
  draft.drugs = template.drugs.map((drug) => ({ ...drug, amount: '', water: '', rangeVerified: false, amountUnitChosen: true }));
  draft.additives = template.additives.map(({ name, unit, amount }) => ({ name, unit, amount: amount ?? '', note: '' }));
  refreshRecordRanges(draft);
}

function addRecordDrug(drug) {
  const { draft } = state.overlay;
  if (!drug) {
    toast('這台裝置沒有保存藥劑詳情，請用名稱或許可證查詢');
    return;
  }
  if (draft.drugs.some((item) => item.license === license(drug))) {
    toast('這支藥已經在本次紀錄中');
    return;
  }
  const item = { ...recordDrug(drug), rangeVerified: false };
  draft.drugs.push(item);
  recomputeHarvest(draft);
  loadRecordDrug(draft, item);
}

async function saveRecord() {
  const overlay = state.overlay;
  if (overlay.saving) return;
  const draft = overlay.draft;
  const customOnly = !draft.drugs.length;
  if (customOnly) draft.mode = 'tank';
  if (draft.cropDirty) {
    draft.cropDirty = false;
    for (const drug of draft.drugs) syncRecordDrug(drug, draft.crop);
  }
  const namedAdditives = (draft.additives || []).filter((item) => String(item.name || '').trim());

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
  if (!positiveNumber(draft.area)) {
    draft.error = '請填實際施作面積';
    renderOverlay();
    return;
  }
  if (customOnly && !namedAdditives.length) {
    draft.error = '請至少填一項自訂配方或資材名稱';
    renderOverlay();
    return;
  }
  if (customOnly && namedAdditives.some((item) => !positiveNumber(item.amount) || !String(item.unit || '').trim())) {
    draft.error = '每一項自訂配方或資材都要填實際用量與單位';
    renderOverlay();
    return;
  }
  if (draft.drugs.some((d) => !positiveNumber(d.amount))) {
    draft.error = '每一種藥劑都要填實際用量';
    renderOverlay();
    return;
  }
  const buckets = draft.mode === 'tank' ? (draft.buckets || []) : [];
  if (buckets.some((water) => !positiveNumber(water))) {
    draft.error = '請填每一桶的實際用水量，或移除空白桶';
    renderOverlay();
    return;
  }
  const totalWater = recordWater(draft);
  if (draft.mode === 'tank' && !positiveNumber(totalWater)) {
    draft.error = '同桶混用要填實際總用水量';
    renderOverlay();
    return;
  }
  if (draft.mode === 'separate' && draft.drugs.some((d) => !positiveNumber(d.water))) {
    draft.error = '分開施用時，每一次都要填自己的用水量';
    renderOverlay();
    return;
  }

  recomputeHarvest(draft);

  const record = {
    id: draft.id || newId(),
    createdAt: draft.createdAt,
    recordType: customOnly ? 'custom' : 'official',
    date: draft.date,
    time: draft.time,
    fieldId: draft.fieldId,
    fieldName: draft.fieldName.trim(),
    crop: draft.crop.trim(),
    area: draft.area,
    unit: draft.unit,
    areaHa: toHectares(Number(draft.area) || 0, draft.unit),
    mode: draft.mode,
    water: draft.mode === 'tank' ? Number(totalWater) : null,
    buckets: buckets.map(Number),
    drugs: draft.drugs.map((d) => ({
      name: d.name,
      license: d.license,
      ingredient: d.ingredient,
      source: d.source,
      cropOfficial: d.cropOfficial,
      rangeVerified: d.rangeVerified,
      target: d.target,
      dilution: d.dilution,
      dosePerHa: d.dosePerHa,
      phi: d.phi,
      interval: d.interval,
      amount: String(d.amount),
      amountUnit: d.amountUnit,
      water: draft.mode === 'separate' ? Number(d.water) : null,
    })),
    additives: namedAdditives
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

  overlay.saving = true;
  draft.id = record.id;
  draft.error = '';
  renderOverlay();
  try {
    const saved = await saveApplication(record);
    clearRecordDraft();
    await reloadApplications();
    state.tab = 'records';
    state.records.month = new Date(...saved.date.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
    state.records.selected = saved.date;
    state.overlay = { kind: 'record-detail', id: saved.id };
    render();
    toast('已保存到這支手機');
  } catch (error) {
    overlay.saving = false;
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
    state.lastBackup = todayKey();
    store.set('last-backup', state.lastBackup);
    render();
    toast('已送出備份下載');
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
  if (state.overlay?.saving) return;
  if (state.overlay?.kind === 'modal' && state.overlay.modal === 'release') {
    // 關掉更新說明才算「看過」，中途離開下次還會再提醒一次。
    store.set('seen-version', VERSION);
  }
  if (state.overlay?.returnTo) {
    state.overlay = state.overlay.returnTo;
    renderOverlay();
    return;
  }
  const wasRecord = state.overlay?.kind === 'record-form';
  state.overlay = null;
  if (wasRecord) render();
  else renderOverlay();
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
  'open-detail': (d) => {
    const drug = state.search.drugs.find((row) => license(row) === d.license);
    if (drug) openDetail(drug);
  },

  /* 試算 */
  'add-item': () => {
    state.calc.items.push(emptyItem());
    render();
  },
  'item-remove': (d) => {
    state.calc.items = state.calc.items.filter((i) => i.id !== Number(d.id));
    if (!state.calc.items.length) state.calc.items = [emptyItem()];
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
  'edit-record-templates': () => {
    const parent = state.overlay;
    const field = state.fields.find((entry) => entry.id === parent?.draft?.fieldId);
    if (!field) return;
    state.overlay = { kind: 'field-form', form: { ...field, error: '' }, returnTo: parent };
    renderOverlay();
  },
  'open-favorites': () => {
    state.overlay = { kind: 'favorites' };
    renderOverlay();
  },
  'search-to-pin': () => {
    state.overlay = null;
    state.tab = 'search';
    render();
    screenEl.querySelector('[data-field="search-query"]')?.focus();
  },
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
  'toggle-calc-draft-drug': (d) => toggleCalcDraftDrug(d.id),
  'open-record-form': () => openRecordForm(true),
  'new-record': () => openRecordForm(),
  'resume-record': () => resumeRecordDraft(),
  'discard-record-draft': () => {
    if (!window.confirm('要捨棄這份未儲存的草稿嗎？')) return;
    clearRecordDraft();
    state.overlay = null;
    render();
  },
  'record-recheck': (d) => loadRecordDrug(state.overlay.draft, state.overlay.draft.drugs[Number(d.idx)]),
  'record-bucket-add': () => {
    const draft = state.overlay.draft;
    (draft.buckets ||= []).push('');
    renderOverlay();
  },
  'record-bucket-remove': (d) => {
    state.overlay.draft.buckets.splice(Number(d.idx), 1);
    renderOverlay();
  },
  'save-record-template': async (d) => {
    const app = findApp(d.id);
    const field = state.fields.find((entry) => entry.id === app?.fieldId);
    if (!field) return;
    const name = window.prompt('給這個常用組合取個名字')?.trim();
    if (!name) return;
    try {
      await saveField({ ...field, templates: [...(field.templates || []), recordTemplate(app, name)] });
      await reloadFields();
      toast('已加入這塊地的常用組合');
    } catch (error) {
      toast(error.message);
    }
  },
  'field-template-edit': (d) => {
    const form = state.overlay.form;
    const template = form.templates?.find((item) => item.id === d.id);
    form.templateEditor = template ? {
      ...template, drugs: [...template.drugs], additives: template.additives.map((item) => ({ ...item })),
    } : { id: newId(), name: '', mode: 'tank', drugs: [], additives: [] };
    renderOverlay();
    overlayEl.querySelector('[data-field="template-name"]')?.focus();
  },
  'template-add-additive': () => {
    state.overlay.form.templateEditor.additives.push({ name: '', amount: '', unit: '' });
    renderOverlay();
  },
  'template-remove-additive': (d) => {
    state.overlay.form.templateEditor.additives.splice(Number(d.idx), 1);
    renderOverlay();
  },
  'template-remove-drug': (d) => {
    state.overlay.form.templateEditor.drugs.splice(Number(d.idx), 1);
    renderOverlay();
  },
  'template-cancel-edit': () => {
    state.overlay.form.templateEditor = null;
    renderOverlay();
  },
  'template-apply-edit': () => {
    const form = state.overlay.form;
    const editor = form.templateEditor;
    const name = editor.name.trim();
    const additives = editor.additives.map(({ name, unit, amount }) => ({
      name: name.trim(), unit, amount: String(amount ?? '').trim(),
    })).filter((item) => item.name || item.amount || item.unit);
    if (additives.some((item) => !item.name || (item.amount && (!positiveNumber(item.amount) || !item.unit)))) {
      toast('請填資材名稱。若設定施用量，請填大於零的數字並選擇單位');
      return;
    }
    if (!name || (!editor.drugs.length && !additives.length)) {
      toast('請填組合名稱，並加入至少一種藥劑或資材');
      return;
    }
    const template = { ...editor, name, additives };
    const templates = form.templates || [];
    form.templates = templates.some((item) => item.id === template.id)
      ? templates.map((item) => item.id === template.id ? template : item)
      : [...templates, template];
    form.templateEditor = null;
    toast(state.overlay.returnTo ? '請點「儲存組合」保存修改' : '請儲存土地以保存這次修改');
    renderOverlay();
  },
  'field-template-remove': (d) => {
    if (!window.confirm('要移除這組常用組合嗎？')) return;
    state.overlay.form.templates = state.overlay.form.templates.filter((item) => item.id !== d.id);
    renderOverlay();
  },
  'record-mode': (d) => {
    state.overlay.draft.mode = d.mode;
    renderOverlay();
  },
  'record-drug-remove': (d) => {
    const draft = state.overlay.draft;
    draft.drugs.splice(Number(d.idx), 1);
    if (!draft.drugs.length) draft.mode = 'tank';
    recomputeHarvest(draft);
    renderOverlay();
  },
  'additive-add': () => {
    state.overlay.draft.additives.push(emptyAdditive());
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
  'clear-record-search': () => {
    Object.assign(state.records, { query: '', from: '', to: '', selected: null });
    for (const input of screenEl.querySelectorAll('[data-record-search] input')) input.value = '';
    refreshRecordSearchResults();
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
  'remove-pinned-favorite': (d) => removePinnedFavorite(d.key),
  'open-pinned-favorite': (d) => {
    const drug = state.favorites.find((favorite) => favorite.key === d.key)?.drug;
    if (drug) openDetail(drug, state.overlay?.kind === 'favorites' ? state.overlay : null);
    else toast('這台裝置沒有保存這支藥的詳情，請查詢藥名');
  },

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
  if (state.overlay?.saving && overlayEl.contains(target)) return;

  const handler = ACTIONS[target.dataset.action];
  if (handler) handler(target.dataset);
});

let sheetDrag = null;

overlayEl.addEventListener('touchstart', (event) => {
  const sheet = event.target.closest('.sheet');
  if (!sheet || event.touches.length !== 1 || state.overlay?.saving ||
      event.target.closest('button,input,select,textarea,a')) {
    sheetDrag = null;
    return;
  }
  const touch = event.touches[0];
  sheetDrag = { sheet, startX: touch.clientX, startY: touch.clientY, distance: 0, atTop: sheet.scrollTop <= 0 };
}, { passive: true });

overlayEl.addEventListener('touchmove', (event) => {
  const drag = sheetDrag;
  if (!drag || event.touches.length !== 1) return;
  const touch = event.touches[0];
  if (drag.sheet.scrollTop > 0 || !drag.atTop) {
    drag.atTop = drag.sheet.scrollTop <= 0;
    drag.startY = touch.clientY;
    return;
  }
  const distance = touch.clientY - drag.startY;
  if (distance < 4) {
    if (drag.distance) {
      drag.distance = 0;
      drag.sheet.style.translate = '';
      if (event.cancelable) event.preventDefault();
    }
    return;
  }
  if (!drag.distance && Math.abs(touch.clientX - drag.startX) > distance) return;
  if (!event.cancelable && !drag.distance) return;
  if (event.cancelable) event.preventDefault();
  drag.distance = distance;
  drag.sheet.style.translate = '0 ' + Math.round(distance * 0.8) + 'px';
}, { passive: false });

function finishSheetDrag(event) {
  const drag = sheetDrag;
  sheetDrag = null;
  if (!drag) return;
  drag.sheet.style.translate = '';
  if (event.type !== 'touchend' || drag.distance < 95 || !drag.sheet.isConnected) return;
  const action = drag.sheet.parentElement.dataset.action;
  ACTIONS[action]?.({});
}

overlayEl.addEventListener('touchend', finishSheetDrag);
overlayEl.addEventListener('touchcancel', finishSheetDrag);

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
      syncCalcCrop();
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
    case 'field-water':
      form.water = value;
      break;
    case 'template-name':
      form.templateEditor.name = value;
      break;
    case 'template-additive-name':
      form.templateEditor.additives[Number(idx)].name = value;
      break;
    case 'template-additive-amount':
      form.templateEditor.additives[Number(idx)].amount = value;
      break;
    case 'template-additive-unit':
      form.templateEditor.additives[Number(idx)].unit = value;
      break;
    case 'field-crop':
      form.crop = value;
      break;

    case 'record-bucket-water':
      draft.buckets[Number(idx)] = value;
      updateBucketTotal(draft);
      renderRecordGuidanceOnly();
      renderCustomDilutionsOnly();
      break;
    case 'record-field-name':
      draft.fieldName = value;
      break;
    case 'record-crop':
      draft.crop = value;
      draft.cropDirty = true;
      for (const drug of draft.drugs) drug.rangeVerified = false;
      recomputeHarvest(draft);
      break;
    case 'record-date':
      draft.date = value;
      recomputeHarvest(draft);
      break;
    case 'record-area':
      draft.area = value;
      renderRecordGuidanceOnly();
      break;
    case 'record-water':
      draft.water = value;
      renderRecordGuidanceOnly();
      renderCustomDilutionsOnly();
      break;
    case 'record-note':
      draft.note = value;
      break;
    case 'record-time':
      draft.time = value;
      break;
    case 'record-amount':
      draft.drugs[Number(idx)].amount = value;
      renderRecordGuidanceOnly();
      break;
    case 'record-drug-water':
      draft.drugs[Number(idx)].water = value;
      renderRecordGuidanceOnly();
      break;
    case 'additive-name':
      draft.additives[Number(idx)].name = value;
      break;
    case 'additive-amount':
      draft.additives[Number(idx)].amount = value;
      renderCustomDilutionsOnly();
      break;
    case 'additive-unit':
      draft.additives[Number(idx)].unit = value;
      renderCustomDilutionsOnly();
      break;
    case 'additive-note':
      draft.additives[Number(idx)].note = value;
      break;
    default:
      break;
  }
  if (draft) {
    persistRecordDraft(draft);
    renderRecordReviewOnly(draft);
  }
});

document.addEventListener('change', (event) => {
  const { field, id, idx } = event.target.dataset;
  const value = event.target.value;
  const draft = state.overlay?.draft;

  if (field === 'template-additive-unit') {
    state.overlay.form.templateEditor.additives[Number(idx)].unit = value;
  } else if (field === 'template-mode') {
    state.overlay.form.templateEditor.mode = value;
  } else if (field === 'template-add-drug' && value) {
    const editor = state.overlay.form.templateEditor;
    const drug = state.favorites.find((item) => item.key === value)?.drug;
    if (drug && !editor.drugs.some((item) => item.license === value)) {
      const { amount, water, ...entry } = recordDrug(drug);
      editor.drugs.push(entry);
    }
    renderOverlay();
  } else if (field === 'records-query' || field === 'records-from' || field === 'records-to') {
    state.records[field.slice(8)] = value;
    state.records.selected = null;
    refreshRecordSearchResults();
  } else if (field === 'record-crop' && draft.cropDirty) {
    draft.cropDirty = false;
    refreshRecordRanges(draft);
  } else if (field === 'record-range') {
    const drug = draft.drugs[Number(idx)];
    const ranges = matchingRecordRanges(drug.ranges || [], draft.crop);
    applyRecordRange(drug, value === '' ? null : ranges[Number(value)]);
    recomputeHarvest(draft);
    renderOverlay();
  } else if (field === 'record-pin-recent' && value) {
    event.target.value = '';
    pinRecentDrug(value);
  } else if (['record-drug-quick', 'record-drug-recent'].includes(field) && value) {
    const drug = rememberedDrug(value);
    if (drug) addRecordDrug(drug);
    else getCached(value).then((entry) => {
      if (state.overlay?.draft === draft) addRecordDrug(entry?.drug);
    });
  } else if (field === 'record-template' && value) {
    const current = state.fields.find((entry) => entry.id === draft.fieldId);
    applyRecordTemplate(draft, current?.templates?.find((item) => item.id === value));
  } else if (field === 'record-history' && value) {
    const app = findApp(value);
    if (app?.fieldId === draft.fieldId) applyRecordTemplate(draft, recordTemplate(app, ''));
  } else if (field === 'record-history-query') {
    state.overlay.historyQuery = value;
    renderOverlay();
  } else if (field === 'field-template-copy' && value) {
    const original = state.fields.flatMap((entry) => entry.templates || []).find((item) => item.id === value);
    if (original) state.overlay.form.templates = [...(state.overlay.form.templates || []), { ...original, id: newId() }];
    renderOverlay();
  } else if (field === 'areaUnit') {
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
    renderRecordGuidanceOnly();
  } else if (field === 'record-field-preset') {
    const fieldRecord = state.fields.find((item) => item.id === value);
    draft.fieldId = value;
    state.overlay.historyQuery = '';
    if (fieldRecord) {
      draft.fieldName = fieldRecord.name;
      draft.area = fieldRecord.area;
      draft.unit = fieldRecord.unit;
      draft.crop = fieldRecord.crop || '';
      draft.water = fieldRecord.water || '';
      draft.buckets = [];
    }
    refreshRecordRanges(draft);
  } else if (field === 'record-amount-unit') {
    draft.drugs[Number(idx)].amountUnit = value;
    draft.drugs[Number(idx)].amountUnitChosen = true;
    renderRecordGuidanceOnly();
  } else if (field === 'additive-preset') {
    const preset = recentAdditiveOptions()[Number(value)];
    if (preset) {
      const emptyIndex = draft.additives.findIndex(
        (item) => !String(item.name || '').trim() && !String(item.amount || '').trim() && !String(item.note || '').trim(),
      );
      const next = { name: preset.name, amount: '', unit: preset.unit, note: '' };
      if (emptyIndex >= 0) draft.additives[emptyIndex] = next;
      else draft.additives.push(next);
      renderOverlay();
    }
  } else if (field === 'additive-unit') {
    draft.additives[Number(idx)].unit = value;
    renderCustomDilutionsOnly();
  } else if (field === 'record-date') {
    // 日期變了，參考採收日要跟著重算。
    draft.date = value;
    recomputeHarvest(draft);
    renderOverlay();
  }
  if (draft && state.overlay?.draft === draft) {
    persistRecordDraft(draft);
    renderRecordReviewOnly(draft);
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
  if (event.key === 'Enter' && ['records-query', 'record-history-query'].includes(event.target.dataset.field)) {
    event.preventDefault();
    event.target.blur();
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
  navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url)).catch(() => {});
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
