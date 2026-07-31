const DB_NAME = 'tonext-business-suite-mvp95';
const DB_VERSION = 1;

const STORES = [
  'meta',
  'company',
  'customers',
  'items',
  'repairParts',
  'projectQuotes',
  'repairQuotes',
  'users',
  'outbox',
  'syncLog'
];

let dbPromise;

export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;

        if (name === 'meta' || name === 'company') {
          db.createObjectStore(name, { keyPath: 'key' });
        } else if (name === 'outbox') {
          const store = db.createObjectStore(name, { keyPath: 'operationId' });
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('entityId', 'entityId');
        } else if (name === 'syncLog') {
          db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        } else {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Offline database upgrade is blocked by another open app window.'));
  });

  return dbPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function put(storeName, value) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
  return value;
}

export async function bulkPut(storeName, values) {
  if (!Array.isArray(values) || values.length === 0) return;
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  values.forEach(value => store.put(value));
  await transactionDone(transaction);
}

export async function get(storeName, key) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

export async function getAll(storeName) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

export async function remove(storeName, key) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

export async function clear(storeName) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).clear();
  await transactionDone(transaction);
}

export async function count(storeName) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).count());
}

export async function setMeta(key, value) {
  return put('meta', { key, value });
}

export async function getMeta(key, fallback = null) {
  const record = await get('meta', key);
  return record ? record.value : fallback;
}

export async function setCompany(settings) {
  const entries = Object.entries(settings || {}).map(([key, value]) => ({ key, value }));
  await bulkPut('company', entries);
}

export async function getCompany() {
  const records = await getAll('company');
  return Object.fromEntries(records.map(record => [record.key, record.value]));
}

export async function enqueue(operation) {
  const record = {
    operationId: operation.operationId || uuid(),
    createdAt: operation.createdAt || new Date().toISOString(),
    attempts: Number(operation.attempts || 0),
    ...operation
  };
  await put('outbox', record);
  return record;
}

export async function listOutbox(limit = 50) {
  const rows = await getAll('outbox');
  return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, limit);
}

export async function pendingEntityIds() {
  const rows = await getAll('outbox');
  return new Set(rows.map(row => row.entityId).filter(Boolean));
}

export async function logSync(message, level = 'info') {
  await put('syncLog', {
    timestamp: new Date().toISOString(),
    message: String(message),
    level
  });
}

export async function getSyncLog(limit = 100) {
  const rows = await getAll('syncLog');
  return rows.sort((a, b) => Number(b.id || 0) - Number(a.id || 0)).slice(0, limit);
}

export async function clearBusinessData() {
  for (const store of ['company', 'customers', 'items', 'repairParts', 'projectQuotes', 'repairQuotes', 'users']) {
    await clear(store);
  }
}

export async function sanitizeRestrictedData(role) {
  if (role === 'Administrator') return;

  const items = await getAll('items');
  await bulkPut('items', items.map(item => ({ ...item, dealerPrice: null, materialProfit: null })));

  const parts = await getAll('repairParts');
  await bulkPut('repairParts', parts.map(part => ({ ...part, dealerPrice: null })));

  const projects = await getAll('projectQuotes');
  await bulkPut('projectQuotes', projects.map(quote => ({
    ...quote,
    materialDealerCost: null,
    materialProfit: null,
    totalProfit: null,
    lineItems: (quote.lineItems || []).map(line => ({ ...line, dealerPrice: null, lineDealerTotal: null }))
  })));
}

export function uuid(prefix = '') {
  const value = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return prefix ? `${prefix}-${value}` : value;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Database transaction aborted.'));
  });
}
