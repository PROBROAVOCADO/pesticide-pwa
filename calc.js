/**
 * 單位換算與用量試算。
 *
 * 官方對同一筆使用範圍會同時給兩個限制：
 *   1. 每公頃使用用藥量 —— 決定「這塊地總共可以用多少藥」
 *   2. 稀釋倍數         —— 決定「這些藥要配多少水」
 *
 * 這兩個限制必須同時成立才算合理。只看其中一個，很容易配出
 * 藥量對但濃度錯、或濃度對但整塊地用藥超量的藥液。
 *
 * 所有內部運算都先換算成公克（固體）或毫升（液體），
 * 避免公斤與公克、公升與毫升在中途混用。
 */

/** 面積單位的顯示名稱。 */
export const AREA_UNITS = [
  { value: 'fen', label: '分' },
  { value: 'jia', label: '甲' },
  { value: 'm2', label: '平方公尺' },
  { value: 'ha', label: '公頃' },
];

/** 台灣常用面積單位換算成公頃。1 分 ≈ 0.0969914 公頃，1 甲 = 10 分。 */
export function toHectares(area, unit) {
  if (unit === 'ha') return area;
  if (unit === 'fen') return area * 0.0969914;
  if (unit === 'jia') return area * 0.969914;
  return area / 10000;
}

/**
 * 解析官方「每公頃使用用藥量」欄位。
 * 常見形式：「1.0-1.5 公斤」「500 毫升」「0.5 公升」「-」（無資料）。
 * 判斷不出單位就回 null，寧可不顯示也不要顯示錯的數字。
 */
