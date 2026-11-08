import { matchesCrop } from './moa.js';

/** 保留完整用途，讓切換作物後仍可切回；同一用途仍有效時保留使用者選擇。 */
export function syncItemCrop(item, crop) {
  const previous = item.ranges[item.selected];
  const ranges = item.allRanges || item.ranges;
  const matched = ranges.filter((range) => matchesCrop(range, crop));
  item.ranges = matched.length ? matched : ranges;
  item.selected = Math.max(0, item.ranges.indexOf(previous));
  item.cropMissing = item.rangeStatus === 'ok' && !matched.length;
}
