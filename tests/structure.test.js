import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { it } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFile(new URL(name, root), 'utf8');
const exists = (url) => fs.access(url);

it('分類後入口、安裝圖示、模組引用及離線快取中的檔案全部存在', async () => {
  const html = await read('index.html');
  for (const match of html.matchAll(/(?:href|src)="(\.\/[^"?#]+)"/g)) await exists(new URL(match[1], root));
  const manifest = JSON.parse(await read('manifest.json'));
  for (const icon of manifest.icons) await exists(new URL(icon.src, root));
  const sw = await read('sw.js');
  const core = [...sw.split('const CORE = [')[1].split('];')[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const resource of core) await exists(new URL(resource, root));
  for (const name of await fs.readdir(new URL('assets/js/', root))) {
    assert.ok(core.includes(`./assets/js/${name}`), `離線快取缺少 ${name}`);
    const url = new URL(`assets/js/${name}`, root);
    const source = await fs.readFile(url, 'utf8');
    for (const match of source.matchAll(/from '(\.[^']+)'/g)) await exists(new URL(match[1], url));
  }
  const app = await read('assets/js/app.js');
  assert.ok(app.includes("register(new URL('../../sw.js', import.meta.url))"));
  assert.ok(app.includes("const VERSION = 'v1.6.6'"));
  assert.ok(html.includes('>v1.6.6</button>'));
  assert.ok(sw.includes('field-meds-pwa-v1.6.6-r1'));
  const catalog = await read('assets/js/range-catalog.js');
  assert.ok(catalog.includes('../../data/ranges/'));
});
