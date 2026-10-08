import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MAIN_API = 'https://data.moa.gov.tw/Service/OpenData/FromM/PesticideData.aspx?$top=9999';
const RANGE_API = 'https://pesticide.aphia.gov.tw/information/Query/UserangeList/';
const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'ranges');
const CONCURRENCY = 8;

const decodeHtml = (value) =>
  String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

const cleanText = (html) =>
  decodeHtml(
    String(html ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

const contentKey = (value) =>
  [...String(value ?? '').replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)]
    .map((match) => String(Number(match[0])))
    .join('|');

const parseUnitHeader = (html) => {
  const raw = cleanText(html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
  const formMatch = raw.match(/\(([A-Za-z0-9+\s-]+)\)/);
  if (!formMatch) return null;

  const form = formMatch[1].replace(/\s+/g, '').toUpperCase();
  const afterForm = raw.slice((formMatch.index || 0) + formMatch[0].length).split(/(?:有|無)該劑型含量之許可證/)[0].trim();
  return { form, content: afterForm, contentKey: contentKey(afterForm) };
};

const RANGE_FIELDS = [
  '作物名稱',
  '病蟲害名稱',
  '每公頃使用用藥量',
  '稀釋倍數',
  '使用時期',
  '施藥間隔',
  '施用次數',
  '安全採收期',
  '施藥方法',
  '注意事項',
  '備註',
  '核准日期',
  '原始登記廠商名稱',
];

const parseRows = (html) => {
  const tbody = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || '';
  const rows = [];
  for (const rowMatch of tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((match) => cleanText(match[1]));
    if (cells.length < RANGE_FIELDS.length || !cells[0]) continue;
    rows.push(Object.fromEntries(RANGE_FIELDS.map((field, index) => [field, cells[index] || ''])));
  }
  return rows;
};

export function parseUseRangePage(html) {
  const chunks = String(html ?? '').split(/<div\s+class="unit-info-block">/i).slice(1);
  const units = [];
  for (const chunk of chunks) {
    const unitHtml = chunk.split(/<div\s+id="listDataContainer"/i)[0];
    const header = parseUnitHeader(unitHtml);
    const ranges = parseRows(unitHtml);
    if (!header || !ranges.length) continue;
    units.push({ ...header, ranges });
  }
  return units;
}

const getText = async (url, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'text/html,application/json' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
};

const fetchCode = async (code) => {
  const url = new URL(RANGE_API);
  for (const [key, value] of Object.entries({ cidecd: '', compno: '', pescnt: '', pestcd: code, regtid: '', regtno: '' })) {
    url.searchParams.set(key, value);
  }
  return parseUseRangePage(await getText(url));
};

async function main() {
  const requested = process.argv.slice(2).map((value) => value.trim().toUpperCase()).filter(Boolean);
  const rows = JSON.parse(await getText(MAIN_API));
  const allCodes = [...new Set(rows.map((row) => String(row['農藥代號'] || '').trim().toUpperCase()).filter(Boolean))].sort();
  const codes = requested.length ? allCodes.filter((code) => requested.includes(code)) : allCodes;
  if (!codes.length) throw new Error('找不到要更新的農藥代號');

  const catalog = new Map();
  const failures = [];
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < codes.length) {
      const code = codes[next++];
      try {
        const units = await fetchCode(code);
        if (units.length) catalog.set(code, units);
      } catch (error) {
        failures.push({ code, error: error.message });
      }
      done += 1;
      if (done % 25 === 0 || done === codes.length) process.stdout.write(`\r已讀取 ${done}/${codes.length} 個農藥代號`);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, codes.length) }, worker));
  process.stdout.write('\n');
  if (failures.length) throw new Error(`有 ${failures.length} 個代號讀取失敗：${failures.slice(0, 8).map((item) => item.code).join('、')}`);

  const shards = new Map();
  for (const [code, units] of catalog) {
    const shard = code.slice(0, 2).replace(/[^A-Z0-9]/g, '_') || 'other';
    if (!shards.has(shard)) shards.set(shard, {});
    shards.get(shard)[code] = units;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  for (const [shard, items] of shards) {
    const output = {
      _meta: { generatedAt, source: RANGE_API, shard },
      items: Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b))),
    };
    await writeFile(path.join(OUTPUT_DIR, `${shard}.json`), `${JSON.stringify(output)}\n`, 'utf8');
  }

  console.log(`完成：${catalog.size}/${codes.length} 個代號有使用範圍，輸出 ${shards.size} 個分片。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
