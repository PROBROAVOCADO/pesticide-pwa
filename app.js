import {
  AREA_UNITS,
  calcRange,
  formatRange,
  formatWater,
  toHectares,
} from './calc.js';
import {
  drugSubtitle,
  drugTitle,
  license,
  loadRanges,
  matchesCrop,
  searchDrugs,
  text,
} from './moa.js';

/* ------------------------------------------------------------------ */
/* 常數                                                                */
/* ------------------------------------------------------------------ */

const VERSION = 'v1.0.0';
const LINE_URL = 'https://line.me/ti/p/7OorqI3Zzk';
const APHIA_URL = 'https://pesticide.aphia.gov.tw/information/';

/**
 * 本機儲存的專屬前綴。
 * GitHub Pages 上同一個帳號的站台可能共用 origin，
 * 沒有前綴的 key 會被其他站台看見甚至覆蓋。
 */
const APP_ID = 'field-meds';

/* ------------------------------------------------------------------ */
/* 本機儲存                                                            */
/* ------------------------------------------------------------------ */

/**
 * Safari 無痕模式與部分手機的隱私設定會讓 localStorage 直接丟例外，
 * 沒接住的話整個 App 會在啟動時白畫面，所以一律包 try/catch。
 */
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
      /* 儲存空間不可用時安靜略過 */
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
  search: { query: '', drugs: [], loading: false, message: '輸入普通名稱、廠牌名稱或農藥代號' },
  calc: { crop: '', area: '1', areaUnit: 'fen', water: '200', items: [emptyItem()] },
  detail: null, // { drug, ranges, loading, crop }
  modal: null, // 'release' | 'install' | 'support'
  installPrompt: null,
};

const areaHa = () => toHectares(Number(state.calc.area) || 0, state.calc.areaUnit);
const waterLiters = () => Number(state.calc.water) || 0;
const findItem = (id) => state.calc.items.find((i) => i.id === Number(id));

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * 官方資料會直接進 innerHTML，必須逐字escape。
 * 少了這一層，資料裡任何一個角括號都會把版面弄壞。
 */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const screenEl = document.getElementById('screen');
const overlayEl = document.getElementById('overlay');
const tabsEl = document.getElementById('tabs');

/* ------------------------------------------------------------------ */
/* 畫面：藥劑卡                                                        */
/* ------------------------------------------------------------------ */

function drugCardHtml(drug, action, dataAttr, compact) {
  const kind = text(drug['農藥分類中文意義']);
  return `
    <button class="drug-card${compact ? ' compact' : ''}" type="button" data-action="${action}" ${dataAttr}>
      <span class="drug-topline">
        <span class="kind${kind === '殺菌劑' ? ' fungicide' : ''}">${esc(kind)}</span>
        <span class="license">${esc(license(drug))}</span>
      </span>
      <strong>${esc(drugTitle(drug))}</strong>
      <span>${esc(drugSubtitle(drug))}</span>
      ${compact ? '' : `<small>${esc(text(drug['廠商名稱']))}</small>`}
    </button>`;
}

/* ------------------------------------------------------------------ */
/* 畫面：藥劑查詢                                                      */
/* ------------------------------------------------------------------ */

