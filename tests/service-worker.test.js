import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const scope = 'https://example.test/pwa/';

function setup(cache, fetch) {
  const listeners = new Map();
  const activated = [];
  runInNewContext(source, {
    Request, Response, URL, fetch,
    caches: { open: async () => cache },
    self: {
      registration: { scope },
      location: new URL(scope),
      addEventListener: (type, callback) => listeners.set(type, callback),
      skipWaiting: async () => activated.push(true),
    },
  });
  return { listeners, activated };
}

test('更新重新下載所有核心檔，下載失敗時不切換新版', async () => {
  let installation;
  let requests;
  const cache = { addAll: async (entries) => {
    requests = entries;
    throw new Error('下載失敗');
  } };
  const { listeners, activated } = setup(cache);
  listeners.get('install')({ waitUntil: (task) => { installation = task; } });
  await assert.rejects(installation, /下載失敗/);
  assert.ok(requests.some((request) => request.url === scope + 'assets/js/app.js'));
  assert.ok(requests.every((request) => request.cache === 'reload'));
  assert.equal(activated.length, 0);

  cache.addAll = async () => {};
  listeners.get('install')({ waitUntil: (task) => { installation = task; } });
  await installation;
  assert.equal(activated.length, 1);
});

test('核心檔案使用同一版快取，離線導覽可回到已下載的入口', async () => {
  const cache = { match: async (request) => (request.url ?? request) === scope ? new Response('新版首頁') : undefined };
  let fetches = 0;
  const { listeners } = setup(cache, async () => {
    fetches += 1;
    throw new Error('offline');
  });
  function navigate(url) {
    let response;
    listeners.get('fetch')({
      request: { url, method: 'GET', mode: 'navigate' },
      respondWith: (task) => { response = task; },
    });
    return response;
  }
  assert.equal(await (await navigate(scope)).text(), '新版首頁');
  assert.equal(fetches, 0);
  assert.equal(await (await navigate(scope + '?from=home')).text(), '新版首頁');
  assert.equal(fetches, 1);
});
