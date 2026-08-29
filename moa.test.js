import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classTone, drugSubtitle, drugTitle, license, licenseStatus, matchesCrop, normalize, parseRocDate, scanDrugsByCrop, statusRank, uniqueDrugs } from './moa.js';

describe('normalize：作物名稱正規化', () => {
  it('臺與台視為同一個字', () => {
    assert.equal(normalize('臺灣'), normalize('台灣'));
  });

  it('蕃與番視為同一個字', () => {
    assert.equal(normalize('蕃茄'), normalize('番茄'));
  });

  it('去掉空白與各種連字號', () => {
    assert.equal(normalize('小 白 菜'), '小白菜');
    assert.equal(normalize('甘藍－結球'), '甘藍結球');
    assert.equal(normalize('豌豆—嫩莢'), '豌豆嫩莢');
  });

  it('英文轉小寫', () => {
    assert.equal(normalize('Avocado'), 'avocado');
  });

  it('null 與 undefined 不會爆掉', () => {
    assert.equal(normalize(null), '');
    assert.equal(normalize(undefined), '');
  });
});

describe('matchesCrop：使用範圍是否符合這個作物', () => {
  const range = (name) => ({ 作物名稱: name });

  it('完全相同', () => {
    assert.equal(matchesCrop(range('酪梨'), '酪梨'), true);
  });

  it('官方寫「蕃茄」時，使用者打「番茄」也找得到', () => {
    assert.equal(matchesCrop(range('蕃茄'), '番茄'), true);
  });

  it('官方寫「臺灣」時，使用者打「台灣」也找得到', () => {
    assert.equal(matchesCrop(range('臺灣百合'), '台灣百合'), true);
  });

  it('使用者只打一部分也算符合', () => {
    assert.equal(matchesCrop(range('甘藍（結球）'), '甘藍'), true);
  });

  it('官方名稱比使用者輸入短時也算符合', () => {
    assert.equal(matchesCrop(range('稻'), '稻米'), true);
  });

  it('不相干的作物不算', () => {
    assert.equal(matchesCrop(range('酪梨'), '水稻'), false);
  });

  it('空字串代表不篩選，全部通過', () => {
    assert.equal(matchesCrop(range('酪梨'), ''), true);
    assert.equal(matchesCrop(range('水稻'), ''), true);
  });

  it('作物名稱欄位是空的時候不會誤判成符合', () => {
    assert.equal(matchesCrop(range(''), '酪梨'), false);
    assert.equal(matchesCrop(range(null), '酪梨'), false);
  });
});

describe('scanDrugsByCrop：完整比對藥名搜尋結果', () => {
  it('排在第 24 筆之後的核准廠牌也不會漏掉', async () => {
    const drugs = Array.from({ length: 80 }, (_, i) => ({
      許可證字: '農藥進',
      許可證號: String(i + 1).padStart(5, '0'),
      廠牌名稱: i === 71 ? '大卡稱' : `廠牌 ${i + 1}`,
    }));
    const progress = [];
    const matches = [];

    const result = await scanDrugsByCrop(
      drugs,
      '酪梨',
      async (drug) => ({
        ranges: drug.廠牌名稱 === '大卡稱' ? [{ 作物名稱: '酪梨' }] : [{ 作物名稱: '水稻' }],
        status: 'ok',
        fromCache: true,
      }),
      {
        concurrency: 4,
        onProgress: (done, total) => progress.push([done, total]),
        onMatch: (drug) => matches.push(drug.廠牌名稱),
      },
    );

    assert.equal(result.scanned, 80);
    assert.equal(result.failed, 0);
    assert.equal(result.cached, 80);
    assert.deepEqual(result.matched.map((d) => d.廠牌名稱), ['大卡稱']);
    assert.deepEqual(matches, ['大卡稱']);
    assert.deepEqual(progress.at(-1), [80, 80]);
  });
});

describe('parseRocDate：民國日期轉西元', () => {
  it('三位數年份', () => {
    assert.equal(parseRocDate('106/12/13'), '2017-12-13');
    assert.equal(parseRocDate('120/07/12'), '2031-07-12');
  });

  it('個位數月日補零', () => {
    assert.equal(parseRocDate('115/1/5'), '2026-01-05');
  });

  it('空白格式回 null', () => {
    assert.equal(parseRocDate('   /  /  '), null);
    assert.equal(parseRocDate(''), null);
    assert.equal(parseRocDate(null), null);
  });
});

