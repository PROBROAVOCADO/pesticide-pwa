import { calcRange, formatRange, formatWater, toHectares } from './calc.js';
import {
  cacheDrugs,
  cacheRanges,
  dbAvailable,
  deleteApplication,
  deleteField,
  exportBackup,
  getCached,
  importBackup,
  listApplications,
  listFields,
  requestPersistence,
  saveApplication,
  saveField,
  searchCachedDrugs,
} from './db.js';
import { drugTitle, license, loadRanges, matchesCrop, searchDrugs, text } from './moa.js';
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
  modalHtml,
  recordDetailHtml,
  recordFormHtml,
  recordsViewHtml,
  searchViewHtml,
  settingsViewHtml,
  toastHtml,
} from './views.js';

/* ------------------------------------------------------------------ */
/* 常數                                                                */
/* ------------------------------------------------------------------ */

const VERSION = 'v1.1.0';
const LINE_URL = 'https://line.me/ti/p/7OorqI3Zzk';
const APHIA_URL = 'https://pesticide.aphia.gov.tw/information/';

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
  results: [],
  drug: null,
  ranges: [],
  selected: 0,
  loading: false,
  error: '',
});

const state = {
  tab: 'search',
  search: { query: '', drugs: [], loading: false, message: '輸入普通名稱、廠牌名稱或農藥代號', fromCache: false },
  calc: { crop: '', area: '1', areaUnit: 'fen', water: '200', items: [emptyItem()], fieldId: '' },
  records: { month: new Date(), selected: null, filterFieldId: '' },
  fields: [],
  applications: [],
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

const canRecord = () => state.calc.items.some((i) => i.drug && i.ranges[i.selected]);

const views = {
  search: () => searchViewHtml(state.search),
  calc: () => calcViewHtml(state.calc, state.fields, areaHa(), canRecord()),
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

function renderOverlay() {
  const o = state.overlay;
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
    const rows = await searchDrugs(query);
    cacheDrugs(rows);
    return { rows, fromCache: false };
  } catch (error) {
    const cached = await searchCachedDrugs(query);
    if (cached.length) return { rows: cached, fromCache: true };
    throw error;
  }
}

async function rangesWithFallback(drug) {
  const key = license(drug);
  try {
    const ranges = await loadRanges(drug);
    cacheRanges(key, ranges);
    return ranges;
  } catch (error) {
    const cached = await getCached(key);
    if (cached?.ranges) return cached.ranges;
    throw error;
  }
}

async function runMainSearch() {
  const query = state.search.query.trim();
  if (query.length < 2) {
    state.search.message = '請至少輸入兩個字';
    render();
    return;
  }

  state.search.loading = true;
  state.search.drugs = [];
  state.search.fromCache = false;
  state.search.message = '正在翻閱官方登記資料…';
  render();

  try {
    const { rows, fromCache } = await searchWithFallback(query);
    state.search.drugs = rows;
    state.search.fromCache = fromCache;
    state.search.message = rows.length
      ? `找到 ${rows.length} 筆${fromCache ? '本機保存的' : '有效的殺菌／殺蟲'}藥劑`
      : '沒有找到仍有效且符合分類的藥劑';
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
  try {
    const ranges = await rangesWithFallback(drug);
    if (state.overlay?.kind === 'detail') state.overlay.ranges = ranges;
  } catch {
    /* 讀不到就顯示空清單 */
  } finally {
    if (state.overlay?.kind === 'detail') {
      state.overlay.loading = false;
      renderOverlay();
    }
  }
}

async function runItemSearch(item) {
  if (item.query.trim().length < 2) {
    item.error = '請至少輸入兩個字';
    render();
    return;
  }

  item.loading = true;
  item.error = '';
  render();

  try {
    const { rows, fromCache } = await searchWithFallback(item.query);
    item.results = rows;
    if (fromCache) item.error = '目前連不上官方資料，以下是本機保存的藥劑。';
  } catch (error) {
    item.error = error.message;
  } finally {
    item.loading = false;
    render();
  }
}

async function pickItemDrug(item, drug) {
  item.drug = drug;
  item.results = [];
  item.loading = true;
  item.error = '';
  render();

  try {
    const all = await rangesWithFallback(drug);
    const matched = all.filter((r) => matchesCrop(r, state.calc.crop));
    item.ranges = matched.length ? matched : all;
    item.selected = 0;
    item.error = matched.length ? '' : `找不到「${state.calc.crop || '目前作物'}」的核准範圍，請重新選擇。`;
  } catch {
    item.error = '讀不到這項藥劑的使用範圍';
  } finally {
    item.loading = false;
    render();
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
  const items = state.calc.items.filter((i) => i.drug && i.ranges[i.selected]);
  if (!items.length) return;

  const field = state.fields.find((f) => f.id === state.calc.fieldId);

  const drugs = items.map((item) => {
    const range = item.ranges[item.selected];
    const { amount, unit, suggestion } = suggestAmount(range);
    return {
      name: drugTitle(item.drug),
      license: license(item.drug),
      ingredient: text(item.drug['化學成分']),
      target: text(range['病蟲害名稱']),
      cropOfficial: text(range['作物名稱']),
      dilution: text(range['稀釋倍數']),
      dosePerHa: text(range['每公頃使用用藥量']),
      phi: text(range['安全採收期']),
      interval: text(range['施藥間隔']),
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
 * 檔名一律用英數字：Chromium 遇到含中文的 download 屬性會整個放棄，
 * 存成沒有副檔名的 "download"，那樣的 .ics 使用者根本打不開。
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
    downloadFile(`field-meds-backup-${todayKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('備份已下載');
  } catch (error) {
    notice('匯出失敗', error.message);
  }
}

async function doImportBackup(file) {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    await Promise.all([reloadFields(), reloadApplications()]);
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
    pickItemDrug(item, item.results[Number(d.idx)]);
  },
  'item-reset': (d) => {
    Object.assign(findItem(d.id), { drug: null, ranges: [], query: '', error: '', selected: 0 });
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
    case 'item-query':
      findItem(id).query = value;
      break;
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
  const persistence = await requestPersistence();
  state.persisted = persistence.persisted;
  render();
})();
