/**
 * 畫面組裝。
 *
 * 這裡的函式都是純函式：吃資料、吐 HTML 字串，不碰 state 也不碰資料庫。
 * 所有動態內容一律經過 esc()，因為官方資料會直接進 innerHTML。
 */

import { AREA_UNITS, actualDilution, assessApplication, calcRange, formatRange, formatWater, toHectares } from './calc.js';
import { classTone, drugIdentity, drugSubtitle, drugTitle, license, licenseStatus, text } from './moa.js';
import {
  addDays,
  areaLabel,
  formatDisplayDate,
  formatSlashDate,
  modeLabel,
  monthGrid,
  parseDays,
  todayKey,
} from './records.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const AREA_UNIT_LABEL = Object.fromEntries(AREA_UNITS.map((u) => [u.value, u.label]));

/* ------------------------------------------------------------------ */
/* 藥劑卡                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把關鍵字標起來。
 *
 * 每一段文字都各自 escape 之後才拼接，只有 <mark> 是我們自己插進去的字面標籤 ——
 * 官方資料裡的任何角括號都不會變成 HTML。
 */
export function highlight(value, keyword) {
  const source = String(value ?? '');
  const needle = String(keyword ?? '').trim();
  if (!needle) return esc(source);

  const haystack = source.toLowerCase();
  const lower = needle.toLowerCase();

  let out = '';
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(lower, from);
    if (at === -1) {
      out += esc(source.slice(from));
      return out;
    }
    out += esc(source.slice(from, at));
    out += `<mark>${esc(source.slice(at, at + needle.length))}</mark>`;
    from = at + needle.length;
  }
}

/**
 * 藥劑卡。
 *
 * 兩個名字都要看得見：
 *   廠牌名稱（商品名）—— 農友去農藥行是報這個
 *   中文名稱（普通名）—— 農友是用這個在搜尋
 *
 * 只顯示其中一個都會出事。全部退回普通名時一整排都叫「賽洛寧」分不出來；
 * 只顯示廠牌時，打「滅達」找「銅右滅達樂」，畫面上出現的卻是「金手指」「立達樂」，
 * 東西明明在清單裡卻認不出來。所以兩個並列，再把搜尋字串標起來。
 *
 * approval：'yes' 已核准／'no' 有登記但沒這個作物／'none' 沒有使用範圍／
 * undefined 還沒比對或讀不到。最後一種刻意留白 —— 不知道不能標成未核准。
 */
export function drugCardHtml(drug, action, dataAttr, compact, approval, keyword = '') {
  const kind = text(drug['農藥分類中文意義']);
  const mixture = text(drug['農藥類別中文意義']);
  const brand = text(drug['廠牌名稱']);
  const common = text(drug['中文名稱']);
  const status = licenseStatus(drug);

  const approvalTag =
    approval === 'yes'
      ? '<span class="approve-tag ok">✅ 已核准</span>'
      : approval === 'no'
        ? '<span class="approve-tag no">未列此作物</span>'
        : approval === 'none'
          ? '<span class="approve-tag none">無使用範圍</span>'
          : '';

  const statusTag =
    status.state === 'valid'
      ? ''
      : `<span class="status-tag">${status.state === 'revoked' ? '⛔' : '⌛'} ${esc(status.label)}</span>`;

  // 標題永遠是廠牌；沒有廠牌才退回普通名，那時候普通名就不必再列一次。
  const title = brand || common || license(drug);
  const showCommon = Boolean(brand && common);

  const spec = [text(drug['含量']), text(drug['劑型'])].filter(Boolean).join(' ');
  const meta = [text(drug['廠商名稱']), license(drug)].filter(Boolean).join('・');
  const until = status.date
    ? `・${status.state === 'revoked' ? '撤銷於' : status.state === 'expired' ? '已於' : '有效至'} ${status.date.replace(/-/g, '/')}${status.state === 'expired' ? ' 到期' : ''}`
    : '';

  return `
    <button class="drug-card${compact ? ' compact' : ''}${status.state !== 'valid' ? ' inactive' : ''}"
            type="button" data-action="${action}" ${dataAttr}>
      <span class="drug-topline">
        <span class="kind ${classTone(kind)}">${esc(kind || '未分類')}</span>
        ${mixture ? `<span class="kind soft">${esc(mixture)}</span>` : ''}
        ${approvalTag}
      </span>
      <strong>${highlight(title, keyword)}</strong>
      ${showCommon ? `<b class="common-name">${highlight(common, keyword)}</b>` : ''}
      ${spec ? `<span>${esc(spec)}</span>` : ''}
      <small>${highlight(meta, keyword)}${esc(until)}</small>
      ${statusTag}
    </button>`;
}

/* ------------------------------------------------------------------ */
/* 藥劑查詢分頁                                                        */
/* ------------------------------------------------------------------ */