function searchViewHtml() {
  const { query, drugs, loading, message } = state.search;

  const results = drugs.length
    ? `<div class="drug-grid">${drugs.map((d, i) => drugCardHtml(d, 'open-detail', `data-idx="${i}"`, false)).join('')}</div>`
    : loading
      ? ''
      : `<div class="welcome-card">
           <b>可以查什麼？</b>
           <p>普通名稱、商品廠牌或農藥代號都可以。點開藥劑後，可看有效成分、抗藥性代碼、核准作物、稀釋倍數與安全採收期。</p>
         </div>`;

  return `
    <section class="view">
      <div class="hero">
        <span>合法用藥，先查再下田</span>
        <h2>農藥登記資料，<br />整理成好讀的田間小冊。</h2>
        <p>目前聚焦殺菌劑與殺蟲劑，資料來自農業部及動植物防疫檢疫署。</p>
      </div>

      <form class="search-box" id="search-form">
        <label for="drug-search">查詢藥劑</label>
        <div>
          <input id="drug-search" data-field="search-query" value="${esc(query)}" placeholder="例如：派滅淨、第滅寧、I215" />
          <button${loading ? ' disabled' : ''}>查詢</button>
        </div>
        <small>${esc(message)}</small>
      </form>

      ${results}
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 畫面：試算結果檢核卡                                                */
/* ------------------------------------------------------------------ */

function verdictHtml(range) {
  const rawDose = text(range['每公頃使用用藥量']);
  const rawDilution = text(range['稀釋倍數']);
  const water = waterLiters();
  const result = calcRange(rawDose, rawDilution, areaHa(), water);

  const officialRows = `
    <dl class="check-rows">
      <div><dt>官方每公頃用量</dt><dd>${esc(rawDose || '—')}</dd></div>
      <div><dt>官方稀釋倍數</dt><dd>${esc(rawDilution || '—')}</dd></div>
    </dl>`;

  if (result.kind === 'none') {
    return '<div class="soft-note">這筆資料沒有可換算的每公頃用量與稀釋倍數。</div>';
  }

  if (result.kind === 'area-only') {
    return `
      <div class="verdict info">
        <span class="verdict-label">只依面積換算</span>
        <strong>${esc(formatRange(result.byArea, result.base))}</strong>
        <span class="verdict-sub">這塊地這次的總用藥量</span>
        <p>這筆資料沒有稀釋倍數，無法檢核藥液濃度，請依產品標示調配。</p>
        ${officialRows}
      </div>`;
  }

  if (result.kind === 'water-only') {
    const lo = Math.round(result.byWater.min * 10) / 10;
    const hi = Math.round(result.byWater.max * 10) / 10;
    return `
      <div class="verdict info">
        <span class="verdict-label">只依用水量與稀釋倍數換算</span>
        <strong>${lo}${lo === hi ? '' : ` ～ ${hi}`} 公克或毫升</strong>
        <span class="verdict-sub">粉劑通常以公克、液劑通常以毫升量取</span>
        <p>${areaHa() > 0
            ? '這筆資料沒有每公頃用量，無法檢核整塊地的總用藥量是否超量。'
            : '先填施用面積，才能一併檢核整塊地的總用藥量。'}</p>
        ${officialRows}
      </div>`;
  }

  // kind === 'cross'：兩個限制都有資料

  if (water <= 0) {
    return `
      <div class="verdict info">
        <span class="verdict-label">先填實際用水量</span>
        <strong>${esc(formatWater(result.suggestedWater))}</strong>
        <span class="verdict-sub">這塊地在這個稀釋倍數下的合理用水量</span>
        <p>填入實際用水量後，會同時檢核面積用藥量與稀釋倍數。</p>
        ${officialRows}
      </div>`;
  }

  if (result.agreed) {
    return `
      <div class="verdict ok">
        <span class="verdict-label">用量與稀釋條件皆符合</span>
        <strong>${esc(formatRange(result.agreed, result.base))}</strong>
        <span class="verdict-sub">${water} 公升水，本次建議取用的藥量</span>
        <dl class="check-rows">
          <div><dt>依面積可用</dt><dd>${esc(formatRange(result.byArea, result.base))}</dd></div>
          <div><dt>依用水與倍數可用</dt><dd>${esc(formatRange(result.byWater, result.base))}</dd></div>
          <div><dt>合理用水量</dt><dd>${esc(formatWater(result.suggestedWater))}</dd></div>
          <div><dt>官方原文</dt><dd>${esc(rawDose || '—')}／${esc(rawDilution || '—')}</dd></div>
        </dl>
        <p>這只是數量換算的結果，不代表混配相容性、藥害或抗藥性輪替已經確認。</p>
      </div>`;
  }

  const tooLittle = result.byWater.max < result.byArea.min;

  return `
    <div class="verdict warn">
      <span class="verdict-label">用水量無法同時符合兩個條件</span>
      <strong>${esc(formatWater(result.suggestedWater))}</strong>
      <span class="verdict-sub">建議把用水量調整到這個範圍</span>
      <dl class="check-rows">
        <div><dt>依面積需要</dt><dd>${esc(formatRange(result.byArea, result.base))}</dd></div>
        <div><dt>${water} 公升水只能放</dt><dd>${esc(formatRange(result.byWater, result.base))}</dd></div>
        <div><dt>官方原文</dt><dd>${esc(rawDose || '—')}／${esc(rawDilution || '—')}</dd></div>
      </dl>
      <p>${tooLittle
          ? '用水量偏少：要噴完這塊地所需的藥量，在這個水量下濃度會超過標示的稀釋倍數。請增加用水量，或改用出水量較大的施藥設備。'
          : '用水量偏多：在這個水量下要達到標示的稀釋倍數，藥量會超過這塊地的每公頃上限。請減少用水量，或分次施作較小的面積。'}</p>
    </div>`;
}

/** 一張藥劑卡的完整輸出區（檢核卡 + 三格小資訊 + 注意事項）。 */
function itemOutputHtml(item) {
  const range = item.ranges[item.selected];
  if (!range) return '';

  const note = text(range['注意事項']) || text(range['備註']);

  return `
    <div class="calc-output">
      <div class="output-title">
        <span>${esc(text(range['病蟲害名稱']))}</span>
        <b>${esc(text(range['作物名稱']))}</b>
      </div>

      ${verdictHtml(range)}

      <dl class="mini-facts">
        <div><dt>施藥間隔</dt><dd>${esc(text(range['施藥間隔']) || '—')}</dd></div>
        <div><dt>安全採收期</dt><dd>${esc(text(range['安全採收期']) || '—')}</dd></div>
        <div><dt>施用次數</dt><dd>${esc(text(range['施用次數']) || '—')}</dd></div>
      </dl>

      ${note ? `<p class="warning-copy">田間小提醒：${esc(note)}</p>` : ''}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 畫面：用量試算                                                      */
/* ------------------------------------------------------------------ */

function calcDrugHtml(item, canRemove) {
  const head = `
    <div class="calc-drug-head">
      <span class="step-stamp">第 ${item.id} 種</span>
      ${canRemove ? `<button class="remove" type="button" data-action="item-remove" data-id="${item.id}">－ 移除</button>` : ''}
    </div>`;

  const error = item.error ? `<p class="field-error">${esc(item.error)}</p>` : '';

  if (!item.drug) {
    const results = item.results.length
      ? `<div class="result-list">${item.results
          .map((d, i) => drugCardHtml(d, 'item-pick', `data-id="${item.id}" data-idx="${i}"`, true))
          .join('')}</div>`
      : '';

    return `
      <article class="calc-drug">
        ${head}
        <div class="search-line">
          <input data-field="item-query" data-id="${item.id}" value="${esc(item.query)}"
                 placeholder="輸入普通名、廠牌或代號" aria-label="查詢施用農藥" />
          <button type="button" data-action="item-search" data-id="${item.id}"${item.loading ? ' disabled' : ''}>
            ${item.loading ? '查詢中' : '查詢'}
          </button>
        </div>
        ${error}
        ${results}
      </article>`;
  }

  const body = item.loading
    ? '<div class="empty">正在取得核准用法…</div>'
    : item.ranges.length
      ? `<label class="field">
           <span>選擇防治用途</span>
           <select data-field="item-range" data-id="${item.id}">
             ${item.ranges
               .map((r, i) => `<option value="${i}"${i === item.selected ? ' selected' : ''}>${esc(text(r['作物名稱']))}・${esc(text(r['病蟲害名稱']))}</option>`)
               .join('')}
           </select>
         </label>
         <div data-output="${item.id}">${itemOutputHtml(item)}</div>`
      : '';

  return `
    <article class="calc-drug">
      ${head}
      <div class="selected-drug">
        <div>
          <strong>${esc(drugTitle(item.drug))}</strong>
          <span>${esc(drugSubtitle(item.drug))}</span>
        </div>
        <button type="button" data-action="item-reset" data-id="${item.id}">更換</button>
      </div>
      ${body}
      ${error}
    </article>`;
}

function calcViewHtml() {
  const { crop, area, areaUnit, water, items } = state.calc;
  const ha = areaHa();

  return `
    <section class="view">
      <div class="page-title">
        <span class="eyebrow">本次施用</span>
        <h2>用藥量試算</h2>
        <p>先填作物、面積與實際用水，再逐項加入本次藥劑。</p>
      </div>

      <div class="field-card">
        <label class="field">
          <span>作物名稱</span>
          <input data-field="crop" value="${esc(crop)}" placeholder="例如：番茄" />
        </label>

        <div class="two-fields">
          <label class="field">
            <span>施用面積</span>
            <input inputmode="decimal" data-field="area" value="${esc(area)}" />
          </label>
          <label class="field">
            <span>面積單位</span>
            <select data-field="areaUnit">
              ${AREA_UNITS.map((u) => `<option value="${u.value}"${u.value === areaUnit ? ' selected' : ''}>${u.label}</option>`).join('')}
            </select>
          </label>
        </div>

        <label class="field">
          <span>實際用水量（公升）</span>
          <input inputmode="decimal" data-field="water" value="${esc(water)}" />
        </label>

        <p class="conversion" id="area-conversion">${conversionText(ha)}</p>
      </div>

      <div class="section-row">
        <h3>本次藥劑</h3>
        <span>${items.length} 種</span>
      </div>

      ${items.map((item) => calcDrugHtml(item, items.length > 1)).join('')}

      <button class="add-drug" type="button" data-action="add-item"><span>＋</span>增加一種藥劑</button>

      <div class="safety-card">
        <b>安全提醒</b>
        <p>試算會同時檢核每公頃用量與稀釋倍數，但那只是數量換算，不判斷混配相容性、藥害、抗藥性輪替或現場氣候。多種藥劑不得直接相加為同一安全範圍。</p>
      </div>
    </section>`;
}

const conversionText = (ha) =>
  `換算面積：約 ${Math.round(ha * 10000)} 平方公尺（${Math.round(ha * 10000) / 10000} 公頃）`;

/* ------------------------------------------------------------------ */
/* 畫面：設定                                                          */
/* ------------------------------------------------------------------ */

function settingsViewHtml() {
  return `
    <section class="view">
      <div class="page-title">
        <span class="eyebrow">田間小工具</span>
        <h2>設定與說明</h2>
        <p>把重要事項收在這裡，需要時再翻開。</p>
      </div>

      <button class="setting-row primary" data-action="install">
        <span><b>安裝到手機</b><small>加入主畫面，像 App 一樣開啟</small></span><i>›</i>
      </button>

      <button class="setting-row" data-action="modal" data-modal="release">
        <span><b>版本更新摘要</b><small>${VERSION}・首次收成</small></span><i>›</i>
      </button>

      <button class="setting-row" data-action="modal" data-modal="support">
        <span><b>隨喜支持</b><small>加 LINE 好友，給開發者一點鼓勵</small></span><i>›</i>
      </button>

      <article class="about-card">
        <h3>資料與責任說明</h3>
        <p>藥劑資料取自農業部「農藥資料查詢」及動植物防疫檢疫署登記資訊，每週更新。官方也明確提醒，公開使用範圍僅供參考，實際施藥應依產品標示及最新公告。</p>
        <p>本工具不替代農藥標示、專業診斷或農業主管機關指導。若作物、病蟲害或單位無法確定，請先向農業改良場、農會或合格農藥販賣業者確認。</p>
        <a href="${APHIA_URL}" target="_blank" rel="noreferrer">前往官方農藥資訊服務網</a>
      </article>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 畫面：詳細資料面板與彈窗                                            */
/* ------------------------------------------------------------------ */

function detailHtml() {
  const { drug, ranges, loading, crop } = state.detail;
  const shown = ranges.filter((r) => matchesCrop(r, crop));
  const resistance = text(drug['FRAC殺菌劑抗藥性']) || text(drug['IRAC殺蟲劑抗藥性']);

  const rangeCards = loading
    ? '<div class="empty">正在翻閱官方資料…</div>'
    : shown.length
      ? shown
          .map((r) => {
            const note = text(r['注意事項']) || text(r['備註']);
            return `
              <article class="range-card">
                <div><strong>${esc(text(r['作物名稱']))}</strong><span>${esc(text(r['病蟲害名稱']))}</span></div>
                <dl>
                  <div><dt>每公頃用量</dt><dd>${esc(text(r['每公頃使用用藥量']) || '—')}</dd></div>
                  <div><dt>稀釋倍數</dt><dd>${esc(text(r['稀釋倍數']) || '—')}</dd></div>
                  <div><dt>施藥間隔</dt><dd>${esc(text(r['施藥間隔']) || '—')}</dd></div>
                  <div><dt>安全採收期</dt><dd>${esc(text(r['安全採收期']) || '—')}</dd></div>
                  <div class="wide"><dt>使用時期</dt><dd>${esc(text(r['使用時期']) || '—')}</dd></div>
                </dl>
                ${note ? `<p>${esc(note)}</p>` : ''}
              </article>`;
          })
          .join('')
      : '<div class="empty">沒有符合這個作物名稱的核准範圍。</div>';

  return `
    <div class="sheet-backdrop" data-action="close-detail">
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <div><span class="eyebrow">藥劑說明</span><h2 id="detail-title">${esc(drugTitle(drug))}</h2></div>
          <button class="icon-btn" data-action="close-detail" aria-label="關閉">×</button>
        </div>

        <div class="detail-grid">
          <div><span>普通名稱</span><b>${esc(text(drug['中文名稱']) || '—')}</b></div>
          <div><span>分類</span><b>${esc(text(drug['農藥分類中文意義']) || '—')}</b></div>
          <div><span>含量／劑型</span><b>${esc([text(drug['含量']), text(drug['劑型'])].filter(Boolean).join(' ') || '—')}</b></div>
          <div><span>抗藥性代碼</span><b>${esc(resistance || '未提供')}</b></div>
          <div class="wide"><span>有效成分</span><b>${esc(text(drug['化學成分']) || '—')}</b></div>
          <div class="wide"><span>許可證／有效期限</span><b>${esc(license(drug))}・${esc(text(drug['有效期限']) || '—')}</b></div>
        </div>

        <div class="section-row"><h3>核准使用範圍</h3><span>${ranges.length} 筆</span></div>

        <label class="field">
          <span>篩選作物</span>
          <input data-field="detail-crop" value="${esc(crop)}" placeholder="例如：番茄、稻、檬果" />
        </label>

        <div id="detail-ranges">${rangeCards}</div>

        <p class="legal-note">官方資料僅供參考，實際施用仍應以手上產品的中文標示與最新公告為準。</p>
      </section>
    </div>`;
}

function modalHtml() {
  const bodies = {
    release: `
      <span class="eyebrow">版本更新</span>
      <h2>${VERSION}・首次收成</h2>
      <ul>
        <li>新增殺菌劑、殺蟲劑官方資料查詢。</li>
        <li>可依作物、面積、實際用水與多種藥劑逐項試算。</li>
        <li>用藥量與稀釋倍數同時檢核，並提示合理用水量。</li>
        <li>加入安裝提示、離線外殼與資料安全說明。</li>
      </ul>`,
    install: `
      <span class="eyebrow">安裝到手機</span>
      <h2>把田間用藥帶著走</h2>
      <p>iPhone：用 Safari 開啟，點分享，再選「加入主畫面」。<br />Android：用 Chrome 開啟選單，選「安裝應用程式」。</p>`,
    support: `
      <span class="eyebrow">隨喜支持</span>
      <h2>謝謝你的鼓勵</h2>
      <p>可以先加入 LINE 好友，留言告訴我你最常種的作物，或回報使用上的問題。</p>
      <a class="modal-action" href="${LINE_URL}" target="_blank" rel="noreferrer">開啟 LINE</a>`,
  };

  return `
    <div class="sheet-backdrop" data-action="close-modal">
      <section class="mini-modal" role="dialog" aria-modal="true">
        <button class="icon-btn close" data-action="close-modal" aria-label="關閉">×</button>
        ${bodies[state.modal]}
      </section>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

const views = { search: searchViewHtml, calc: calcViewHtml, settings: settingsViewHtml };

/** 重畫整個分頁。使用者正在打字時不要呼叫這個，游標會跑掉。 */
function render() {
  screenEl.innerHTML = views[state.tab]();
  for (const button of tabsEl.querySelectorAll('button')) {
    button.setAttribute('aria-current', String(button.dataset.tab === state.tab));
  }
  renderOverlay();
}

function renderOverlay() {
  overlayEl.innerHTML = state.detail ? detailHtml() : state.modal ? modalHtml() : '';
}

/**
 * 只更新受面積／用水量影響的區塊。
 * 這樣使用者在輸入框裡打字時，輸入框本身不會被重建，游標才不會跳掉。
 */
function renderOutputsOnly() {
  const conversion = document.getElementById('area-conversion');
  if (conversion) conversion.textContent = conversionText(areaHa());

  for (const item of state.calc.items) {
    const holder = screenEl.querySelector(`[data-output="${item.id}"]`);
    if (holder) holder.innerHTML = itemOutputHtml(item);
  }
}

/** 只更新詳細面板裡的使用範圍列表，同樣是為了保住輸入游標。 */
function renderDetailRangesOnly() {
  const holder = document.getElementById('detail-ranges');
  if (!holder || !state.detail) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = detailHtml();
  const fresh = wrapper.querySelector('#detail-ranges');
  if (fresh) holder.innerHTML = fresh.innerHTML;
}

/* ------------------------------------------------------------------ */
/* 動作                                                                */
/* ------------------------------------------------------------------ */

async function runMainSearch() {
  state.search.loading = true;
  state.search.drugs = [];
  state.search.message = '正在翻閱官方登記資料…';
  render();

  try {
    const rows = await searchDrugs(state.search.query);
    state.search.drugs = rows;
    state.search.message = rows.length
      ? `找到 ${rows.length} 筆有效的殺菌／殺蟲劑`
      : '沒有找到仍有效且符合分類的藥劑';
  } catch (e) {
    state.search.message = e instanceof Error ? e.message : '查詢失敗';
  } finally {
    state.search.loading = false;
    render();
  }
}

async function openDetail(drug) {
  state.detail = { drug, ranges: [], loading: true, crop: '' };
  renderOverlay();
  try {
    state.detail.ranges = await loadRanges(drug);
  } catch {
    state.detail.ranges = [];
  } finally {
    if (state.detail) {
      state.detail.loading = false;
      renderOverlay();
    }
  }
}

async function runItemSearch(item) {
  item.loading = true;
  item.error = '';
  render();

  try {
    item.results = await searchDrugs(item.query);
  } catch (e) {
    item.error = e instanceof Error ? e.message : '查詢失敗';
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
    const all = await loadRanges(drug);
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

async function install() {
  const prompt = state.installPrompt;
  if (prompt && typeof prompt.prompt === 'function') {
    await prompt.prompt();
    state.modal = null;
    renderOverlay();
  } else {
    // iOS 沒有 beforeinstallprompt，只能給手動加入主畫面的說明。
    state.modal = 'install';
    renderOverlay();
  }
}

function closeModal() {
  // 關掉更新說明才算「看過」，中途離開下次還會再提醒一次。
  if (state.modal === 'release') store.set('seen-version', VERSION);
  state.modal = null;
  renderOverlay();
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  // 點背景關閉時，只有點到背景本身才算，點到面板內容不算。
  const isBackdrop = target.classList.contains('sheet-backdrop');
  if (isBackdrop && event.target !== target) return;

  const { action, id, idx, modal, tab } = target.dataset;

  if (action === 'tab') {
    state.tab = tab;
    render();
  } else if (action === 'open-detail') {
    openDetail(state.search.drugs[Number(idx)]);
  } else if (action === 'close-detail') {
    state.detail = null;
    renderOverlay();
  } else if (action === 'modal') {
    state.modal = modal;
    renderOverlay();
  } else if (action === 'close-modal') {
    closeModal();
  } else if (action === 'install') {
    install();
  } else if (action === 'add-item') {
    state.calc.items.push(emptyItem());
    render();
  } else if (action === 'item-remove') {
    state.calc.items = state.calc.items.filter((i) => i.id !== Number(id));
    render();
  } else if (action === 'item-search') {
    runItemSearch(findItem(id));
  } else if (action === 'item-pick') {
    const item = findItem(id);
    pickItemDrug(item, item.results[Number(idx)]);
  } else if (action === 'item-reset') {
    const item = findItem(id);
    Object.assign(item, { drug: null, ranges: [], query: '', error: '', selected: 0 });
    render();
  }
});

document.addEventListener('input', (event) => {
  const { field, id } = event.target.dataset;
  if (!field) return;
  const value = event.target.value;

  if (field === 'search-query') {
    state.search.query = value;
  } else if (field === 'item-query') {
    findItem(id).query = value;
  } else if (field === 'detail-crop') {
    state.detail.crop = value;
    renderDetailRangesOnly();
  } else if (field === 'crop') {
    state.calc.crop = value;
  } else if (field === 'area' || field === 'water') {
    state.calc[field] = value;
    renderOutputsOnly();
  }
});

document.addEventListener('change', (event) => {
  const { field, id } = event.target.dataset;
  if (field === 'areaUnit') {
    state.calc.areaUnit = event.target.value;
    renderOutputsOnly();
  } else if (field === 'item-range') {
    findItem(id).selected = Number(event.target.value);
    renderOutputsOnly();
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'search-form') {
    event.preventDefault();
    runMainSearch();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (event.target.dataset.field === 'item-query') {
    event.preventDefault();
    runItemSearch(findItem(event.target.dataset.id));
  }
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

if (store.get('seen-version') !== VERSION) state.modal = 'release';

render();
