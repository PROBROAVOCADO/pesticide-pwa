/**
 * 施作紀錄的領域邏輯：安全採收期推算、剪貼簿文字、手機行事曆匯出。
 *
 * 這裡的函式都是純函式，不碰 DOM 也不碰資料庫，方便單獨測試。
 */

import { actualDilution } from './calc.js';

/* ------------------------------------------------------------------ */
/* 日期                                                                */
/* ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');

/** Date 轉成 YYYY-MM-DD（用當地時間，不是 UTC，否則台灣的晚上會變成前一天）。 */
export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const todayKey = () => toDateKey(new Date());

/** YYYY-MM-DD 加上天數，回傳新的 YYYY-MM-DD。 */
export function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/** 兩個日期相差幾天（後者減前者）。 */
export function daysBetween(fromKey, toKey) {
  const [y1, m1, d1] = fromKey.split('-').map(Number);
  const [y2, m2, d2] = toKey.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

/** 顯示成「8月26日」。 */
export function formatDisplayDate(dateKey) {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${m}月${d}日`;
}

/** 顯示成「2026/08/26」。 */
export function formatSlashDate(dateKey) {
  const [y, m, d] = dateKey.split('-');
  return `${y}/${m}/${d}`;
}

/* ------------------------------------------------------------------ */
/* 安全採收期與施藥間隔                                                */
/* ------------------------------------------------------------------ */

/**
 * 從官方欄位取出天數。
 * 常見寫法：「12 天」「採收前12天停止施藥」「7天」「-」「不需訂定」「依標示」。
 * 取不出數字就回 null —— 這種時候絕對不能自己編一個天數出來。
 */
export function parseDays(raw) {
  const clean = String(raw ?? '').replace(/,/g, '').trim();
  if (!clean || clean === '-') return null;
  const match = clean.match(/(\d+(?:\.\d+)?)\s*(?:天|日)/);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isFinite(days) ? Math.ceil(days) : null;
}

/**
 * 一次施作的參考最早採收日。
 * 多種藥劑時取最長的安全採收期；所有藥劑都沒有天數就回 null。
 */
export function harvestInfo(dateKey, drugs) {
  const days = drugs.map((d) => parseDays(d.phi)).filter((n) => n !== null);
  if (!days.length) return { days: null, date: null, unknown: drugs.length > 0 };
  const max = Math.max(...days);
  return {
    days: max,
    date: addDays(dateKey, max),
    // 有些藥有天數、有些沒有，推算結果只涵蓋看得懂的那幾種。
    unknown: days.length < drugs.length,
  };
}

/**
 * 目前還沒到安全採收期的土地。
 * 同一塊地若有多次施作，以最晚的那個採收日為準。
 */
export function pendingHarvests(applications, today = todayKey()) {
  const byField = new Map();

  for (const app of applications) {
    if (!app.harvestDate || app.harvestDate <= today) continue;
    const key = app.fieldId || app.fieldName;
    const current = byField.get(key);
    if (!current || app.harvestDate > current.harvestDate) {
      byField.set(key, {
        fieldName: app.fieldName,
        crop: app.crop,
        harvestDate: app.harvestDate,
        daysLeft: daysBetween(today, app.harvestDate),
        from: app.date,
      });
    }
  }

  return [...byField.values()].sort((a, b) => a.harvestDate.localeCompare(b.harvestDate));
}

/* ------------------------------------------------------------------ */
/* 月曆                                                                */
/* ------------------------------------------------------------------ */

/**
 * 產生一個月的格子，補齊前後讓每週七格對齊（週日起算）。
 * 回傳 { key, day, inMonth } 的陣列。
 */
export function monthGrid(year, month) {
  const leading = new Date(year, month, 1).getDay(); // 這個月一號是星期幾
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < total; i += 1) {
    const date = new Date(year, month, i - leading + 1);
    cells.push({ key: toDateKey(date), day: date.getDate(), inMonth: date.getMonth() === month });
  }

  return cells;
}

/* ------------------------------------------------------------------ */
/* 剪貼簿文字                                                          */
/* ------------------------------------------------------------------ */

const MODE_LABEL = { tank: '同桶混用', separate: '分開施用' };

export const modeLabel = (mode) => MODE_LABEL[mode] || '未註明';

const AREA_UNIT_LABEL = { fen: '分', jia: '甲', m2: '平方公尺', ha: '公頃' };

export const areaLabel = (app) => `${app.area} ${AREA_UNIT_LABEL[app.unit] || ''}`.trim();

const amountLabel = (value, unit) => [value, unit].filter((part) => String(part ?? '').trim()).join(' ') || '未填寫';

/** 將官方常見的「2000」「1,500倍」「1500-2000倍」整理成容易讀的格式。 */
const recommendedDilutionLabel = (raw) => {
  const value = String(raw ?? '').trim();
  if (!value || value === '-' || value === '—') return '未提供';
  const formatted = value
    .replace(/\d[\d,]*(?:\.\d+)?/g, (part) => Number(part.replace(/,/g, '')).toLocaleString('en-US'))
    .replace(/\s*倍/g, ' 倍')
    .trim();
  return formatted.includes('倍') ? formatted : `${formatted} 倍`;
};

/** API 偶爾只回「日」或「天」；這不算有效天數，不能直接印在紀錄裡。 */
const periodLabel = (raw) => {
  const value = String(raw ?? '').trim();
  if (!value || /^(?:-|—|日|天)$/.test(value)) return '未提供';
  return value.replace(/^(\d+)\s*(日|天)$/, (_, days, unit) => `${Number(days).toLocaleString('en-US')} ${unit}`);
};

/** 一次施作的完整文字，貼到手機行事曆的備註欄剛好。 */
export function buildRecordText(app) {
  const lines = [
    '【🌿 田間用藥・施作紀錄】',
    `📅 日期：${formatSlashDate(app.date)}${app.time ? ` ${app.time}` : ''}`,
    `📍 土地：${app.fieldName || '未命名'}`,
    `🌱 作物：${app.crop || '—'}`,
    `施作面積：${areaLabel(app)}`,
    `施作方式：${modeLabel(app.mode)}`,
  ];

  if (app.mode === 'tank') lines.push(`實際用水：${app.water} 公升`);

  lines.push('', '💊 本次用藥：');

  (app.drugs || []).forEach((drug, i) => {
    const water = app.mode === 'separate' ? drug.water : app.water;
    const actual = actualDilution(drug.amount, drug.amountUnit, water);

    // 藥名獨立一列，避免與長藥名、用量和單位擠在一起。
    lines.push(`${i + 1}. ${drug.name || '未命名藥劑'}`);
    lines.push(`   本次使用量：${amountLabel(drug.amount, drug.amountUnit)}`);
    if (drug.target) lines.push(`   防治對象：${drug.target}`);
    if (app.mode === 'separate') lines.push(`   本次用水：${drug.water ? `${drug.water} 公升` : '未填寫'}`);
    lines.push(`   建議稀釋：${recommendedDilutionLabel(drug.dilution)}`);
    lines.push(`   實際稀釋：${actual ? `約 ${actual.toLocaleString('en-US')} 倍` : '無法計算'}`);
    lines.push(`   安全採收期：${periodLabel(drug.phi)}`);
    lines.push(`   施藥間隔：${periodLabel(drug.interval)}`);
  });

  // 自製或市售的微生物肥料、展著劑等，不在農藥登記資料裡，但同一桶下去了就該記下來。
  if (app.additives?.length) {
    lines.push('', '🧴 同時添加：');
    app.additives.forEach((a, i) => {
      const amount = [a.amount, a.unit].filter(Boolean).join(' ');
      lines.push(`${i + 1}. ${a.name}${amount ? ` ${amount}` : ''}`);
      if (a.note) lines.push(`   ${a.note}`);
    });
    lines.push('⚠️ 非農藥登記品項，不列入安全採收期推算。');
  }

  if (app.note) lines.push('', `📝 備註：${app.note}`);

  if (app.harvestDate) {
    lines.push('', `🧺 參考最早採收日：${formatSlashDate(app.harvestDate)}`);
    lines.push('（依本機施作紀錄推算，僅供參考）');
  } else {
    lines.push('', '🧺 參考最早採收日：無法推算，請查閱產品標示');
  }

  return lines.join('\n');
}

/** 行事曆事件的標題。 */
export const buildEventTitle = (app) =>
  `施藥｜${app.fieldName || '未命名'}${app.crop ? `｜${app.crop}` : ''}`;

/* ------------------------------------------------------------------ */
/* 手機行事曆                                                          */
/* ------------------------------------------------------------------ */

const icsEscape = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/**
 * iCalendar 規定每行不超過 75 個位元組，超過要折行。
 * 中文一個字是三個位元組，很容易超過，折錯了行事曆就讀不進去。
 */
function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const out = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;

  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = char;
      currentBytes = size;
      limit = 74; // 續行前面要加一個空白，可用長度少一個位元組
    } else {
      current += char;
      currentBytes += size;
    }
  }
  out.push(current);

  return out.join('\r\n ');
}

const icsDate = (dateKey) => dateKey.replace(/-/g, '');

/**
 * 產生單筆全天事件的 .ics。
 * 用全天事件而不是指定時段，因為各家手機對時區的處理差異很大，
 * 全天事件最不容易跑掉；實際施作時間寫進備註。
 */
export function buildIcs(app, stamp = new Date()) {
  const uid = `${app.id || 'record'}@pesticide.probroavocado.com`;
  const dtstamp =
    `${stamp.getUTCFullYear()}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}` +
    `T${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}${pad(stamp.getUTCSeconds())}Z`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//field-meds-pwa//TW',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${icsDate(app.date)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(app.date, 1))}`,
    `SUMMARY:${icsEscape(buildEventTitle(app))}`,
    `DESCRIPTION:${icsEscape(buildRecordText(app))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Google 日曆的「新增事件」網址，內容已經填好，由使用者自己確認儲存。 */
export function googleCalendarUrl(app) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: buildEventTitle(app),
    dates: `${icsDate(app.date)}/${icsDate(addDays(app.date, 1))}`,
    details: buildRecordText(app),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