export function searchViewHtml({
  query,
  crop,
  filter,
  drugs,
  loading,
  message,
  note,
  allApproved,
  total,
  matched,
  shownLimit,
}) {
  // 結果多的時候給一個就地篩選欄：查完「亞托敏」再打「大卡」就能挑出想要的廠牌。
  // 這個欄位放在表單裡而不是結果區 —— 結果重畫時輸入框才不會被拆掉，游標不會跳走。
  const filterBox =
    total > 8
      ? `<label for="search-filter" class="sub-label">在這 ${total} 筆結果裡再找</label>
         <input id="search-filter" class="wide-input" data-field="search-filter" value="${esc(filter)}"
                placeholder="輸入廠牌、廠商或許可證號" />`
      : '';

  return `
    <section class="view">
      <div class="hero">
        <span>合法用藥，先查再下田</span>
        <h2>農藥登記資料，<br />整理成好讀的田間小冊。</h2>
        <p>資料來自農業部及動植物防疫檢疫署，每一支都標出分類與許可證狀態。</p>
      </div>

      <form class="search-box" id="search-form">
        <label for="drug-search">查詢藥劑</label>
        <div>
          <input id="drug-search" data-field="search-query" value="${esc(query)}" placeholder="例如：派滅淨、第滅寧、I215" />
          <button${loading ? ' disabled' : ''}>查詢</button>
        </div>

        <label for="search-crop" class="sub-label">搭配作物</label>
        <input id="search-crop" class="wide-input" data-field="search-crop" value="${esc(crop)}"
               placeholder="例如：酪梨、番茄、水稻" />

        ${filterBox}

        <small>${esc(message)}</small>
      </form>

      ${note ? `<p class="offline-note">${esc(note)}</p>` : ''}

      <div id="search-results">${searchResultsHtml({ drugs, loading, allApproved, total, matched, shownLimit, keyword: filter.trim() || query })}</div>
    </section>`;
}

/**
 * 只有結果卡片的部分。獨立出來，是為了讓篩選欄打字時只重畫這一塊 ——
 * 整頁重畫會把輸入框拆掉重建，游標就跑掉了。
 */
