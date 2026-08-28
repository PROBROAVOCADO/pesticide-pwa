import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actualDilution, calcRange, intersect, intersectAll, toBaseAmount, toBaseDose, waterRangeFor, doseRangeForWater, parseDilution, parseDose, toHectares } from './calc.js';

describe('parseDose：官方「每公頃使用用藥量」欄位', () => {
  it('讀得出區間與單位', () => {
    assert.deepEqual(parseDose('1.0-1.5 公斤'), { min: 1, max: 1.5, unit: '公斤' });
  });

  it('單一數值時 min 與 max 相同', () => {
    assert.deepEqual(parseDose('500 毫升'), { min: 500, max: 500, unit: '毫升' });
  });

  it('去掉千分位逗號', () => {
    assert.deepEqual(parseDose('1,200 公克'), { min: 1200, max: 1200, unit: '公克' });
  });

  it('沒有資料的「-」回 null', () => {
    assert.equal(parseDose('-'), null);
  });

  it('判斷不出單位就回 null，寧可不顯示也不要顯示錯的數字', () => {
    assert.equal(parseDose('2 倍'), null);
  });

  it('空字串回 null', () => {
    assert.equal(parseDose(''), null);
  });
});

describe('parseDilution：官方「稀釋倍數」欄位', () => {
  it('讀得出單一倍數', () => {
    assert.deepEqual(parseDilution('1000倍'), { min: 1000, max: 1000 });
  });

  it('讀得出區間，並且不管原文順序都回小到大', () => {
    assert.deepEqual(parseDilution('2000-3000倍'), { min: 2000, max: 3000 });
    assert.deepEqual(parseDilution('3000～2000倍'), { min: 2000, max: 3000 });
  });

  it('去掉千分位逗號', () => {
    assert.deepEqual(parseDilution('稀釋 1,500 倍'), { min: 1500, max: 1500 });
  });

  it('沒有數字回 null', () => {
    assert.equal(parseDilution('-'), null);
  });
});

describe('toHectares：面積單位換算', () => {
  it('公頃原樣', () => {
    assert.equal(toHectares(2, 'ha'), 2);
  });

  it('1 甲等於 10 分', () => {
    assert.ok(Math.abs(toHectares(1, 'jia') - toHectares(10, 'fen')) < 1e-9);
  });

  it('1 分約 969.9 平方公尺', () => {
    assert.ok(Math.abs(toHectares(1, 'fen') * 10000 - 969.914) < 0.01);
  });

  it('平方公尺換算', () => {
    assert.equal(toHectares(10000, 'm2'), 1);
  });
});

describe('toBaseDose：統一成公克／毫升', () => {
  it('公斤換成公克', () => {
    assert.deepEqual(toBaseDose({ min: 1, max: 1.5, unit: '公斤' }), { min: 1000, max: 1500, base: '公克' });
  });

  it('公升換成毫升', () => {
    assert.deepEqual(toBaseDose({ min: 0.5, max: 0.5, unit: '公升' }), { min: 500, max: 500, base: '毫升' });
  });

  it('已經是基本單位就不動', () => {
    assert.deepEqual(toBaseDose({ min: 300, max: 300, unit: '毫升' }), { min: 300, max: 300, base: '毫升' });
  });

  it('不認得的單位回 null', () => {
    assert.equal(toBaseDose({ min: 1, max: 1, unit: '包' }), null);
  });
});

describe('intersect：區間交集', () => {
  it('有重疊時取重疊段', () => {
    assert.deepEqual(intersect({ min: 500, max: 1000 }, { min: 600, max: 800 }), { min: 600, max: 800 });
  });

  it('完全沒有重疊回 null', () => {
    assert.equal(intersect({ min: 500, max: 1000 }, { min: 200, max: 400 }), null);
  });

  it('只碰到端點也算有交集', () => {
    assert.deepEqual(intersect({ min: 500, max: 1000 }, { min: 1000, max: 1200 }), { min: 1000, max: 1000 });
  });

  it('多個區間取共同交集（同桶混用會用到）', () => {
    const result = intersectAll([
      { min: 500, max: 1000 },
      { min: 600, max: 900 },
      { min: 700, max: 1200 },
    ]);
    assert.deepEqual(result, { min: 700, max: 900 });
  });

  it('多個區間只要有一段對不上就沒有共同交集', () => {
    const result = intersectAll([
      { min: 500, max: 1000 },
      { min: 200, max: 400 },
    ]);
    assert.equal(result, null);
  });
});

describe('用水量與藥量的互推', () => {
  it('1000 公克藥、稀釋 1000 倍需要 1000 公升水', () => {
    assert.deepEqual(waterRangeFor({ min: 1000, max: 1000 }, { min: 1000, max: 1000 }), { min: 1000, max: 1000 });
  });

  it('1000 公升水、稀釋 1000 倍需要 1000 公克藥', () => {
    assert.deepEqual(doseRangeForWater(1000, { min: 1000, max: 1000 }), { min: 1000, max: 1000 });
  });

  it('倍數越大用藥越少：反推藥量時最大倍數對應最小藥量', () => {
    const r = doseRangeForWater(600, { min: 2000, max: 3000 });
    assert.equal(r.min, 200); // 600 公升 ÷ 3000 倍
    assert.equal(r.max, 300); // 600 公升 ÷ 2000 倍
  });

  it('互推可以來回還原', () => {
    const dose = { min: 200, max: 300 };
    const dilution = { min: 2000, max: 3000 };
    const water = waterRangeFor(dose, dilution);
    assert.deepEqual(water, { min: 400, max: 900 });
  });
});

