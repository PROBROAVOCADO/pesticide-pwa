/**
 * 畫面組裝。
 *
 * 這裡的函式都是純函式：吃資料、吐 HTML 字串，不碰 state 也不碰資料庫。
 * 所有動態內容一律經過 esc()，因為官方資料會直接進 innerHTML。
 */

import { AREA_UNITS, calcRange, formatRange, formatWater } from './calc.js';
import { drugSubtitle, drugTitle, license, text } from './moa.js';
import {
  areaLabel,
  formatDisplayDate,
  formatSlashDate,
  modeLabel,
  monthGrid,
  todayKey,
} from './records.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const AREA_UNIT_LABEL = Object.fromEntries(AREA_UNITS.map((u) => [u.value, u.label]));

/* ------------------------------------------------------------------ */
/* 藥劑卡                                                              */
/* ------------------------------------------------------------------ */

export function drugCardHtml(drug, action, dataAttr, compact) {
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
/* 藥劑查詢分頁                                                        */
/* ------------------------------------------------------------------ */

export function searchViewHtml({ query, drugs, loading, message, fromCache }) {
  const results = drugs.length
    ? `${fromCache ? '<p class="offline-note">目前連不上官方資料，以下是這台裝置查過的藥劑。</p>' : ''}
       <div class="drug-grid">${drugs.map((d, i) => drugCardHtml(d, 'open-detail', `data-idx="${i}"`, false)).join('')}</div>`
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
/* 試算結果檢核卡                                                      */
/* ------------------------------------------------------------------ */

export function verdictHtml(range, areaHa, water) {
  const rawDose = text(range['每公頃使用用藥量']);
  const rawDilution = text(range['稀釋倍數']);
  const result = calcRange(rawDose, rawDilution, areaHa, water);

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
        <p>${areaHa > 0
            ? '這筆資料沒有每公頃用量，無法檢核整塊地的總用藥量是否超量。'
            : '先填施用面積，才能一併檢核整塊地的總用藥量。'}</p>
        ${officialRows}
      </div>`;
  }

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

export function itemOutputHtml(item, areaHa, water) {
  const range = item.ranges[item.selected];
  if (!range) return '';

  const note = text(range['注意事項']) || text(range['備註']);

  return `
    <div class="calc-output">
      <div class="output-title">
        <span>${esc(text(range['病蟲害名稱']))}</span>
        <b>${esc(text(range['作物名稱']))}</b>
      </div>

      ${verdictHtml(range, areaHa, water)}

      <dl class="mini-facts">
        <div><dt>施藥間隔</dt><dd>${esc(text(range['施藥間隔']) || '—')}</dd></div>
        <div><dt>安全採收期</dt><dd>${esc(text(range['安全採收期']) || '—')}</dd></div>
        <div><dt>施用次數</dt><dd>${esc(text(range['施用次數']) || '—')}</dd></div>
      </dl>

      ${note ? `<p class="warning-copy">田間小提醒：${esc(note)}</p>` : ''}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 用量試算分頁                                                        */
/* ------------------------------------------------------------------ */

function calcDrugHtml(item, canRemove, areaHa, water) {
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
         <div data-output="${item.id}">${itemOutputHtml(item, areaHa, water)}</div>`
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

export const conversionText = (ha) =>
  `換算面積：約 ${Math.round(ha * 10000)} 平方公尺（${Math.round(ha * 10000) / 10000} 公頃）`;

/** 土地快捷卡片列。選一塊地就自動帶入面積、單位與作物。 */
function fieldChipsHtml(fields, selectedId) {
  const chips = fields
    .map(
      (f) => `
      <button type="button" class="field-chip${f.id === selectedId ? ' active' : ''}" data-action="pick-field" data-id="${esc(f.id)}">
        <strong>${esc(f.name)}</strong>
        <span>${esc(f.area)} ${esc(AREA_UNIT_LABEL[f.unit] || '')}${f.crop ? `・${esc(f.crop)}` : ''}</span>
      </button>`,
    )
    .join('');

  return `
    <div class="field-chips">
      ${chips}
      <button type="button" class="field-chip add" data-action="open-fields">
        <strong>＋ ${fields.length ? '管理土地' : '新增土地'}</strong>
        <span>${fields.length ? '編輯或新增' : '記住面積與作物'}</span>
      </button>
    </div>`;
}

export function calcViewHtml(calc, fields, areaHa, canRecord) {
  const { crop, area, areaUnit, water, items, fieldId } = calc;

  return `
    <section class="view">
      <div class="page-title">
        <span class="eyebrow">本次施用</span>
        <h2>用藥量試算</h2>
        <p>先選土地或直接填面積，再逐項加入本次藥劑。</p>
      </div>

      ${fieldChipsHtml(fields, fieldId)}

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

        <p class="conversion" id="area-conversion">${conversionText(areaHa)}</p>
      </div>

      <div class="section-row">
        <h3>本次藥劑</h3>
        <span>${items.length} 種</span>
      </div>

      ${items.map((item) => calcDrugHtml(item, items.length > 1, areaHa, Number(water) || 0)).join('')}

      <button class="add-drug" type="button" data-action="add-item"><span>＋</span>增加一種藥劑</button>

      <button class="record-cta" type="button" data-action="open-record-form"${canRecord ? '' : ' disabled'}>
        完成施作並記錄
      </button>
      <p class="cta-note">${canRecord
        ? '試算不會自動變成紀錄。實際噴完之後再按這裡，填入真正用掉的量。'
        : '選好藥劑與防治用途之後，就可以把這次施作記下來。'}</p>

      <div class="safety-card">
        <b>安全提醒</b>
        <p>試算會同時檢核每公頃用量與稀釋倍數，但那只是數量換算，不判斷混配相容性、藥害、抗藥性輪替或現場氣候。多種藥劑不得直接相加為同一安全範圍。</p>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 施作紀錄分頁                                                        */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function pendingHtml(pending) {
  if (!pending.length) return '';

  const rows = pending
    .map(
      (p) => `
      <div class="pending-row">
        <div>
          <strong>${esc(p.fieldName || '未命名')}</strong>
          <span>${esc(p.crop || '—')}・${esc(formatSlashDate(p.from))} 施作</span>
        </div>
        <b>還有 ${p.daysLeft} 天</b>
      </div>`,
    )
    .join('');

  return `
    <div class="pending-card">
      <b>尚未到參考採收日</b>
      ${rows}
      <p>依本機施作紀錄推算。漏記的施藥不會被算進來，實際採收仍請自行確認。</p>
    </div>`;
}

function recordRowHtml(app) {
  const drugs = app.drugs.map((d) => d.name).filter(Boolean).join('、');
  return `
    <button type="button" class="record-row" data-action="open-record" data-id="${esc(app.id)}">
      <div class="record-row-head">
        <strong>${esc(formatDisplayDate(app.date))}・${esc(app.fieldName || '未命名')}</strong>
        <span class="mode-tag">${esc(modeLabel(app.mode))}</span>
      </div>
      <span>${esc(app.crop || '—')}・${esc(areaLabel(app))}・${app.drugs.length} 種藥劑</span>
      <small>${esc(drugs || '—')}</small>
    </button>`;
}

export function recordsViewHtml({ month, applications, selected, pending, filterFieldId, fields }) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const today = todayKey();

  const filtered = filterFieldId ? applications.filter((a) => a.fieldId === filterFieldId) : applications;

  const countByDate = new Map();
  for (const app of filtered) countByDate.set(app.date, (countByDate.get(app.date) || 0) + 1);

  const cells = monthGrid(year, monthIndex)
    .map((cell) => {
      const count = countByDate.get(cell.key) || 0;
      const classes = [
        'cal-cell',
        cell.inMonth ? '' : 'outside',
        cell.key === today ? 'today' : '',
        cell.key === selected ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `
        <button type="button" class="${classes}" data-action="pick-date" data-date="${cell.key}">
          <span>${cell.day}</span>
          ${count ? `<i class="dot"${count > 1 ? ' data-many="1"' : ''}></i>` : ''}
        </button>`;
    })
    .join('');

  const dayRecords = selected ? filtered.filter((a) => a.date === selected) : [];

  const listBody = selected
    ? dayRecords.length
      ? dayRecords.map(recordRowHtml).join('')
      : `<div class="empty">${esc(formatDisplayDate(selected))}沒有施作紀錄。</div>`
    : filtered.length
      ? filtered.slice(0, 12).map(recordRowHtml).join('')
      : `<div class="welcome-card">
           <b>還沒有任何紀錄</b>
           <p>到「用量試算」選好土地與藥劑，實際噴完之後按「完成施作並記錄」，這裡就會出現。</p>
         </div>`;

  return `
    <section class="view">
      <div class="page-title">
        <span class="eyebrow">下田做了什麼</span>
        <h2>施作紀錄</h2>
        <p>只保存在這支手機，不上傳任何地方。記得定期到設定頁匯出備份。</p>
      </div>

      ${pendingHtml(pending)}

      ${fields.length
        ? `<label class="field">
             <span>篩選土地</span>
             <select data-field="filter-field">
               <option value=""${filterFieldId ? '' : ' selected'}>全部土地</option>
               ${fields.map((f) => `<option value="${esc(f.id)}"${f.id === filterFieldId ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}
             </select>
           </label>`
        : ''}

      <div class="calendar">
        <div class="cal-head">
          <button type="button" class="icon-btn" data-action="month-prev" aria-label="上個月">‹</button>
          <b>${year} 年 ${monthIndex + 1} 月</b>
          <button type="button" class="icon-btn" data-action="month-next" aria-label="下個月">›</button>
        </div>
        <div class="cal-weekdays">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
      </div>

      <div class="section-row">
        <h3>${selected ? formatDisplayDate(selected) : '最近的紀錄'}</h3>
        <span>${selected ? `${dayRecords.length} 筆` : `共 ${filtered.length} 筆`}</span>
      </div>

      ${selected ? '<button type="button" class="clear-date" data-action="clear-date">← 顯示最近的紀錄</button>' : ''}

      ${listBody}
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 設定分頁                                                            */
/* ------------------------------------------------------------------ */

export function settingsViewHtml({ version, aphiaUrl, fieldCount, appCount, persisted, dbError }) {
  return `
    <section class="view">
      <div class="page-title">
        <span class="eyebrow">田間小工具</span>
        <h2>設定與說明</h2>
        <p>把重要事項收在這裡，需要時再翻開。</p>
      </div>

      ${dbError ? `<div class="safety-card"><b>本機儲存無法使用</b><p>${esc(dbError)}查詢與試算仍可正常使用，但土地與施作紀錄無法保存。無痕模式是常見原因。</p></div>` : ''}

      <button class="setting-row primary" data-action="install">
        <span><b>安裝到手機</b><small>加入主畫面，像 App 一樣開啟</small></span><i>›</i>
      </button>

      <div class="section-row"><h3>我的資料</h3><span>只在這支手機</span></div>

      <button class="setting-row" data-action="open-fields">
        <span><b>土地管理</b><small>目前 ${fieldCount} 筆</small></span><i>›</i>
      </button>

      <button class="setting-row" data-action="export-backup">
        <span><b>匯出備份</b><small>${appCount} 筆施作紀錄，存成一個檔案</small></span><i>›</i>
      </button>

      <button class="setting-row" data-action="import-backup">
        <span><b>匯入備份</b><small>換手機時把資料帶回來</small></span><i>›</i>
      </button>

      <article class="about-card">
        <h3>資料會在什麼時候消失</h3>
        <p>土地與施作紀錄存在這個瀏覽器的網站資料區，不會上傳到任何後台，我們也看不到。但以下情況資料會不見：</p>
        <ul>
          <li>清除這個網站的「網站資料」或瀏覽紀錄</li>
          <li>使用無痕模式並關閉分頁</li>
          <li>換手機、換瀏覽器</li>
          <li>手機空間嚴重不足時被系統清理</li>
        </ul>
        <p><b>${persisted ? '這台裝置已取得持久儲存，被系統自動清理的機率較低。' : '這台裝置尚未取得持久儲存權限，建議把網站安裝到主畫面。'}</b>
        不論如何，重要的施作紀錄請定期匯出備份，或在記錄完成後一併加入手機行事曆。</p>
      </article>

      <button class="setting-row" data-action="modal" data-modal="release">
        <span><b>版本更新摘要</b><small>${esc(version)}</small></span><i>›</i>
      </button>

      <button class="setting-row" data-action="modal" data-modal="support">
        <span><b>隨喜支持</b><small>加 LINE 好友，給開發者一點鼓勵</small></span><i>›</i>
      </button>

      <article class="about-card">
        <h3>資料與責任說明</h3>
        <p>藥劑資料取自農業部「農藥資料查詢」及動植物防疫檢疫署登記資訊，每週更新。官方也明確提醒，公開使用範圍僅供參考，實際施藥應依產品標示及最新公告。</p>
        <p>本工具不替代農藥標示、專業診斷或農業主管機關指導。若作物、病蟲害或單位無法確定，請先向農業改良場、農會或合格農藥販賣業者確認。</p>
        <a href="${aphiaUrl}" target="_blank" rel="noreferrer">前往官方農藥資訊服務網</a>
      </article>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 藥劑詳細資料面板                                                    */
/* ------------------------------------------------------------------ */

export function detailHtml({ drug, ranges, loading, crop, shown }) {
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

  return sheetHtml({
    eyebrow: '藥劑說明',
    title: drugTitle(drug),
    closeAction: 'close-overlay',
    body: `
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

      <p class="legal-note">官方資料僅供參考，實際施用仍應以手上產品的中文標示與最新公告為準。</p>`,
  });
}

/* ------------------------------------------------------------------ */
/* 通用面板外框                                                        */
/* ------------------------------------------------------------------ */

function sheetHtml({ eyebrow, title, body, closeAction }) {
  return `
    <div class="sheet-backdrop" data-action="${closeAction}">
      <section class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2></div>
          <button class="icon-btn" data-action="${closeAction}" aria-label="關閉">×</button>
        </div>
        ${body}
      </section>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 土地管理                                                            */
/* ------------------------------------------------------------------ */

export function fieldsSheetHtml(fields) {
  const rows = fields.length
    ? fields
        .map(
          (f) => `
        <article class="field-row">
          <div>
            <strong>${esc(f.name)}</strong>
            <span>${esc(f.area)} ${esc(AREA_UNIT_LABEL[f.unit] || '')}${f.crop ? `・${esc(f.crop)}` : ''}</span>
          </div>
          <div class="field-row-actions">
            <button type="button" data-action="edit-field" data-id="${esc(f.id)}">編輯</button>
            <button type="button" class="danger" data-action="delete-field" data-id="${esc(f.id)}">刪除</button>
          </div>
        </article>`,
        )
        .join('')
    : `<div class="welcome-card">
         <b>還沒有登記土地</b>
         <p>把常用的地登記起來，之後試算只要點一下就會帶入面積與作物，不必每次重打。</p>
       </div>`;

  return sheetHtml({
    eyebrow: '我的土地',
    title: '土地管理',
    closeAction: 'close-overlay',
    body: `
      ${rows}
      <button class="add-drug" type="button" data-action="new-field"><span>＋</span>新增一塊地</button>
      <p class="legal-note">土地資料只存在這支手機，不會上傳。換手機前記得到設定頁匯出備份。</p>`,
  });
}

export function fieldFormHtml(form) {
  return sheetHtml({
    eyebrow: form.id ? '編輯土地' : '新增土地',
    title: form.id ? form.name || '編輯土地' : '新增一塊地',
    closeAction: 'open-fields',
    body: `
      <label class="field">
        <span>土地名稱</span>
        <input data-field="field-name" value="${esc(form.name)}" placeholder="例如：後山酪梨園" />
      </label>

      <div class="two-fields">
        <label class="field">
          <span>面積</span>
          <input inputmode="decimal" data-field="field-area" value="${esc(form.area)}" />
        </label>
        <label class="field">
          <span>單位</span>
          <select data-field="field-unit">
            ${AREA_UNITS.map((u) => `<option value="${u.value}"${u.value === form.unit ? ' selected' : ''}>${u.label}</option>`).join('')}
          </select>
        </label>
      </div>

      <label class="field">
        <span>主要作物</span>
        <input data-field="field-crop" value="${esc(form.crop)}" placeholder="例如：酪梨" />
      </label>

      ${form.error ? `<p class="field-error">${esc(form.error)}</p>` : ''}

      <button class="record-cta" type="button" data-action="save-field">儲存</button>
      <button class="ghost-btn" type="button" data-action="open-fields">取消</button>`,
  });
}

/* ------------------------------------------------------------------ */
/* 施作紀錄表單                                                        */
/* ------------------------------------------------------------------ */

export function recordFormHtml(draft) {
  const drugRows = draft.drugs
    .map(
      (d, i) => `
      <article class="record-drug">
        <div class="record-drug-head">
          <strong>${esc(d.name)}</strong>
          ${draft.drugs.length > 1 ? `<button type="button" class="remove" data-action="record-drug-remove" data-idx="${i}">－ 移除</button>` : ''}
        </div>
        <span class="record-drug-sub">${esc(d.target || '—')}${d.dilution ? `・稀釋 ${esc(d.dilution)}` : ''}</span>

        <div class="two-fields">
          <label class="field">
            <span>實際用量</span>
            <input inputmode="decimal" data-field="record-amount" data-idx="${i}" value="${esc(d.amount)}" />
          </label>
          <label class="field">
            <span>單位</span>
            <select data-field="record-amount-unit" data-idx="${i}">
              ${['公克', '毫升', '公斤', '公升'].map((u) => `<option value="${u}"${u === d.amountUnit ? ' selected' : ''}>${u}</option>`).join('')}
            </select>
          </label>
        </div>

        ${draft.mode === 'separate'
          ? `<label class="field">
               <span>這一次的用水量（公升）</span>
               <input inputmode="decimal" data-field="record-drug-water" data-idx="${i}" value="${esc(d.water ?? '')}" />
             </label>`
          : ''}

        ${d.suggestion ? `<p class="suggestion">試算建議：${esc(d.suggestion)}</p>` : ''}
        <dl class="check-rows">
          <div><dt>當時安全採收期</dt><dd>${esc(d.phi || '未提供')}</dd></div>
          <div><dt>當時施藥間隔</dt><dd>${esc(d.interval || '未提供')}</dd></div>
        </dl>
      </article>`,
    )
    .join('');

  const harvest = draft.harvestDate
    ? `<div class="verdict ok">
         <span class="verdict-label">參考最早採收日</span>
         <strong>${esc(formatSlashDate(draft.harvestDate))}</strong>
         <span class="verdict-sub">施作日加上最長的安全採收期 ${draft.harvestDays} 天</span>
         ${draft.harvestUnknown ? '<p>其中有藥劑沒有標示天數，這個日期只涵蓋看得懂的部分。</p>' : ''}
       </div>`
    : `<div class="verdict warn">
         <span class="verdict-label">無法推算採收日</span>
         <strong>請查閱產品標示</strong>
         <span class="verdict-sub">這次的藥劑都沒有可讀取的安全採收期天數</span>
       </div>`;

  return sheetHtml({
    eyebrow: draft.id ? '編輯紀錄' : '完成施作',
    title: draft.id ? '編輯施作紀錄' : '記下這次施作',
    closeAction: 'close-overlay',
    body: `
      <p class="legal-note">保存的是你確認過的實際用量，不是試算值。試算結果只放在旁邊當參考。</p>

      <div class="two-fields">
        <label class="field">
          <span>施作日期</span>
          <input type="date" data-field="record-date" value="${esc(draft.date)}" />
        </label>
        <label class="field">
          <span>時間（可留空）</span>
          <input type="time" data-field="record-time" value="${esc(draft.time)}" />
        </label>
      </div>

      <label class="field">
        <span>土地名稱</span>
        <input data-field="record-field-name" value="${esc(draft.fieldName)}" placeholder="例如：後山酪梨園" />
      </label>

      <div class="two-fields">
        <label class="field">
          <span>實際施作面積</span>
          <input inputmode="decimal" data-field="record-area" value="${esc(draft.area)}" />
        </label>
        <label class="field">
          <span>單位</span>
          <select data-field="record-unit">
            ${AREA_UNITS.map((u) => `<option value="${u.value}"${u.value === draft.unit ? ' selected' : ''}>${u.label}</option>`).join('')}
          </select>
        </label>
      </div>

      <label class="field">
        <span>作物</span>
        <input data-field="record-crop" value="${esc(draft.crop)}" placeholder="例如：酪梨" />
      </label>

      <div class="mode-switch">
        <button type="button" class="${draft.mode === 'tank' ? 'active' : ''}" data-action="record-mode" data-mode="tank">
          <b>同桶混用</b><small>多種藥共用一桶水</small>
        </button>
        <button type="button" class="${draft.mode === 'separate' ? 'active' : ''}" data-action="record-mode" data-mode="separate">
          <b>分開施用</b><small>每種藥各自用水</small>
        </button>
      </div>
      <p class="legal-note">這裡只是忠實記下你怎麼做的。App 不會因為兩種藥都能用在同一作物，就代表它們可以安全混用。</p>

      ${draft.mode === 'tank'
        ? `<label class="field">
             <span>實際總用水量（公升）</span>
             <input inputmode="decimal" data-field="record-water" value="${esc(draft.water)}" />
           </label>`
        : ''}

      <div class="section-row"><h3>本次用藥</h3><span>${draft.drugs.length} 種</span></div>
      ${drugRows}

      <label class="field">
        <span>備註</span>
        <input data-field="record-note" value="${esc(draft.note)}" placeholder="例如：下午完成、風大改噴下風處" />
      </label>

      ${harvest}

      ${draft.error ? `<p class="field-error">${esc(draft.error)}</p>` : ''}

      <button class="record-cta" type="button" data-action="save-record">${draft.id ? '儲存修改' : '確認並保存到本機'}</button>
      <button class="ghost-btn" type="button" data-action="close-overlay">取消</button>`,
  });
}

/* ------------------------------------------------------------------ */
/* 單筆紀錄檢視                                                        */
/* ------------------------------------------------------------------ */

export function recordDetailHtml(app, confirmDelete) {
  const drugs = app.drugs
    .map(
      (d, i) => `
      <article class="range-card">
        <div><strong>${i + 1}. ${esc(d.name)}</strong><span>${esc(d.amount)} ${esc(d.amountUnit)}</span></div>
        <dl>
          <div><dt>防治對象</dt><dd>${esc(d.target || '—')}</dd></div>
          <div><dt>稀釋倍數</dt><dd>${esc(d.dilution || '—')}</dd></div>
          <div><dt>當時安全採收期</dt><dd>${esc(d.phi || '—')}</dd></div>
          <div><dt>當時施藥間隔</dt><dd>${esc(d.interval || '—')}</dd></div>
          ${app.mode === 'separate' && d.water ? `<div class="wide"><dt>這一次的用水量</dt><dd>${esc(d.water)} 公升</dd></div>` : ''}
        </dl>
      </article>`,
    )
    .join('');

  return sheetHtml({
    eyebrow: `${formatSlashDate(app.date)}${app.time ? ` ${app.time}` : ''}`,
    title: app.fieldName || '未命名',
    closeAction: 'close-overlay',
    body: `
      <div class="detail-grid">
        <div><span>作物</span><b>${esc(app.crop || '—')}</b></div>
        <div><span>施作面積</span><b>${esc(areaLabel(app))}</b></div>
        <div><span>施作方式</span><b>${esc(modeLabel(app.mode))}</b></div>
        <div><span>${app.mode === 'tank' ? '實際總用水' : '用水'}</span><b>${app.mode === 'tank' ? `${esc(app.water)} 公升` : '各自記錄'}</b></div>
        ${app.note ? `<div class="wide"><span>備註</span><b>${esc(app.note)}</b></div>` : ''}
        <div class="wide"><span>參考最早採收日</span><b>${app.harvestDate ? esc(formatSlashDate(app.harvestDate)) : '無法推算'}</b></div>
      </div>

      <div class="section-row"><h3>本次用藥</h3><span>${app.drugs.length} 種</span></div>
      ${drugs}

      <div class="section-row"><h3>備份到手機行事曆</h3><span>不會自動同步</span></div>
      <p class="legal-note">這兩份資料各自獨立。之後在這裡修改或刪除紀錄，不會連動改到手機行事曆，需要重新輸出一次。</p>

      <button class="record-cta" type="button" data-action="copy-record" data-id="${esc(app.id)}">複製完整紀錄</button>
      <button class="ghost-btn" type="button" data-action="download-ics" data-id="${esc(app.id)}">下載行事曆檔（iPhone 適用）</button>
      <button class="ghost-btn" type="button" data-action="open-google-calendar" data-id="${esc(app.id)}">用 Google 日曆新增</button>

      <div class="section-row"><h3>這筆紀錄</h3><span></span></div>
      <button class="ghost-btn" type="button" data-action="edit-record" data-id="${esc(app.id)}">編輯</button>
      ${confirmDelete
        ? `<div class="safety-card">
             <b>確定要刪除嗎？</b>
             <p>刪掉之後就找不回來了。如果你已經加到手機行事曆，那一份不會跟著刪除。</p>
             <button class="danger-btn" type="button" data-action="delete-record-confirm" data-id="${esc(app.id)}">確定刪除</button>
             <button class="ghost-btn" type="button" data-action="delete-record-cancel">取消</button>
           </div>`
        : `<button class="ghost-btn danger" type="button" data-action="delete-record" data-id="${esc(app.id)}">刪除</button>`}`,
  });
}

/* ------------------------------------------------------------------ */
/* 小彈窗                                                              */
/* ------------------------------------------------------------------ */

export function modalHtml(kind, { version, lineUrl, message } = {}) {
  const bodies = {
    release: `
      <span class="eyebrow">版本更新</span>
      <h2>${esc(version)}</h2>
      <ul>
        <li>新增土地管理，試算時可快捷選地帶入面積與作物。</li>
        <li>新增施作紀錄與月曆，可推算參考最早採收日。</li>
        <li>紀錄可複製或加入手機行事曆，另外提供匯出備份。</li>
        <li>查過的藥劑會存在本機，沒訊號時仍可翻查。</li>
      </ul>`,
    install: `
      <span class="eyebrow">安裝到手機</span>
      <h2>把田間用藥帶著走</h2>
      <p>iPhone：用 Safari 開啟，點分享，再選「加入主畫面」。<br />Android：用 Chrome 開啟選單，選「安裝應用程式」。</p>
      <p>安裝之後資料被系統清理的機率較低，也能在沒訊號的田裡開啟。</p>`,
    support: `
      <span class="eyebrow">隨喜支持</span>
      <h2>謝謝你的鼓勵</h2>
      <p>可以先加入 LINE 好友，留言告訴我你最常種的作物，或回報使用上的問題。</p>
      <a class="modal-action" href="${lineUrl}" target="_blank" rel="noreferrer">開啟 LINE</a>`,
    notice: `
      <span class="eyebrow">提醒</span>
      <h2>${esc(message?.title || '')}</h2>
      <p>${esc(message?.body || '')}</p>`,
  };

  return `
    <div class="sheet-backdrop" data-action="close-overlay">
      <section class="mini-modal" role="dialog" aria-modal="true">
        <button class="icon-btn close" data-action="close-overlay" aria-label="關閉">×</button>
        ${bodies[kind] || ''}
      </section>
    </div>`;
}

/** 短暫的提示條，用在「已複製」這種不需要打斷操作的訊息。 */
export const toastHtml = (message) => `<div class="toast">${esc(message)}</div>`;
