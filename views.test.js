import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  customDilutionHtml,
  drugCardHtml,
  esc,
  highlight,
  recordDetailHtml,
  recordFormHtml,
  recordGuidanceHtml,
  recordsViewHtml,
  searchResultsHtml,
  settingsViewHtml,
} from './views.js';

describe('highlight：標出搜尋字串', () => {
  it('標出中間的片段', () => {
    assert.equal(highlight('銅右滅達樂', '滅達'), '銅右<mark>滅達</mark>樂');
  });

  it('同一段文字裡出現多次都會標', () => {
    assert.equal(highlight('滅達滅達', '滅達'), '<mark>滅達</mark><mark>滅達</mark>');
  });

  it('沒有關鍵字時原樣輸出', () => {
    assert.equal(highlight('銅右滅達樂', ''), '銅右滅達樂');
    assert.equal(highlight('銅右滅達樂', '   '), '銅右滅達樂');
  });

  it('沒有符合時不會亂插標籤', () => {
    assert.equal(highlight('亞托敏', '滅達'), '亞托敏');
  });

  it('英文不分大小寫', () => {
    assert.equal(highlight('Metalaxyl', 'META'), '<mark>Meta</mark>laxyl');
  });

  it('null 與 undefined 不會爆掉', () => {
    assert.equal(highlight(null, '滅達'), '');
    assert.equal(highlight(undefined, '滅達'), '');
  });

  // 這幾條是重點：官方資料會直接進 innerHTML，
  // 高亮功能絕對不能變成把角括號放行的破口。
  it('原文裡的角括號會被 escape', () => {
    assert.equal(highlight('<script>x</script>', ''), '&lt;script&gt;x&lt;/script&gt;');
  });

  it('關鍵字命中的那一段也會被 escape', () => {
    assert.equal(highlight('a<b>c', '<b>'), 'a<mark>&lt;b&gt;</mark>c');
  });

  it('關鍵字前後的文字同樣會被 escape', () => {
    assert.equal(highlight('<i>滅達</i>', '滅達'), '&lt;i&gt;<mark>滅達</mark>&lt;/i&gt;');
  });

  it('引號也會被 escape，不會逃出屬性', () => {
    assert.equal(highlight('a"b\'c', ''), 'a&quot;b&#39;c');
  });

  it('輸出裡除了 mark 之外沒有其他標籤', () => {
    const out = highlight('<img src=x onerror=alert(1)>滅達', '滅達');
    assert.ok(!out.includes('<img'));
    assert.ok(out.includes('<mark>滅達</mark>'));
  });
});

describe('esc', () => {
  it('五個危險字元都處理', () => {
    assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });
});

const 銅右滅達樂 = {
  農藥分類中文意義: '殺菌劑',
  農藥類別中文意義: '混合劑',
  廠牌名稱: '金手指',
  中文名稱: '銅右滅達樂',
  含量: '71.600 (%)',
  劑型: 'WP',
  廠商名稱: '光華化學股份有限公司',
  許可證字: '農藥製',
  許可證號: '07146',
  撤銷類別: '',
  撤銷日期: '   /  /  ',
  有效期限: '118/02/16',
};

describe('drugCardHtml：商品名與普通名都要看得見', () => {
  const card = drugCardHtml(銅右滅達樂, 'pick', '', false, 'yes', '滅達');

  it('標題是廠牌名稱（農友去農藥行報的是這個）', () => {
    assert.ok(card.includes('<strong>金手指</strong>'));
  });

  it('普通名另外列一行，不會被擠到看不見', () => {
    assert.ok(card.includes('class="common-name"'));
    assert.ok(card.includes('銅右<mark>滅達</mark>樂'));
  });

  it('廠商與許可證號分得出是哪一支', () => {
    assert.ok(card.includes('光華化學股份有限公司'));
    assert.ok(card.includes('農藥製07146'));
  });

  it('有效期限換算成西元顯示', () => {
    assert.ok(card.includes('有效至 2029/02/16'));
  });

  it('分類與混合劑都標出來', () => {
    assert.ok(card.includes('殺菌劑'));
    assert.ok(card.includes('混合劑'));
  });

  it('核准標記', () => {
    assert.ok(card.includes('✅ 已核准'));
  });

  it('搜尋結果可以用許可證定位正確卡片', () => {
    const result = drugCardHtml(銅右滅達樂, 'open-detail', 'data-license="農藥製07146"', false, 'yes', '');
    assert.ok(result.includes('data-license="農藥製07146"'));
  });

  it('沒有廠牌名稱時不會重複列兩次普通名', () => {
    const noBrand = drugCardHtml({ ...銅右滅達樂, 廠牌名稱: '' }, 'pick', '', false, undefined, '');
    assert.ok(noBrand.includes('<strong>銅右滅達樂</strong>'));
    assert.ok(!noBrand.includes('class="common-name"'));
  });
});

