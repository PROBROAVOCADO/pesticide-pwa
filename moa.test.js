import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drugSubtitle, drugTitle, isAllowed, license, matchesCrop, normalize, uniqueDrugs } from './moa.js';

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

describe('isAllowed：只收錄仍有效的殺菌劑與殺蟲劑', () => {
  it('有效的殺菌劑', () => {
    assert.equal(isAllowed({ 農藥分類中文意義: '殺菌劑', 撤銷類別: '' }), true);
  });

  it('有效的殺蟲劑', () => {
    assert.equal(isAllowed({ 農藥分類中文意義: '殺蟲劑', 撤銷類別: null }), true);
  });

  it('已撤銷的不收', () => {
    assert.equal(isAllowed({ 農藥分類中文意義: '殺菌劑', 撤銷類別: '禁用' }), false);
  });

  it('除草劑不在收錄範圍', () => {
    assert.equal(isAllowed({ 農藥分類中文意義: '除草劑', 撤銷類別: '' }), false);
  });
});

describe('uniqueDrugs：去重與過濾', () => {
  const make = (num, kind = '殺菌劑', revoked = '') => ({
    許可證字: '農藥製',
    許可證號: num,
    農藥分類中文意義: kind,
    撤銷類別: revoked,
  });

  it('相同許可證只留一筆', () => {
    assert.equal(uniqueDrugs([make('1'), make('1'), make('2')]).length, 2);
  });

  it('順便濾掉撤銷與不符分類的', () => {
    const rows = [make('1'), make('2', '除草劑'), make('3', '殺蟲劑', '禁用')];
    assert.equal(uniqueDrugs(rows).length, 1);
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
