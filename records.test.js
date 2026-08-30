import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  buildIcs,
  buildRecordText,
  daysBetween,
  googleCalendarUrl,
  harvestInfo,
  monthGrid,
  parseDays,
  pendingHarvests,
  toDateKey,
} from './records.js';

describe('parseDays：官方「安全採收期」「施藥間隔」欄位', () => {
  it('讀得出「12 天」', () => {
    assert.equal(parseDays('12 天'), 12);
  });

  it('讀得出夾在句子裡的天數', () => {
    assert.equal(parseDays('採收前12天停止施藥'), 12);
  });

  it('「日」也算', () => {
    assert.equal(parseDays('7日'), 7);
  });

  it('小數無條件進位，寧可多等一天', () => {
    assert.equal(parseDays('1.5 天'), 2);
  });

  it('沒有資料的「-」回 null', () => {
    assert.equal(parseDays('-'), null);
  });

  it('「不需訂定」這種沒有數字的寫法回 null，絕不自己編一個天數', () => {
    assert.equal(parseDays('不需訂定'), null);
    assert.equal(parseDays('依標示'), null);
    assert.equal(parseDays(''), null);
    assert.equal(parseDays(null), null);
  });

  it('沒有「天」字的純數字不算，避免把別的欄位誤讀成天數', () => {
    assert.equal(parseDays('12'), null);
  });
});

describe('日期計算', () => {
  it('加天數會跨月', () => {
    assert.equal(addDays('2026-08-26', 7), '2026-09-02');
  });

  it('加天數會跨年', () => {
    assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  });

  it('閏年二月', () => {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  });

  it('相差天數', () => {
    assert.equal(daysBetween('2026-08-26', '2026-09-02'), 7);
    assert.equal(daysBetween('2026-09-02', '2026-08-26'), -7);
  });

  it('用當地時間換算，晚上不會變成前一天', () => {
    assert.equal(toDateKey(new Date(2026, 7, 26, 23, 30)), '2026-08-26');
  });
});

describe('harvestInfo：參考最早採收日', () => {
  it('單一藥劑直接加上安全採收期', () => {
    const r = harvestInfo('2026-08-26', [{ phi: '7 天' }]);
    assert.equal(r.days, 7);
    assert.equal(r.date, '2026-09-02');
    assert.equal(r.unknown, false);
  });

  it('多種藥劑取最長的那個', () => {
    const r = harvestInfo('2026-08-26', [{ phi: '7 天' }, { phi: '12 天' }, { phi: '3 天' }]);
    assert.equal(r.days, 12);
    assert.equal(r.date, '2026-09-07');
  });

  it('有些藥沒有天數時仍推算，但標記為不完整', () => {
    const r = harvestInfo('2026-08-26', [{ phi: '7 天' }, { phi: '不需訂定' }]);
    assert.equal(r.days, 7);
    assert.equal(r.unknown, true);
  });

  it('全部都沒有天數就不推算', () => {
    const r = harvestInfo('2026-08-26', [{ phi: '-' }]);
    assert.equal(r.days, null);
    assert.equal(r.date, null);
    assert.equal(r.unknown, true);
  });
});

describe('pendingHarvests：還沒到安全採收期的土地', () => {
  const apps = [
    { fieldId: 'a', fieldName: '後山酪梨園', crop: '酪梨', date: '2026-08-26', harvestDate: '2026-09-02' },
    { fieldId: 'a', fieldName: '後山酪梨園', crop: '酪梨', date: '2026-08-20', harvestDate: '2026-08-27' },
    { fieldId: 'b', fieldName: '溪邊田', crop: '水稻', date: '2026-08-01', harvestDate: '2026-08-10' },
  ];

  it('已經過期的不列出', () => {
    const r = pendingHarvests(apps, '2026-08-28');
    assert.equal(r.length, 1);
    assert.equal(r[0].fieldName, '後山酪梨園');
  });

  it('同一塊地有多次施作時，以最晚的採收日為準', () => {
    const r = pendingHarvests(apps, '2026-08-21');
    const field = r.find((x) => x.fieldName === '後山酪梨園');
    assert.equal(field.harvestDate, '2026-09-02');
  });

  it('算得出還要等幾天', () => {
    const r = pendingHarvests(apps, '2026-08-28');
    assert.equal(r[0].daysLeft, 5);
  });

  it('全部都過期時回空陣列', () => {
    assert.deepEqual(pendingHarvests(apps, '2026-10-01'), []);
  });
});