describe('drugCardHtml：過期與撤銷要標出來', () => {
  it('有效期限過了就標「已到期」，即使撤銷類別是空的', () => {
    const expired = drugCardHtml(
      { ...銅右滅達樂, 廠牌名稱: '金-高手', 許可證字: '農藥進', 許可證號: '02068', 有效期限: '106/12/13' },
      'pick', '', false, undefined, '',
    );
    assert.ok(expired.includes('inactive'));
    assert.ok(expired.includes('許可證已到期'));
    assert.ok(expired.includes('已於 2017/12/13 到期'));
  });

  it('撤銷的標出撤銷類別', () => {
    const revoked = drugCardHtml({ ...銅右滅達樂, 撤銷類別: '禁用' }, 'pick', '', false, undefined, '');
    assert.ok(revoked.includes('inactive'));
    assert.ok(revoked.includes('已撤銷（禁用）'));
  });

  it('有效的不會被標成停用', () => {
    const valid = drugCardHtml(銅右滅達樂, 'pick', '', false, undefined, '');
    assert.ok(!valid.includes('inactive'));
    assert.ok(!valid.includes('status-tag'));
  });
});

describe('settingsViewHtml：操作按鈕與下拉說明分開', () => {
  const html = settingsViewHtml({
    version: 'v1.4.9',
    aphiaUrl: 'https://example.com/aphia',
    lineUrl: 'https://example.com/line',
    fieldCount: 2,
    appCount: 5,
    persisted: true,
    dbError: '',
  });

  it('四個直接操作維持按鈕', () => {
    assert.ok(html.includes('data-action="install"'));
    assert.ok(html.includes('data-action="open-fields"'));
    assert.ok(html.includes('data-action="export-backup"'));
    assert.ok(html.includes('data-action="import-backup"'));
  });

  it('五項文字說明改成可展開區塊', () => {
    assert.equal((html.match(/<details class="setting-disclosure">/g) || []).length, 5);
    assert.ok(html.includes('匯出的檔案跑去哪了'));
    assert.ok(html.includes('資料會在什麼時候消失'));
    assert.ok(html.includes('版本更新摘要'));
    assert.ok(html.includes('資料與責任說明'));
    assert.ok(html.includes('買杯咖啡支持'));
  });

  it('設定頁不再用彈窗按鈕打開版本與支持內容', () => {
    assert.ok(!html.includes('data-action="modal"'));
  });

  it('版本摘要只顯示最新三個版本', () => {
    assert.deepEqual(html.match(/<b>v\d+\.\d+\.\d+(?:・這一版)?<\/b>/g), [
      '<b>v1.4.9・這一版</b>',
      '<b>v1.4.8</b>',
      '<b>v1.4.7</b>',
    ]);
    assert.ok(!html.includes('v1.4.6'));
  });

  it('在設定頁最下方顯示動態版本與年份的品牌署名', () => {
    assert.equal((html.match(/class="colophon"/g) || []).length, 1);
    assert.ok(html.includes('PRO-BRO AVOCADO'));
    assert.ok(html.includes('A field tool for growers, built on a family avocado farm in Nantou, Taiwan.'));
    assert.ok(html.includes(`v1.4.9 &nbsp;·&nbsp; © ${new Date().getFullYear()}`));
    assert.ok(html.indexOf('買杯咖啡支持') < html.indexOf('class="colophon"'));
  });
});

describe('searchResultsHtml：核准比對途中可先顯示已找到的卡片', () => {
  it('loading 尚未結束，只要有結果就先畫出來', () => {
    const html = searchResultsHtml({
      drugs: [銅右滅達樂],
      loading: true,
      allApproved: true,
      total: 1,
      matched: 1,
      shownLimit: 120,
      keyword: '滅達',
    });
    assert.ok(html.includes('<strong>金手指</strong>'));
    assert.ok(html.includes('✅ 已核准'));
  });
});

const recordDraft = {
  id: null,
  date: '2026-08-29',
  time: '08:00',
  fieldName: '五分地',
  crop: '酪梨',
  area: 0.5,
  unit: 'ha',
  mode: 'tank',
  water: 750,
  additives: [],
  harvestDate: null,
  harvestDays: null,
  harvestUnknown: false,
  error: '',
  drugs: [{
    name: '測試藥劑',
    target: '炭疽病',
    dosePerHa: '500-1000 CC',
    dilution: '2000倍',
    amount: '',
    amountUnit: '毫升',
    water: '',
    phi: '7天',
    interval: '7天',
  }],
};

