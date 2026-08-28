import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drugCardHtml, esc, highlight, settingsViewHtml } from './views.js';

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
    version: 'v1.4.2',
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
});