describe('monthGrid：月曆格子', () => {
  it('格子數是七的倍數', () => {
    for (let m = 0; m < 12; m += 1) {
      assert.equal(monthGrid(2026, m).length % 7, 0, `${m + 1} 月`);
    }
  });

  it('第一格一定是星期日', () => {
    const cells = monthGrid(2026, 7); // 2026 年 8 月
    const [y, m, d] = cells[0].key.split('-').map(Number);
    assert.equal(new Date(y, m - 1, d).getDay(), 0);
  });

  it('屬於本月的格子數等於該月天數', () => {
    assert.equal(monthGrid(2026, 7).filter((c) => c.inMonth).length, 31);
    assert.equal(monthGrid(2026, 1).filter((c) => c.inMonth).length, 28);
    assert.equal(monthGrid(2028, 1).filter((c) => c.inMonth).length, 29);
  });

  it('本月的日期連續且從一號開始', () => {
    const days = monthGrid(2026, 7).filter((c) => c.inMonth).map((c) => c.day);
    assert.equal(days[0], 1);
    assert.equal(days.at(-1), 31);
  });
});

const SAMPLE = {
  id: 'test-1',
  date: '2026-08-26',
  time: '15:30',
  fieldName: '後山酪梨園',
  crop: '酪梨',
  area: '5',
  unit: 'fen',
  mode: 'tank',
  water: 520,
  note: '下午完成',
  harvestDate: '2026-09-07',
  drugs: [
    { name: '○○殺菌劑', amount: '260', amountUnit: '毫升', target: '炭疽病', dilution: '2000倍', phi: '12 天', interval: '10 天' },
    { name: '○○殺蟲劑', amount: '175', amountUnit: '公克', target: '薊馬', dilution: '1500倍', phi: '9 天', interval: '7 天' },
  ],
};

describe('buildRecordText：剪貼簿文字', () => {
  const textOut = buildRecordText(SAMPLE);

  it('包含日期、土地、作物與面積', () => {
    assert.ok(textOut.includes('日期：2026/08/26 15:30'));
    assert.ok(textOut.includes('土地：後山酪梨園'));
    assert.ok(textOut.includes('作物：酪梨'));
    assert.ok(textOut.includes('施作面積：5 分'));
  });

  it('同桶混用時列出總用水量', () => {
    assert.ok(textOut.includes('施作方式：同桶混用'));
    assert.ok(textOut.includes('實際用水：520 公升'));
  });

  it('藥名獨立一列，再列出實際用量與防治對象', () => {
    assert.ok(textOut.includes('1. ○○殺菌劑\n   本次使用量：260 毫升'));
    assert.ok(textOut.includes('防治對象：炭疽病'));
    assert.ok(textOut.includes('2. ○○殺蟲劑\n   本次使用量：175 公克'));
  });

  it('每種藥同時列出建議稀釋與依實際用量、用水反推的稀釋倍數', () => {
    assert.ok(textOut.includes('建議稀釋：2,000 倍'));
    assert.ok(textOut.includes('實際稀釋：約 2,000 倍'));
    assert.ok(textOut.includes('建議稀釋：1,500 倍'));
    assert.ok(textOut.includes('實際稀釋：約 2,971 倍'));
  });

  it('指定欄位移除圖示，日期、土地、作物與區塊圖示仍保留', () => {
    for (const icon of ['📐', '🚜', '💧', '🎯', '📏', '🧪', '⏳', '🔁']) {
      assert.ok(!textOut.includes(icon), `${icon} 不應出現在完整紀錄`);
    }
    assert.ok(textOut.includes('📅 日期：'));
    assert.ok(textOut.includes('📍 土地：'));
    assert.ok(textOut.includes('🌱 作物：'));
    assert.ok(textOut.includes('💊 本次用藥：'));
  });

  it('官方只有「日」時改顯示未提供，不產生沒有數字的天數', () => {
    const out = buildRecordText({ ...SAMPLE, drugs: [{ ...SAMPLE.drugs[0], interval: '日' }] });
    assert.ok(out.includes('施藥間隔：未提供'));
  });

  it('附上參考最早採收日並註明是推算的', () => {
    assert.ok(textOut.includes('參考最早採收日：2026/09/07'));
    assert.ok(textOut.includes('僅供參考'));
  });

  it('沒有採收日時明講無法推算，不留白讓人誤會', () => {
    const out = buildRecordText({ ...SAMPLE, harvestDate: null });
    assert.ok(out.includes('無法推算'));
  });

  it('分開施用時列出每種藥各自的用水量', () => {
    const out = buildRecordText({
      ...SAMPLE,
      mode: 'separate',
      drugs: [{ ...SAMPLE.drugs[0], water: 300 }],
    });
    assert.ok(out.includes('施作方式：分開施用'));
    assert.ok(out.includes('用水：300 公升'));
    assert.ok(!out.includes('實際用水：520'));
  });
});