export function searchResultsHtml({ drugs, loading, allApproved, total, matched, shownLimit, keyword = '' }) {
  const trimmed =
    matched > shownLimit
      ? `<p class="offline-note">符合的有 ${matched} 筆，畫面只列前 ${shownLimit} 筆。用上面的篩選欄再縮小範圍，就看得到其餘的。</p>`
      : '';

  return drugs.length
    ? `${trimmed}
         <div class="drug-grid">${drugs
           .map((d) => drugCardHtml(d, 'open-detail', `data-license="${esc(license(d))}"`, false, allApproved ? 'yes' : undefined, keyword))
           .join('')}</div>`
    : loading
      ? ''
      : total
        ? `<div class="welcome-card">
             <b>🔍 這 ${total} 筆裡沒有符合的</b>
             <p>把上面的篩選欄清空，就能看回全部結果。</p>
           </div>`
        : `<div class="welcome-card">
             <b>🔍 可以查什麼？</b>
             <p>上面填藥劑的普通名稱、商品廠牌或農藥代號，下面填作物。兩欄都填的話，只會列出真的核准用在這個作物上的藥，省得一支一支點開看。</p>
             <p>同一個成分常常有幾十個廠牌，卡片上會把商品名和普通名一起列出來，搜尋字串也會標起來。找不到想要的那支時，直接打廠牌名稱最快 👍</p>
           </div>`;
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

/**
 * 選好藥之後、關於「核准使用範圍」的狀況提示。
 *
 * 這裡刻意不擋人：查不到核准範圍時仍然列出所有用途、仍然可以完成施作紀錄，
 * 只是把狀況說清楚。紀錄的職責是忠實反映實際發生的事，不是審核。
 */
export function rangeNoticeHtml(item, crop) {
  const card = (label, title, body, tone) => `
    <div class="verdict ${tone}">
      <span class="verdict-label">${label}</span>
      <strong class="small-strong">${esc(title)}</strong>
      <p>${esc(body)}</p>
    </div>`;

  if (item.rangeStatus === 'no-link') {
    return card(
      '⚠️ 沒有核准使用範圍',
      '這筆登記資料沒有附使用範圍',
      '可能是原體、技術級產品，或官方尚未提供。你仍然可以記下實際施作，但用量與稀釋請完全依照手上產品的中文標示。',
      'warn',
    );
  }

  if (item.rangeStatus === 'empty') {
    return card(
      '⚠️ 官方回傳空清單',
      '查得到這支藥，但沒有使用範圍',
      '官方的使用範圍資料是空的。你仍然可以記下實際施作，但請依照產品標示調配。',
      'warn',
    );
  }

  if (item.rangeStatus === 'failed') {
    return card(
      '📡 讀不到使用範圍',
      '暫時取不到官方資料',
      '可能是網路不通，或這支藥還沒在這台裝置查過。可以稍後再試，仍然可以先記下實際施作。',
      'info',
    );
  }

  if (item.cropMissing) {
    return card(
      '⚠️ 不在核准作物內',
      `找不到「${crop || '目前作物'}」的核准範圍`,
      '下面列的是這支藥所有的核准用途。如果你仍要用在這個作物上，請特別注意 —— 這不在官方核准範圍內，安全採收期也無從依循。',
      'warn',
    );
  }

  return '';
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

/**
 * 常用藥劑下拉：上半是手動釘選的，下半是從施作紀錄自動累積的最近用過。
 * 兩邊都空就整個不顯示，免得畫面多一個永遠沒東西的欄位。
 */
function favoritesSelectHtml(item, favorites) {
  const { pinned, recent } = favorites;
  if (!pinned.length && !recent.length) return '';

  const option = (o) => `<option value="${esc(o.key)}">${esc(o.name)}</option>`;

  return `
    <label class="field">
      <span>常用藥劑</span>
      <select data-field="item-favorite" data-id="${item.id}">
        <option value="" selected>從常用藥劑選一支…</option>
        ${pinned.length ? `<optgroup label="我釘選的">${pinned.map(option).join('')}</optgroup>` : ''}
        ${recent.length ? `<optgroup label="最近用過">${recent.map(option).join('')}</optgroup>` : ''}
      </select>
    </label>`;
}

/**
 * 試算頁的搜尋結果清單。
 *
 * 掃描核准狀態時只重畫這一塊，輸入框不會被拆掉。
 * 進度一定要顯示出來 —— 使用者必須知道「已核准優先」的排序涵蓋到第幾支，
 * 不然會以為沒被標到的就是沒核准。
 */
export function itemResultsHtml(item, crop) {
  const visible = item.visible || item.results;
  if (!visible.length && !item.scanning) return '';

  const progress = item.scanning
    ? `<p class="scan-note">正在比對「${esc(crop)}」的核准範圍…（${item.scanned}／${item.scanTotal}）</p>`
    : item.scanTotal
      ? `<p class="scan-note done">已比對前 ${item.scanTotal} 支${item.results.length > item.scanTotal ? `，其餘 ${item.results.length - item.scanTotal} 支未比對` : ''}。已核准的排在前面。</p>`
      : '';

  const keyword = item.filter.trim() || item.query;

  return `
    ${progress}
    <div class="result-list">${visible
      .map((d) => drugCardHtml(d, 'item-pick', `data-id="${item.id}" data-key="${esc(license(d))}"`, true, item.approvalOf?.[license(d)], keyword))
      .join('')}</div>`;
}

function calcDrugHtml(item, canRemove, areaHa, water, favorites, crop) {
  const head = `
    <div class="calc-drug-head">
      <span class="step-stamp">第 ${item.id} 種</span>
      ${canRemove ? `<button class="remove" type="button" data-action="item-remove" data-id="${item.id}">－ 移除</button>` : ''}
    </div>`;

  const error = item.error ? `<p class="field-error">${esc(item.error)}</p>` : '';

  if (!item.drug) {
    // 有結果才給篩選欄，而且放在清單外面 —— 清單重畫時輸入框才不會被拆掉。
    const filterBox = item.results.length > 6
      ? `<label class="field compact-field">
           <span>在這 ${item.results.length} 筆裡再找</span>
           <input data-field="item-filter" data-id="${item.id}" value="${esc(item.filter)}"
                  placeholder="輸入廠牌、廠商或許可證號" />
         </label>`
      : '';

    return `
      <article class="calc-drug">
        ${head}
        ${favoritesSelectHtml(item, favorites)}
        <div class="search-line">
          <input data-field="item-query" data-id="${item.id}" value="${esc(item.query)}"
                 placeholder="輸入普通名、廠牌或代號" aria-label="查詢施用農藥" />
          <button type="button" data-action="item-search" data-id="${item.id}"${item.loading ? ' disabled' : ''}>
            ${item.loading ? '查詢中' : '查詢'}
          </button>
        </div>
        ${error}
        ${filterBox}
        <div data-results="${item.id}">${itemResultsHtml(item, crop)}</div>
      </article>`;
  }

  const rangeSelect = item.ranges.length
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

  const body = item.loading
    ? '<div class="empty">正在取得核准用法…</div>'
    : `${rangeNoticeHtml(item, crop)}${rangeSelect}`;

  return `
    <article class="calc-drug">
      ${head}
      <div class="selected-drug">
        <div>
          <strong>${esc(drugTitle(item.drug))}</strong>
          <span>${esc(drugSubtitle(item.drug))}</span>
          <small>${esc(drugIdentity(item.drug))}${licenseStatus(item.drug).state !== 'valid' ? `・${esc(licenseStatus(item.drug).label)}` : ''}</small>
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

export function calcViewHtml(calc, fields, areaHa, canRecord, favorites) {
  const { crop, area, areaUnit, water, items, fieldId } = calc;

  return `
    <section class="view">
      <div class="page-title">
        <span class="eyebrow">本次施用</span>
        <h2>用藥量試算</h2>
        <p>先選土地或直接填面積，再一項一項加入這次要用的藥。</p>
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
        <h3>💊 本次藥劑</h3>
        <span>${items.length} 種</span>
      </div>

      ${items.map((item) => calcDrugHtml(item, items.length > 1, areaHa, Number(water) || 0, favorites, crop)).join('')}

      <button class="add-drug" type="button" data-action="add-item"><span>＋</span>增加一種藥劑</button>

      <button class="record-cta" type="button" data-action="open-record-form"${canRecord ? '' : ' disabled'}>
        完成施作並記錄
      </button>
      <p class="cta-note">${canRecord
        ? '試算不會自動變成紀錄。實際噴完之後再按這裡填真正用掉的量，也可以順手記下光合菌、展著劑這類自己加的東西 🧪'
        : '選好藥劑之後就可以把這次施作記下來，連同自己加的微生物肥料一起 🧪'}</p>

      <div class="safety-card">
        <b>⚠️ 安全提醒</b>
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
      <b>⏳ 還沒到參考採收日</b>
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
           <b>🌱 還沒有任何紀錄</b>
           <p>到「用量試算」選好土地跟藥，實際噴完之後按「完成施作並記錄」，這裡就會長出來。</p>
         </div>`;

  return `
    <section class="view">
      <div class="page-title">
        <span class="eyebrow">下田做了什麼</span>
        <h2>施作紀錄</h2>
        <p>只存在這支手機，不會上傳到任何地方。記得偶爾到設定頁匯出備份 💾</p>
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

function releaseLogHtml() {
  return `
    <div class="release-log">
      <b>v1.4.8・這一版</b>
      <ul>
        <li>施作紀錄與行事曆備註移除面積、施作方式、用水及藥劑細項前的圖示，保留其餘區塊圖示。</li>
      </ul>

      <b>v1.4.7</b>
      <ul>
        <li>完成施作後的完整紀錄改成分行格式，並以適量圖示整理日期、土地、用水與採收資訊。</li>
        <li>每支藥同時列出官方建議稀釋與依實際用量、用水反推的實際稀釋；行事曆備註同步套用。</li>
      </ul>

      <b>v1.4.6</b>
      <ul>
        <li>設定頁底部加入 PRO-BRO AVOCADO 品牌署名，版本與年份會隨 App 自動更新。</li>
      </ul>
    </div>`;
}

const backupHelpHtml = () => `
  <p>按下「匯出備份」之後，瀏覽器會下載一個 <code>.json</code> 檔，檔名是「田間用藥」加上今天的日期。</p>
  <p><b>iPhone：</b>Safari 會先把檔案收進下載項目，你要再點一次「更多」或分享圖示，選「儲存到檔案」，挑一個自己找得到的位置。沒有做這一步的話，清掉 Safari 的下載記錄就會不見。</p>
  <p><b>Android：</b>通常直接存進「下載」資料夾，用檔案管理員就找得到。</p>
  <p>換手機時，把這個檔案傳到新手機（LINE 傳給自己、AirDrop、雲端硬碟都可以），在新手機上按「匯入備份」選它就好。相同的紀錄會被覆寫，本機原有而備份沒有的資料會保留。</p>`;

const storageHelpHtml = (persisted) => `
  <p>土地與施作紀錄存在這個瀏覽器的網站資料區，不會上傳到任何後台，我們也看不到。但以下情況資料會不見：</p>
  <ul>
    <li>清除這個網站的「網站資料」或瀏覽紀錄</li>
    <li>使用無痕模式並關閉分頁</li>
    <li>換手機、換瀏覽器</li>
    <li>手機空間嚴重不足時被系統清理</li>
  </ul>
  <p><b>${persisted ? '這台裝置已取得持久儲存，被系統自動清理的機率較低。' : '這台裝置尚未取得持久儲存權限，建議把網站安裝到主畫面。'}</b>
  不論如何，重要的施作紀錄請定期匯出備份，或在記錄完成後一併加入手機行事曆。</p>`;

const supportHelpHtml = (lineUrl) => `
  <p>加入 LINE 好友，隨喜支持。您的鼓勵是開發者持續維護與更新的動力💪</p>
  <a class="modal-action" href="${esc(lineUrl)}" target="_blank" rel="noreferrer">開啟 LINE</a>`;

const responsibilityHelpHtml = (aphiaUrl) => `
  <p>藥劑資料取自農業部「農藥資料查詢」及動植物防疫檢疫署登記資訊，每週更新。官方也明確提醒，公開使用範圍僅供參考，實際施藥應依產品標示及最新公告。</p>
  <p><b>搜尋結果不做分類過濾。</b>除草劑、殺蟎劑，以及許可證已到期或已撤銷的，都會照樣列出來並標示狀態 —— 把你手上可能有的藥藏起來，比列出來讓你自己判斷更危險。</p>
  <p>本工具不替代農藥標示、專業診斷或農業主管機關指導。若作物、病蟲害或單位無法確定，請先向農業改良場、農會或合格農藥販賣業者確認。</p>
  <a href="${esc(aphiaUrl)}" target="_blank" rel="noreferrer">前往官方農藥資訊服務網</a>`;

function settingDisclosureHtml({ title, hint, content }) {
  return `
    <details class="setting-disclosure">
      <summary class="setting-row">
        <span><b>${title}</b><small>${hint}</small></span><i aria-hidden="true">⌄</i>
      </summary>
      <div class="setting-panel">${content}</div>
    </details>`;
}

export function settingsViewHtml({ version, aphiaUrl, lineUrl, fieldCount, appCount, persisted, dbError }) {
  return `
    <section class="view">
      <div class="page-title">
        <span class="eyebrow">田間小工具</span>
        <h2>設定與說明</h2>
        <p>把重要事項收在這裡，需要時再翻開。</p>
      </div>

      ${dbError ? `<div class="safety-card"><b>😵 本機儲存無法使用</b><p>${esc(dbError)}查詢與試算仍可正常使用，但土地與施作紀錄無法保存。無痕模式是常見原因。</p></div>` : ''}

      <button class="setting-row primary" data-action="install">
        <span><b>📲 安裝到手機</b><small>加入主畫面，像 App 一樣開啟</small></span><i>›</i>
      </button>

      <div class="section-row"><h3>📦 我的資料</h3><span>只在這支手機</span></div>

      <button class="setting-row" data-action="open-fields">
        <span><b>🗂 土地管理</b><small>目前 ${fieldCount} 筆</small></span><i>›</i>
      </button>

      <button class="setting-row" data-action="export-backup">
        <span><b>💾 匯出備份</b><small>${appCount} 筆施作紀錄，存成一個檔案</small></span><i>›</i>
      </button>

      <button class="setting-row" data-action="import-backup">
        <span><b>📥 匯入備份</b><small>換手機時把資料帶回來</small></span><i>›</i>
      </button>

      ${settingDisclosureHtml({
        title: '💾 匯出的檔案跑去哪了',
        hint: 'iPhone 與 Android 的備份位置',
        content: backupHelpHtml(),
      })}

      ${settingDisclosureHtml({
        title: '🔒 資料會在什麼時候消失',
        hint: persisted ? '這台裝置已取得持久儲存' : '了解本機保存與備份時機',
        content: storageHelpHtml(persisted),
      })}

      <div class="section-row"><h3>📖 說明與關於</h3><span>點開閱讀</span></div>

      ${settingDisclosureHtml({
        title: '🆕 版本更新摘要',
        hint: esc(version),
        content: releaseLogHtml(),
      })}

      ${settingDisclosureHtml({
        title: '📖 資料與責任說明',
        hint: '資料來源、許可狀態與使用提醒',
        content: responsibilityHelpHtml(aphiaUrl),
      })}

      ${settingDisclosureHtml({
        title: '買杯咖啡支持☕',
        hint: '加 LINE 好友，給開發者一點鼓勵',
        content: supportHelpHtml(lineUrl),
      })}

      <div class="colophon" aria-label="PRO-BRO AVOCADO 品牌署名">
        <p class="colophon-title">PRO-BRO AVOCADO</p>
        <div class="colophon-rule" aria-hidden="true"></div>
        <p class="colophon-line">A field tool for growers, built on a family avocado farm in Nantou, Taiwan.</p>
        <p class="colophon-meta">${esc(version)} &nbsp;·&nbsp; © ${new Date().getFullYear()}</p>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 藥劑詳細資料面板                                                    */
/* ------------------------------------------------------------------ */

export function detailHtml({ drug, ranges, loading, crop, shown, pinned, rangeStatus }) {
  const resistance = text(drug['FRAC殺菌劑抗藥性']) || text(drug['IRAC殺蟲劑抗藥性']);

  // 分清楚三種「沒有資料」：官方沒附連結、連結給了空清單、我們讀不到。
  const emptyReason =
    rangeStatus === 'no-link'
      ? '這筆登記資料沒有附核准使用範圍。可能是原體、技術級產品，或官方尚未提供，請以手上產品的中文標示為準。'
      : rangeStatus === 'empty'
        ? '官方有給連結，但回傳的使用範圍是空的。請以手上產品的中文標示為準。'
        : rangeStatus === 'failed'
          ? '目前讀不到官方的使用範圍，可能是網路不通。稍後再試試看。'
          : `沒有符合「${crop}」的核准範圍。清空上面的欄位可以看全部用途。`;

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
      : `<div class="verdict ${rangeStatus === 'failed' ? 'info' : 'warn'}">
           <span class="verdict-label">${rangeStatus && rangeStatus !== 'ok' ? '⚠️ 沒有核准使用範圍' : '🔍 查無符合'}</span>
           <p>${esc(emptyReason)}</p>
         </div>`;

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

      <button class="ghost-btn${pinned ? ' pinned' : ''}" type="button" data-action="toggle-favorite">
        ${pinned ? '★ 已釘選為常用藥劑（點一下取消）' : '☆ 釘選為常用藥劑'}
      </button>

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
         <b>🗂 還沒有登記土地</b>
         <p>把常跑的地先登記起來，之後試算點一下就帶入面積跟作物，不用每次重打。</p>
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

const formatLooseAmount = (range) => {
  const round = (n) => Math.round(n * 10) / 10;
  const min = round(range.min);
  const max = round(range.max);
  return min === max ? `${min} 公克或毫升` : `${min} ～ ${max} 公克或毫升`;
};

const dilutionLabel = (range) => {
  if (!range) return '';
  const min = Math.round(range.min).toLocaleString('en-US');
  const max = Math.round(range.max).toLocaleString('en-US');
  return min === max ? `${min} 倍` : `${min} ～ ${max} 倍`;
};

const guidanceAlert = (tone, title, copy) => `
  <div class="guidance-alert ${tone}" role="status">
    <b>${esc(title)}</b>
    <span>${esc(copy)}</span>
  </div>`;

const ADDITIVE_UNITS = ['毫升', '公升', '公克', '公斤', '包', '瓶', '罐', '瓢', '匙', '其他'];

const additiveUnitOptions = (current) => {
  const value = String(current || '').trim();
  const units = value && !ADDITIVE_UNITS.includes(value) ? [...ADDITIVE_UNITS, value] : ADDITIVE_UNITS;
  return `<option value=""${value ? '' : ' selected'}>選擇單位</option>${units
    .map((unit) => `<option value="${esc(unit)}"${unit === value ? ' selected' : ''}>${esc(unit)}</option>`)
    .join('')}`;
};

/**
 * 本次施作的即時參考：面積用量是主建議，稀釋倍數是第二層檢查。
 * 這段可以單獨重畫，避免使用者輸入時游標被整張表單重建。
 */
export function recordGuidanceHtml(draft, drug) {
  const area = Number(draft.area) || 0;
  const areaHa = toHectares(area, draft.unit);
  const water = draft.mode === 'separate' ? Number(drug.water) || 0 : Number(draft.water) || 0;
  const check = assessApplication(
    drug.dosePerHa,
    drug.dilution,
    areaHa,
    water,
    drug.amount,
    drug.amountUnit,
  );

  let reference = '';
  if (check.range.byArea) {
    const areaText = `${area || '—'} ${AREA_UNIT_LABEL[draft.unit] || draft.unit || ''}`.trim();
    const waterHint = check.range.suggestedWater
      ? `<p class="guidance-water"><b>稀釋參考用水</b>${esc(formatWater(check.range.suggestedWater))}<small>依標示倍數換算；樹冠、噴具與覆蓋需求可以改變實際用水，但不能因此超過上方的面積用量。</small></p>`
      : '';
    reference = `
      <div class="dose-reference">
        <span>依面積換算的標示用量</span>
        <strong>${esc(formatRange(check.range.byArea, check.range.base))}</strong>
        <small>依 ${esc(areaText)} 與「每公頃 ${esc(drug.dosePerHa)}」換算，不會自動填成實際紀錄。</small>
        ${waterHint}
      </div>`;
  } else if (check.range.kind === 'water-only') {
    reference = `
      <div class="dose-reference secondary">
        <span>僅能依用水量反推</span>
        <strong>${esc(formatLooseAmount(check.range.byWater))}</strong>
        <small>此筆官方資料沒有可計算的每公頃用量，才以 ${esc(water)} 公升與標示稀釋倍數反推；請再核對產品標示。</small>
      </div>`;
  } else {
    reference = `
      <div class="dose-reference secondary">
        <span>沒有可計算的標示用量</span>
        <small>請依產品標示與實際施作填寫；App 不會自行猜測數字。</small>
      </div>`;
  }

  const alerts = [];
  if (check.doseStatus === 'ok') {
    alerts.push(guidanceAlert('ok', '面積用量符合', '實際總用藥量在面積換算的標示範圍內。'));
  } else if (check.doseStatus === 'below') {
    alerts.push(guidanceAlert('warn', '低於面積用量下限', '可能達不到登記的防治效果，請核對實際倒入量與施作面積。'));
  } else if (check.doseStatus === 'above') {
    alerts.push(guidanceAlert('danger', '超過面積用量上限', '增加用水不能抵銷總用藥超量；可能提高殘留超標、作物與環境風險，請立即核對產品標示。'));
  } else if (check.doseStatus === 'unit-mismatch') {
    alerts.push(guidanceAlert('danger', '用量單位需要確認', `標示是以${check.range.base}計算，目前填的是${drug.amountUnit}，無法可靠比較總用藥量。`));
  }

  const actualText = check.actualFactor ? Math.round(check.actualFactor).toLocaleString('en-US') : '';
  const labelText = dilutionLabel(check.dilution);
  if (check.dilutionStatus === 'ok') {
    alerts.push(guidanceAlert('ok', `實際約 ${actualText} 倍`, `落在標示稀釋範圍 ${labelText} 內。`));
  } else if (check.dilutionStatus === 'too-concentrated') {
    alerts.push(guidanceAlert('danger', `實際約 ${actualText} 倍，濃度過高`, `濃於標示的 ${labelText}，藥害與施作者暴露風險可能增加。`));
  } else if (check.dilutionStatus === 'too-dilute') {
    alerts.push(guidanceAlert('warn', `實際約 ${actualText} 倍，稀釋過度`, `稀於標示的 ${labelText}，通常主要是防治效果可能不足，不是用水本身造成藥害。`));
  } else if (check.dilutionStatus === 'no-water') {
    alerts.push(guidanceAlert('info', '尚未檢查稀釋倍數', '填入實際用水量後，才算得出當次真正的稀釋倍數。'));
  }

  const prompt = !check.actual
    ? '<p class="guidance-prompt">請在上方參考建議後，於下方填入當天真正使用的藥量；留白代表尚未確認。</p>'
    : '';

  return `${reference}${prompt}${alerts.length ? `<div class="guidance-checks">${alerts.join('')}</div>` : ''}`;
}

export function recordFormHtml(draft, additivePresets = []) {
  const additivePresetPicker = additivePresets.length
    ? `<label class="field additive-preset">
         <span>從常用添加物快速加入</span>
         <select data-field="additive-preset">
           <option value="" selected>選擇過去用過的添加物…</option>
           ${additivePresets
             .map((preset, index) => `<option value="${index}">${esc(preset.name)}${preset.unit ? `・${esc(preset.unit)}` : ''}</option>`)
             .join('')}
         </select>
       </label>`
    : '';

  const drugRows = draft.drugs
    .map(
      (d, i) => `
      <article class="record-drug">
        <div class="record-drug-head">
          <strong>${esc(d.name)}</strong>
          ${draft.drugs.length > 1 ? `<button type="button" class="remove" data-action="record-drug-remove" data-idx="${i}">－ 移除</button>` : ''}
        </div>
        <span class="record-drug-sub">${esc(d.target || '—')}${d.dilution ? `・標示稀釋 ${esc(d.dilution)}` : ''}</span>

        <div class="record-guidance" data-record-guidance="${i}" aria-live="polite">
          ${recordGuidanceHtml(draft, d)}
        </div>

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

        <dl class="check-rows">
          <div><dt>安全採收期</dt><dd>${esc(d.phi || '未提供')}</dd></div>
          <div><dt>施藥間隔</dt><dd>${esc(d.interval || '未提供')}</dd></div>
        </dl>
      </article>`,
    )
    .join('');

  const additiveRows = draft.additives
    .map(
      (a, i) => `
      <article class="record-drug additive">
        <div class="record-drug-head">
          <strong>第 ${i + 1} 項</strong>
          <button type="button" class="remove" data-action="additive-remove" data-idx="${i}">－ 移除</button>
        </div>
        <label class="field">
          <span>名稱</span>
          <input data-field="additive-name" data-idx="${i}" value="${esc(a.name)}" placeholder="例如：自製光合菌、矽藻素" />
        </label>
        <div class="two-fields">
          <label class="field">
            <span>用量</span>
            <input inputmode="decimal" data-field="additive-amount" data-idx="${i}" value="${esc(a.amount)}" />
          </label>
          <label class="field">
            <span>單位</span>
            <select data-field="additive-unit" data-idx="${i}">
              ${additiveUnitOptions(a.unit)}
            </select>
          </label>
        </div>
        <label class="field">
          <span>備註（可留空）</span>
          <input data-field="additive-note" data-idx="${i}" value="${esc(a.note)}" placeholder="例如：稀釋 500 倍先溶解" />
        </label>
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
      <p class="legal-note">面積換算只當作標示參考，不會自動寫進實際用量。保存的是你親自確認過的施作數字。</p>

      <label class="field">
        <span>施作日期</span>
        <input type="date" data-field="record-date" value="${esc(draft.date)}" />
      </label>

      <label class="field">
        <span>施作時間（可留空）</span>
        <input type="time" data-field="record-time" value="${esc(draft.time)}" />
      </label>

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

      <div class="section-row"><h3>💊 本次用藥</h3><span>${draft.drugs.length} 種</span></div>
      ${drugRows}

      <div class="section-row"><h3>🧪 其他添加物</h3><span>${draft.additives.length} 項</span></div>
      <p class="legal-note">微生物肥料、光合菌、展著劑這類不在農藥登記資料裡的東西，記在這裡。
      它們沒有官方的安全採收期，所以不會列入採收日推算。</p>
      ${additivePresetPicker}
      ${additiveRows}
      <button class="add-drug" type="button" data-action="additive-add"><span>＋</span>加一項添加物</button>
      <p class="legal-note">保存後，添加物名稱與單位會出現在下次的常用清單；實際用量不會沿用。常用清單只是快速填寫，不代表適合與農藥混用。</p>

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
    .map((d, i) => {
      // 實際稀釋倍數由那天真正倒進去的藥量與水量反推，不是抄官方的建議值。
      const water = app.mode === 'separate' ? d.water : app.water;
      const actual = actualDilution(d.amount, d.amountUnit, water);
      const phiDays = parseDays(d.phi);
      const harvest = phiDays === null ? null : addDays(app.date, phiDays);

      return `
      <article class="range-card">
        <div><strong>${i + 1}. ${esc(d.name)}</strong><span>${esc(d.amount)} ${esc(d.amountUnit)}</span></div>
        <dl>
          <div><dt>防治對象</dt><dd>${esc(d.target || '—')}</dd></div>
          <div><dt>實際稀釋倍數</dt><dd>${actual ? `約 ${actual.toLocaleString('en-US')} 倍` : '無法計算'}</dd></div>
          <div><dt>建議稀釋倍數</dt><dd>${esc(d.dilution || '—')}</dd></div>
          <div><dt>用水量</dt><dd>${water ? `${esc(water)} 公升` : '—'}</dd></div>
          <div><dt>安全採收期</dt><dd>${esc(d.phi || '—')}</dd></div>
          <div><dt>施藥間隔</dt><dd>${esc(d.interval || '—')}</dd></div>
          <div class="wide"><dt>這支藥的可採收日</dt><dd>${harvest ? esc(formatSlashDate(harvest)) : '無法推算，請查產品標示'}</dd></div>
        </dl>
      </article>`;
    })
    .join('');

  const additives = app.additives?.length
    ? `<div class="section-row"><h3>🧪 其他添加物</h3><span>${app.additives.length} 項</span></div>
       ${app.additives
         .map(
           (a, i) => `
         <article class="range-card additive">
           <div><strong>${i + 1}. ${esc(a.name)}</strong><span>${esc([a.amount, a.unit].filter(Boolean).join(' ') || '—')}</span></div>
           ${a.note ? `<p>${esc(a.note)}</p>` : ''}
         </article>`,
         )
         .join('')}
       <p class="legal-note">非農藥登記品項，沒有官方安全採收期，未列入採收日推算。</p>`
    : '';

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

      <div class="section-row"><h3>💊 本次用藥</h3><span>${app.drugs.length} 種</span></div>
      ${drugs}

      ${additives}

      <div class="section-row"><h3>📅 備份到手機行事曆</h3><span>不會自動同步</span></div>
      <p class="legal-note">這兩份資料各自獨立。之後在這裡修改或刪除紀錄，不會連動改到手機行事曆，需要重新輸出一次。</p>

      <button class="record-cta" type="button" data-action="copy-record" data-id="${esc(app.id)}">複製完整紀錄</button>
      <button class="ghost-btn" type="button" data-action="download-ics" data-id="${esc(app.id)}">下載行事曆檔（iPhone 適用）</button>
      <button class="ghost-btn" type="button" data-action="open-google-calendar" data-id="${esc(app.id)}">用 Google 日曆新增</button>

      <div class="section-row"><h3>✏️ 這筆紀錄</h3><span></span></div>
      <button class="ghost-btn" type="button" data-action="edit-record" data-id="${esc(app.id)}">編輯</button>
      ${confirmDelete
        ? `<div class="safety-card">
             <b>🗑 確定要刪除嗎？</b>
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
      <span class="eyebrow">版本更新 🆕</span>
      <h2>${esc(version)}</h2>
      ${releaseLogHtml()}`,
    install: `
      <span class="eyebrow">安裝到手機 📲</span>
      <h2>把田間用藥帶著走</h2>
      <p>iPhone：用 Safari 開啟，點分享，再選「加入主畫面」。<br />Android：用 Chrome 開啟選單，選「安裝應用程式」。</p>
      <p>安裝之後資料被系統清理的機率較低，也能在沒訊號的田裡開啟。</p>`,
    support: `
      <span class="eyebrow">謝謝支持與鼓勵💛</span>
      <h2>買杯咖啡支持☕</h2>
      ${supportHelpHtml(lineUrl)}`,
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