describe('calcRange：面積用藥量與稀釋倍數的交叉檢核', () => {
  const oneHa = 1;

  it('用水量落在合理範圍內時有交集', () => {
    // 每公頃 1 公斤、稀釋 1000 倍 → 1 公頃需要約 1000 公升水
    const r = calcRange('1 公斤', '1000倍', oneHa, 1000);
    assert.equal(r.kind, 'cross');
    assert.deepEqual(r.byArea, { min: 1000, max: 1000 });
    assert.deepEqual(r.byWater, { min: 1000, max: 1000 });
    assert.deepEqual(r.agreed, { min: 1000, max: 1000 });
    assert.equal(r.base, '公克');
  });

  it('用水量太少時沒有交集，必須提示調整', () => {
    // 每公頃 1 公斤、稀釋 1000 倍，卻只用 200 公升水
    // → 依面積要 1000 公克，依用水量只能放 200 公克，濃度會過高
    const r = calcRange('1 公斤', '1000倍', oneHa, 200);
    assert.equal(r.kind, 'cross');
    assert.equal(r.agreed, null);
    assert.deepEqual(r.suggestedWater, { min: 1000, max: 1000 });
  });

  it('用水量太多時同樣沒有交集', () => {
    const r = calcRange('1 公斤', '1000倍', oneHa, 5000);
    assert.equal(r.kind, 'cross');
    assert.equal(r.agreed, null);
  });

  it('區間對區間時，交集是兩者重疊的部分', () => {
    // 每公頃 1.0-1.5 公斤 → 1000~1500 公克
    // 600 公升水、稀釋 500-1000 倍 → 600~1200 公克
    // 交集 1000~1200 公克
    const r = calcRange('1.0-1.5 公斤', '500-1000倍', oneHa, 600);
    assert.equal(r.kind, 'cross');
    assert.deepEqual(r.agreed, { min: 1000, max: 1200 });
  });

  it('合理用水量區間依面積縮放', () => {
    // 半公頃、每公頃 1 公斤、稀釋 1000 倍 → 500 公克藥、500 公升水
    const r = calcRange('1 公斤', '1000倍', 0.5, 500);
    assert.equal(r.kind, 'cross');
    assert.deepEqual(r.suggestedWater, { min: 500, max: 500 });
    assert.deepEqual(r.agreed, { min: 500, max: 500 });
  });

  it('還沒填用水量時仍給出建議用水量區間', () => {
    const r = calcRange('1 公斤', '1000倍', oneHa, 0);
    assert.equal(r.kind, 'cross');
    assert.equal(r.agreed, null);
    assert.deepEqual(r.suggestedWater, { min: 1000, max: 1000 });
  });

  it('只有每公頃用量時退回單純的面積換算', () => {
    const r = calcRange('1 公斤', '-', oneHa, 500);
    assert.equal(r.kind, 'area-only');
  });

  it('只有稀釋倍數時退回單純的濃度換算', () => {
    const r = calcRange('-', '1000倍', oneHa, 500);
    assert.equal(r.kind, 'water-only');
    assert.deepEqual(r.byWater, { min: 500, max: 500 });
  });

  it('面積還沒填時不會硬算面積藥量', () => {
    const r = calcRange('1 公斤', '1000倍', 0, 500);
    assert.equal(r.kind, 'water-only');
  });

  it('兩個欄位都沒有資料時什麼都不算', () => {
    const r = calcRange('-', '-', oneHa, 500);
    assert.equal(r.kind, 'none');
  });
});

describe('toBaseAmount：使用者填的實際用量換算成公克／毫升', () => {
  it('公斤換公克', () => {
    assert.deepEqual(toBaseAmount('1.5', '公斤'), { value: 1500, base: '公克' });
  });

  it('公升換毫升', () => {
    assert.deepEqual(toBaseAmount('0.5', '公升'), { value: 500, base: '毫升' });
  });

  it('已經是基本單位就不動', () => {
    assert.deepEqual(toBaseAmount('260', '毫升'), { value: 260, base: '毫升' });
  });

  it('零、負數、空字串與怪單位都回 null', () => {
    assert.equal(toBaseAmount('0', '公克'), null);
    assert.equal(toBaseAmount('-5', '公克'), null);
    assert.equal(toBaseAmount('', '公克'), null);
    assert.equal(toBaseAmount('abc', '公克'), null);
    assert.equal(toBaseAmount('5', '瓢'), null);
  });
});

describe('actualDilution：由實際藥量與水量反推真正的稀釋倍數', () => {
  it('500 公升水配 500 公克藥 = 1000 倍', () => {
    assert.equal(actualDilution('500', '公克', 500), 1000);
  });

  it('單位是公斤時會先換算', () => {
    assert.equal(actualDilution('0.5', '公斤', 500), 1000);
  });

  it('水量加倍，倍數也加倍', () => {
    assert.equal(actualDilution('500', '公克', 1000), 2000);
  });

  it('600 公升配 300 毫升 = 2000 倍', () => {
    assert.equal(actualDilution('300', '毫升', 600), 2000);
  });

  it('四捨五入到整數，田間不需要小數點', () => {
    assert.equal(actualDilution('300', '公克', 500), 1667);
  });

  it('缺水量或缺藥量時不亂算', () => {
    assert.equal(actualDilution('500', '公克', 0), null);
    assert.equal(actualDilution('', '公克', 500), null);
    assert.equal(actualDilution('500', '公克', null), null);
  });
});