export function parseDose(raw) {
  const clean = String(raw ?? '').replace(/,/g, '').trim();
  const nums = [...clean.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (!nums.length || clean === '-') return null;

  const unit = /公斤|kg/i.test(clean)
    ? '公斤'
    : /毫升|ml|c\.?c\.?/i.test(clean)
      ? '毫升'
      : /公升|\bl(?:iter)?s?\b/i.test(clean)
        ? '公升'
        : /公克|克|\bg\b/i.test(clean)
          ? '公克'
          : '';

  return unit ? { min: nums[0], max: nums[1] ?? nums[0], unit } : null;
}

/**
 * 解析官方「稀釋倍數」欄位，取出倍數區間。
 * 注意倍數越大代表越稀，所以「最大倍數」對應「最少藥量」。
 */
export function parseDilution(raw) {
  const nums = [...String(raw ?? '').replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;
}

const UNIT_TABLE = {
  公斤: { factor: 1000, base: '公克' },
  公克: { factor: 1, base: '公克' },
  公升: { factor: 1000, base: '毫升' },
  毫升: { factor: 1, base: '毫升' },
};

/** 把官方的每公頃用量換算成「每公頃幾公克／幾毫升」。 */
export function toBaseDose(dose) {
  const entry = UNIT_TABLE[dose.unit];
  if (!entry) return null;
  return { min: dose.min * entry.factor, max: dose.max * entry.factor, base: entry.base };
}

/** 兩個區間的交集。沒有交集回 null。 */
export function intersect(a, b) {
  const min = Math.max(a.min, b.min);
  const max = Math.min(a.max, b.max);
  return min <= max ? { min, max } : null;
}

/** 多個區間的交集。任何一段對不上就回 null（同桶混用會用到）。 */
export function intersectAll(ranges) {
  if (!ranges.length) return null;
  return ranges.reduce((acc, r) => (acc ? intersect(acc, r) : null), ranges[0]);
}

/**
 * 稀釋 x 倍 = 1 份藥兌 x 份水。
 * 藥量 a（公克或毫升）配出的藥液量 = a × x 毫升 = a × x ÷ 1000 公升。
 */

/** 由藥量區間與稀釋倍數區間，反推合理的用水量區間（公升）。 */
export function waterRangeFor(doseAmount, dilution) {
  return {
    min: (doseAmount.min * dilution.min) / 1000,
    max: (doseAmount.max * dilution.max) / 1000,
  };
}

/** 由用水量與稀釋倍數區間，推回藥量區間（公克或毫升）。 */
export function doseRangeForWater(waterLiters, dilution) {
  return {
    min: (waterLiters * 1000) / dilution.max,
    max: (waterLiters * 1000) / dilution.min,
  };
}

/**
 * 對一筆使用範圍做完整試算。
 *
 * 回傳的 kind 有四種：
 *   cross      —— 兩個限制都有資料，可以交叉檢核
 *   area-only  —— 只有每公頃用量
 *   water-only —— 只有稀釋倍數
 *   none       —— 兩個都算不出來
 *
 * @param {string} rawDose      官方「每公頃使用用藥量」欄位原文
 * @param {string} rawDilution  官方「稀釋倍數」欄位原文
 * @param {number} areaHa       施用面積（公頃）
 * @param {number} waterLiters  實際用水量（公升）
 */
export function calcRange(rawDose, rawDilution, areaHa, waterLiters) {
  const parsedDose = parseDose(rawDose);
  const baseDose = parsedDose ? toBaseDose(parsedDose) : null;
  const dilution = parseDilution(rawDilution);

  const hasWater = Boolean(dilution) && waterLiters > 0;

  if (baseDose && areaHa > 0) {
    const byArea = { min: baseDose.min * areaHa, max: baseDose.max * areaHa };

    if (dilution) {
      const suggestedWater = waterRangeFor(byArea, dilution);

      if (!hasWater) {
        // 還沒填用水量，先給合理的用水量區間當參考。
        return { kind: 'cross', byArea, byWater: { min: 0, max: 0 }, agreed: null, suggestedWater, base: baseDose.base };
      }

      const byWater = doseRangeForWater(waterLiters, dilution);
      return {
        kind: 'cross',
        byArea,
        byWater,
        agreed: intersect(byArea, byWater),
        suggestedWater,
        base: baseDose.base,
      };
    }

    return { kind: 'area-only', byArea, base: baseDose.base };
  }

  if (dilution && hasWater) {
    return { kind: 'water-only', byWater: doseRangeForWater(waterLiters, dilution) };
  }

  return { kind: 'none' };
}

/**
 * 把使用者填的實際用量換算成基本單位（公克或毫升）。
 * 認不得的單位回 null —— 寧可不算，也不要算錯。
 */
export function toBaseAmount(amount, unit) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  const entry = UNIT_TABLE[unit];
  if (!entry) return null;
  return { value: value * entry.factor, base: entry.base };
}

/**
 * 由實際用量與實際用水量，反推這一桶真正的稀釋倍數。
 *
 * 稀釋倍數 = 水量（毫升）÷ 藥量（公克或毫升）
 *
 * 這是紀錄頁要顯示的數字：官方標示的是「建議」，
 * 但實際下田配出來的濃度才是那天真正發生的事。
 */
export function actualDilution(amount, unit, waterLiters) {
  const base = toBaseAmount(amount, unit);
  const water = Number(waterLiters);
  if (!base || !Number.isFinite(water) || water <= 0) return null;
  return Math.round((water * 1000) / base.value);
}

/**
 * 檢查一次「實際施作」是否落在標示範圍內。
 *
 * 面積用量與稀釋倍數分開判斷：
 * - 面積用量關係到整塊地實際用了多少藥，優先顯示。
 * - 稀釋倍數用來補充檢查濃度，不能拿加水來掩蓋面積用量超標。
 */
export function assessApplication(rawDose, rawDilution, areaHa, waterLiters, amount, unit) {
  const range = calcRange(rawDose, rawDilution, areaHa, waterLiters);
  const dilution = parseDilution(rawDilution);
  const actual = toBaseAmount(amount, unit);
  const actualFactor = actualDilution(amount, unit, waterLiters);

  let doseStatus = range.byArea ? 'missing' : 'unavailable';
  if (range.byArea && actual) {
    if (actual.base !== range.base) {
      doseStatus = 'unit-mismatch';
    } else {
      // 顯示值會四捨五入到 0.1，邊界保留半個顯示刻度，避免「照畫面填仍被判超標」。
      const displayMargin = 0.051;
      if (actual.value < range.byArea.min - displayMargin) doseStatus = 'below';
      else if (actual.value > range.byArea.max + displayMargin) doseStatus = 'above';
      else doseStatus = 'ok';
    }
  }

  let dilutionStatus = dilution ? 'missing' : 'unavailable';
  if (dilution && actual && !(Number(waterLiters) > 0)) dilutionStatus = 'no-water';
  if (dilution && actualFactor) {
    if (actualFactor < dilution.min) dilutionStatus = 'too-concentrated';
    else if (actualFactor > dilution.max) dilutionStatus = 'too-dilute';
    else dilutionStatus = 'ok';
  }

  return { range, dilution, actual, actualFactor, doseStatus, dilutionStatus };
}

/** 顯示基本單位的數量：滿 1000 就升階成公斤／公升，田間比較好量。 */
export function formatBase(value, base) {
  if (value >= 1000) {
    const big = base === '公克' ? '公斤' : '公升';
    return `${Math.round((value / 1000) * 1000) / 1000} ${big}`;
  }
  return `${Math.round(value * 10) / 10} ${base}`;
}

/** 顯示一個藥量區間，單一數值時不重複顯示。 */
export function formatRange(range, base) {
  const min = formatBase(range.min, base);
  const max = formatBase(range.max, base);
  return min === max ? min : `${min} ～ ${max}`;
}

/** 顯示用水量區間（公升）。 */
export function formatWater(range) {
  const round = (n) => Math.round(n * 10) / 10;
  const min = round(range.min);
  const max = round(range.max);
  return min === max ? `${min} 公升` : `${min} ～ ${max} 公升`;
}