describe('buildIcs：手機行事曆檔案', () => {
  const ics = buildIcs(SAMPLE, new Date(Date.UTC(2026, 7, 26, 8, 0, 0)));

  it('是完整的 iCalendar 結構', () => {
    assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
    assert.ok(ics.includes('BEGIN:VEVENT'));
    assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  });

  it('用全天事件，結束日是隔天', () => {
    assert.ok(ics.includes('DTSTART;VALUE=DATE:20260826'));
    assert.ok(ics.includes('DTEND;VALUE=DATE:20260827'));
  });

  it('標題含土地與作物', () => {
    assert.ok(ics.includes('SUMMARY:施藥｜後山酪梨園｜酪梨'));
  });

  it('備註裡的換行改成 \\n，不會把檔案結構弄壞', () => {
    // 把折行還原後，DESCRIPTION 必須是單獨一個屬性，中間不能出現真正的換行
    const unfolded = ics.replace(/\r\n /g, '');
    const description = unfolded.split('DESCRIPTION:')[1].split('\r\n')[0];
    assert.ok(description.includes('\\n'), '換行應該被轉成 \\n');
    assert.ok(description.includes('田間用藥・施作紀錄'));
    assert.ok(description.includes('建議稀釋：2\\,000 倍'));
    assert.ok(description.includes('實際稀釋：約 2\\,000 倍'));
    assert.ok(description.includes('參考最早採收日：2026/09/07'));
  });

  it('每一行都在 75 個位元組以內（中文最容易在這裡出錯）', () => {
    const encoder = new TextEncoder();
    for (const line of ics.split('\r\n')) {
      assert.ok(encoder.encode(line).length <= 75, `過長的行：${line}`);
    }
  });

  it('折行的續行都以一個空白開頭', () => {
    const lines = ics.split('\r\n');
    for (const line of lines) {
      if (line.startsWith(' ')) assert.ok(line.length > 1);
    }
    // 至少要有一行被折過，否則這個測試沒有測到東西
    assert.ok(lines.some((l) => l.startsWith(' ')));
  });

  it('半形分號與逗號都有跳脫（全形的中文標點不需要跳脫）', () => {
    const out = buildIcs({ ...SAMPLE, note: 'A;B,C' }, new Date(Date.UTC(2026, 7, 26)));
    const unfolded = out.replace(/\r\n /g, '');
    assert.ok(unfolded.includes('A\\;B\\,C'));
  });

  it('反斜線本身也要跳脫', () => {
    const out = buildIcs({ ...SAMPLE, note: 'C:\\temp' }, new Date(Date.UTC(2026, 7, 26)));
    assert.ok(out.replace(/\r\n /g, '').includes('C:\\\\temp'));
  });
});

describe('googleCalendarUrl', () => {
  const url = googleCalendarUrl(SAMPLE);

  it('指向 Google 日曆的新增事件頁', () => {
    assert.ok(url.startsWith('https://calendar.google.com/calendar/render?'));
    assert.ok(url.includes('action=TEMPLATE'));
  });

  it('日期範圍是施作當天到隔天', () => {
    assert.ok(decodeURIComponent(url).includes('dates=20260826/20260827'));
  });

  it('標題與內容都有經過網址編碼', () => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('text'), '施藥｜後山酪梨園｜酪梨');
    assert.ok(params.get('details').includes('後山酪梨園'));
    assert.ok(params.get('details').includes('建議稀釋：2,000 倍'));
    assert.ok(params.get('details').includes('實際稀釋：約 2,000 倍'));
  });
});
