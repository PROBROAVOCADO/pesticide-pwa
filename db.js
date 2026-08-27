/**
 * 本機資料層（IndexedDB）。
 *
 * 所有使用者資料只存在自己的裝置，沒有後台、沒有帳號。
 *
 * 四個資料表：
 *   fields        土地：名稱、面積、單位、主要作物
 *   applications  施作事件：日期、土地與官方標示的「當下快照」、實際用量
 *   drugCache     查過的藥劑與使用範圍，離線時可翻查
 *   meta          設定與資料版本
 *
 * applications 刻意存快照而不是參照 fields 或即時抓官方資料：
 * 農藥登記會被撤銷、標示會改、土地面積可能重新丈量，
 * 但「那天實際做了什麼」是不變的事實，不能被日後的異動改寫。
 *
 * DB_NAME 一旦上線就不要改 —— 改了等於使用者的資料全部消失。
 */

const DB_NAME = 'field-meds-pwa';
const DB_VERSION = 1;

export const STORE = {
  fields: 'fields',
  applications: 'applications',
  drugCache: 'drugCache',
  meta: 'meta',
};

/** IndexedDB 不可用時（Safari 無痕、瀏覽器設定）為 false，App 仍可查藥與試算，只是不能保存。 */
export let dbAvailable = true;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      dbAvailable = false;
      reject(new Error('這個瀏覽器不支援本機資料庫'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE.fields)) {
        db.createObjectStore(STORE.fields, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE.applications)) {
        const apps = db.createObjectStore(STORE.applications, { keyPath: 'id' });
        apps.createIndex('byDate', 'date');
        apps.createIndex('byField', 'fieldId');
      }

      if (!db.objectStoreNames.contains(STORE.drugCache)) {
        db.createObjectStore(STORE.drugCache, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORE.meta)) {
        db.createObjectStore(STORE.meta, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbAvailable = false;
      reject(request.error || new Error('無法開啟本機資料庫'));
    };
  });

  return dbPromise;
}

function run(storeName, mode, action) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = action(transaction.objectStore(storeName));
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        if (request) {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        } else {
          transaction.oncomplete = () => resolve();
        }
      }),
  );
}

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const remove = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const clear = (store) => run(store, 'readwrite', (s) => s.clear());

/** 產生一個不會撞號的識別碼。舊瀏覽器沒有 randomUUID 時退回時間加亂數。 */
export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/* 土地                                                                */
/* ------------------------------------------------------------------ */

export const listFields = () =>
  getAll(STORE.fields).then((rows) => rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));

export function saveField(field) {
  const now = Date.now();
  const record = {
    id: field.id || newId(),
    name: String(field.name || '').trim(),
    area: String(field.area || '').trim(),
    unit: field.unit || 'fen',
    crop: String(field.crop || '').trim(),
    createdAt: field.createdAt || now,
    updatedAt: now,
  };
  return put(STORE.fields, record).then(() => record);
}

export const deleteField = (id) => remove(STORE.fields, id);

/* ------------------------------------------------------------------ */
/* 施作紀錄                                                            */
/* ------------------------------------------------------------------ */

/** 依日期新到舊排序，同一天以建立時間新到舊。 */
export const listApplications = () =>
  getAll(STORE.applications).then((rows) =>
    rows.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date))),
  );

export function saveApplication(app) {
  const now = Date.now();
  const record = { ...app, id: app.id || newId(), createdAt: app.createdAt || now, updatedAt: now };
  return put(STORE.applications, record).then(() => record);
}

export const deleteApplication = (id) => remove(STORE.applications, id);

/* ------------------------------------------------------------------ */
/* 藥劑快取（離線查詢）                                                */
/* ------------------------------------------------------------------ */

/** 查詢成功時把藥劑存起來，田裡沒訊號時還翻得到查過的藥。 */
export function cacheDrugs(drugs) {
  if (!drugs.length) return Promise.resolve();
  return openDb()
    .then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE.drugCache, 'readwrite');
          const store = transaction.objectStore(STORE.drugCache);
          for (const drug of drugs) {
            const key = `${String(drug['許可證字'] ?? '').trim()}${String(drug['許可證號'] ?? '').trim()}`;
            if (!key) continue;
            // 只覆寫藥劑本身，保留先前抓過的使用範圍。
            const existing = store.get(key);
            existing.onsuccess = () => {
              store.put({ key, drug, ranges: existing.result?.ranges ?? null, fetchedAt: Date.now() });
            };
          }
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        }),
    )
    .catch(() => {});
}

export function cacheRanges(key, ranges) {
  if (!key) return Promise.resolve();
  return get(STORE.drugCache, key)
    .then((existing) =>
      put(STORE.drugCache, { key, drug: existing?.drug ?? null, ranges, fetchedAt: Date.now() }),
    )
    .catch(() => {});
}

export const getCached = (key) => get(STORE.drugCache, key).catch(() => null);

/** 離線時的替代查詢：掃過所有快取的藥劑，比對普通名稱、廠牌與代號。 */
export function searchCachedDrugs(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return Promise.resolve([]);

  return getAll(STORE.drugCache)
    .then((rows) =>
      rows
        .map((row) => row.drug)
        .filter(Boolean)
        .filter((drug) =>
          ['中文名稱', '廠牌名稱', '農藥代號'].some((field) =>
            String(drug[field] ?? '').toLowerCase().includes(q),
          ),
        )
        .slice(0, 80),
    )
    .catch(() => []);
}

/* ------------------------------------------------------------------ */
/* 持久儲存                                                            */
/* ------------------------------------------------------------------ */

/**
 * 向瀏覽器申請「持久儲存」，降低手機空間不足時資料被自動清除的機率。
 * 批不批准由瀏覽器決定，我們只能請求，不能保證。
 */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return { supported: false, persisted: false };
    const already = await navigator.storage.persisted();
    const persisted = already || (await navigator.storage.persist());
    return { supported: true, persisted };
  } catch {
    return { supported: false, persisted: false };
  }
}

export async function storageEstimate() {
  try {
    if (!navigator.storage?.estimate) return null;
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 備份                                                                */
/* ------------------------------------------------------------------ */

export const BACKUP_FORMAT = 'field-meds-backup';
export const BACKUP_VERSION = 1;

/** 匯出土地與施作紀錄。藥劑快取不匯出 —— 那是可以重新抓回來的資料。 */
export async function exportBackup() {
  const [fields, applications] = await Promise.all([listFields(), listApplications()]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    fields,
    applications,
  };
}

/**
 * 匯入備份。採「合併」而非「取代」：相同 id 會被覆寫，本機多出來的資料保留。
 * 這樣兩台手機互相匯入不會把對方的紀錄弄不見。
 */
export async function importBackup(data) {
  if (!data || data.format !== BACKUP_FORMAT) {
    throw new Error('這不是「田間用藥」的備份檔');
  }
  if (!Array.isArray(data.fields) || !Array.isArray(data.applications)) {
    throw new Error('備份檔的內容不完整');
  }

  let fields = 0;
  let applications = 0;

  for (const field of data.fields) {
    if (!field?.id) continue;
    await put(STORE.fields, field);
    fields += 1;
  }

  for (const app of data.applications) {
    if (!app?.id) continue;
    await put(STORE.applications, app);
    applications += 1;
  }

  return { fields, applications };
}