const customDraft = {
  id: null,
  recordType: 'custom',
  date: '2026-08-29',
  time: '10:00',
  fieldId: 'field-1',
  fieldName: '測試園',
  crop: '酪梨',
  area: 1,
  unit: 'jia',
  mode: 'tank',
  water: 500,
  drugs: [],
  additives: [{ name: '自製菌液', amount: '250', unit: '毫升', note: '葉面施用' }],
  harvestDate: null,
  harvestDays: null,
  harvestUnknown: true,
  note: '',
  error: '',
};

describe('recordGuidanceHtml：面積用量是主建議，實際數字另行檢查', () => {
  it('先顯示半公頃換算的 250～500 毫升，空白實際用量不會被冒充成紀錄', () => {
    const html = recordGuidanceHtml(recordDraft, recordDraft.drugs[0]);
    assert.ok(html.includes('依面積換算的標示用量'));
    assert.ok(html.includes('250 毫升 ～ 500 毫升'));
    assert.ok(html.includes('不會自動填成實際紀錄'));
  });

  it('750 公升配 250 毫升時，面積用量符合但另行警告過度稀釋', () => {
    const drug = { ...recordDraft.drugs[0], amount: '250' };
    const html = recordGuidanceHtml(recordDraft, drug);
    assert.ok(html.includes('面積用量符合'));
    assert.ok(html.includes('實際約 3,000 倍，稀釋過度'));
    assert.ok(html.includes('防治效果可能不足'));
  });

  it('超過面積上限時明講增加用水不能抵銷', () => {
    const drug = { ...recordDraft.drugs[0], amount: '600' };
    const html = recordGuidanceHtml({ ...recordDraft, water: 1500 }, drug);
    assert.ok(html.includes('超過面積用量上限'));
    assert.ok(html.includes('增加用水不能抵銷總用藥超量'));
    assert.ok(html.includes('殘留超標'));
  });

  it('表單的實際用量維持空白，並放入可即時更新的檢查區', () => {
    const html = recordFormHtml(recordDraft);
    assert.ok(html.includes('data-record-guidance="0"'));
    assert.ok(html.includes('data-field="record-amount" data-idx="0" value=""'));
  });

  it('添加物單位使用常用下拉選單，舊的自訂單位也不會消失', () => {
    const html = recordFormHtml({
      ...recordDraft,
      additives: [{ name: '自製菌液', amount: '2', unit: '桶', note: '' }],
    });
    assert.ok(html.includes('data-field="additive-unit" data-idx="0"'));
    assert.ok(html.includes('<option value="毫升">毫升</option>'));
    assert.ok(html.includes('<option value="桶" selected>桶</option>'));
  });

  it('過去保存過的添加物可以從常用清單快速加入', () => {
    const html = recordFormHtml(recordDraft, [{ name: '自製菌液', unit: '公升' }]);
    assert.ok(html.includes('data-field="additive-preset"'));
    assert.ok(html.includes('自製菌液・公升'));
    assert.ok(html.includes('實際用量不會沿用'));
  });
});

describe('自訂配方／資材施作流程', () => {
  it('施作紀錄首頁提供不必先選官方藥劑的入口', () => {
    const html = recordsViewHtml({
      month: new Date(2026, 7, 1),
      applications: [],
      selected: '',
      pending: [],
      filterFieldId: '',
      fields: [],
    });
    assert.ok(html.includes('data-action="open-custom-record-form"'));
    assert.ok(html.includes('完全沒有使用農業部藥劑'));
  });

  it('表單可從本機土地帶入，且不顯示官方藥劑區塊', () => {
    const html = recordFormHtml(
      customDraft,
      [{ name: '自製菌液', unit: '毫升' }],
      [{ id: 'field-1', name: '測試園', crop: '酪梨', area: 1, unit: 'jia' }],
    );
    assert.ok(html.includes('記錄自訂配方／資材'));
    assert.ok(html.includes('data-field="record-field-preset"'));
    assert.ok(html.includes('<option value="field-1" selected>測試園</option>'));
    assert.ok(!html.includes('<h3>💊 本次用藥</h3>'));
    assert.ok(html.includes('從常用配方／資材快速加入'));
  });

  it('依實際用量與總用水反推稀釋，不冒充官方建議', () => {
    const html = customDilutionHtml(customDraft, customDraft.additives[0]);
    assert.ok(html.includes('實際約 2,000 倍'));
    assert.ok(html.includes('沒有農業部官方建議稀釋'));
  });

  it('明細會列出自訂項目、實際稀釋與無官方採收資料', () => {
    const html = recordDetailHtml({ ...customDraft, id: 'custom-1' }, false);
    assert.ok(html.includes('🧴 自訂配方／資材'));
    assert.ok(html.includes('實際稀釋'));
    assert.ok(html.includes('約 2,000 倍'));
    assert.ok(html.includes('無官方資料，無法推算'));
    assert.ok(!html.includes('<h3>💊 本次用藥</h3>'));
  });
});