describe('licenseStatus：許可證狀態', () => {
  const base = { 撤銷類別: '', 撤銷日期: '   /  /  ', 有效期限: '120/07/12' };

  it('未撤銷且未到期是有效', () => {
    const r = licenseStatus(base, '2026-08-28');
    assert.equal(r.state, 'valid');
    assert.equal(r.date, '2031-07-12');
  });

  it('有效期限過了就算到期，即使撤銷類別是空的', () => {
    // 農藥進02068 就是這種：有效期限 106/12/13，撤銷類別空白。
    // 只看撤銷類別會把它當成有效藥劑列出來。
    const r = licenseStatus({ ...base, 有效期限: '106/12/13' }, '2026-08-28');
    assert.equal(r.state, 'expired');
    assert.equal(r.date, '2017-12-13');
  });

  it('到期當天還算有效', () => {
    const r = licenseStatus({ ...base, 有效期限: '115/08/28' }, '2026-08-28');
    assert.equal(r.state, 'valid');
  });

  it('撤銷優先於到期', () => {
    const r = licenseStatus({ ...base, 撤銷類別: '禁用', 有效期限: '106/12/13' }, '2026-08-28');
    assert.equal(r.state, 'revoked');
    assert.ok(r.label.includes('禁用'));
  });

  it('沒有有效期限時不亂猜，當成有效', () => {
    const r = licenseStatus({ ...base, 有效期限: '' }, '2026-08-28');
    assert.equal(r.state, 'valid');
    assert.equal(r.date, null);
  });
});

describe('classTone：分類的顯示樣式', () => {
  it('認得複合寫法，不是只認完全相等的字串', () => {
    assert.equal(classTone('殺菌劑'), 'fungicide');
    assert.equal(classTone('殺菌殺蟎劑'), 'fungicide');
    assert.equal(classTone('殺蟲劑'), 'insecticide');
    assert.equal(classTone('殺蟲殺蟎劑'), 'insecticide');
    assert.equal(classTone('殺蟎劑'), 'insecticide');
    assert.equal(classTone('除草劑'), 'herbicide');
  });

  it('沒見過的分類歸到其他，不會爆掉', () => {
    assert.equal(classTone('植物生長調節劑'), 'other');
    assert.equal(classTone(''), 'other');
  });
});

describe('uniqueDrugs：只去重，不過濾', () => {
  const make = (num, kind = '殺菌劑', revoked = '') => ({
    許可證字: '農藥製',
    許可證號: num,
    農藥分類中文意義: kind,
    撤銷類別: revoked,
  });

  it('相同許可證只留一筆', () => {
    assert.equal(uniqueDrugs([make('1'), make('1'), make('2')]).length, 2);
  });

  it('除草劑與已撤銷的都照樣留下 —— 藏起來比列出來危險', () => {
    const rows = [make('1'), make('2', '除草劑'), make('3', '殺蟲劑', '禁用')];
    assert.equal(uniqueDrugs(rows).length, 3);
  });

  it('沒有許可證號的雜訊資料會被丟掉', () => {
    assert.equal(uniqueDrugs([{ 許可證字: '', 許可證號: '' }]).length, 0);
  });

  it('空陣列不會出事', () => {
    assert.deepEqual(uniqueDrugs([]), []);
  });
});

describe('顯示用的欄位組合', () => {
  it('許可證字號串起來', () => {
    assert.equal(license({ 許可證字: '農藥製', 許可證號: '12345' }), '農藥製12345');
  });

  it('標題優先用廠牌名稱', () => {
    assert.equal(drugTitle({ 廠牌名稱: '果好靈', 中文名稱: '待克利' }), '果好靈');
  });

  it('沒有廠牌就退回普通名稱', () => {
    assert.equal(drugTitle({ 廠牌名稱: '', 中文名稱: '待克利' }), '待克利');
  });

  it('兩個都沒有就退回許可證號，不會顯示空白', () => {
    assert.equal(drugTitle({ 許可證字: '農藥製', 許可證號: '12345' }), '農藥製12345');
  });

  it('副標題略過空欄位，不會出現多餘的分隔點', () => {
    assert.equal(drugSubtitle({ 中文名稱: '待克利', 含量: '', 劑型: '水懸劑' }), '待克利・水懸劑');
  });
});

describe('statusRank：有效的要排在過期與撤銷的前面', () => {
  const mk = (until, revoked = '') => ({ 有效期限: until, 撤銷類別: revoked, 撤銷日期: '   /  /  ' });

  it('有效 0、到期 1、撤銷 2', () => {
    assert.equal(statusRank(mk('130/01/01')), 0);
    assert.equal(statusRank(mk('106/12/13')), 1);
    assert.equal(statusRank(mk('130/01/01', '禁用')), 2);
  });

  it('拿來排序時，過期的不會擋在有效的前面', () => {
    const rows = [mk('106/12/13'), mk('130/01/01'), mk('130/01/01', '禁用')];
    const sorted = rows.map((d, i) => ({ d, r: statusRank(d), i })).sort((a, b) => a.r - b.r || a.i - b.i);
    assert.deepEqual(sorted.map((x) => x.r), [0, 1, 2]);
  });
});
