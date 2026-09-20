'use client';

const DB_NAME = 'aircard-studio-v2';
const DB_VERSION = 2;
const STORES = ['kv', 'favorites', 'projects', 'imports', 'importMeta', 'exports'];

function importMetadata(value = {}) {
  return {
    id: value.id,
    name: value.name || 'Imported image',
    type: value.type || 'image/*',
    createdAt: Number(value.createdAt || Date.now())
  };
}
const ART_CACHE = 'card-studio-art-v4';
const ART_CACHE_LIMIT = 40;

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;

      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }

      // Version 2 separates lightweight import-list metadata from large image
      // blobs. Migrate existing imports once so Library hydration never needs
      // to deserialize every stored photo into React memory again.
      if (event.oldVersion < 2 && tx && db.objectStoreNames.contains('imports')) {
        const importsStore = tx.objectStore('imports');
        const metaStore = tx.objectStore('importMeta');
        const cursorRequest = importsStore.openCursor();

        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const value = cursor.value || {};
          if (value.id) metaStore.put(importMetadata(value));
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('IndexedDB unavailable'));
    };

    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB upgrade blocked'));
    };
  });

  return dbPromise;
}

export async function dbPut(store, value) {
  const db = await openDb();
  if (!db) return value;

  return new Promise((resolve, reject) => {
    const stores = store === 'imports' ? ['imports', 'importMeta'] : [store];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(store).put(value);

    if (store === 'imports' && value?.id) {
      tx.objectStore('importMeta').put(importMetadata(value));
    }

    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

export async function dbGet(store, id) {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
  });
}

export async function dbGetAll(store) {
  const db = await openDb();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error || new Error('IndexedDB list failed'));
  });
}

export async function dbDelete(store, id) {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const stores = store === 'imports' ? ['imports', 'importMeta'] : [store];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(store).delete(id);

    if (store === 'imports') {
      tx.objectStore('importMeta').delete(id);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
  });
}

export async function dbGetImportMetadata() {
  const db = await openDb();
  if (!db) return [];

  const snapshot = await new Promise((resolve, reject) => {
    const tx = db.transaction(['imports', 'importMeta'], 'readonly');
    const importsCountRequest = tx.objectStore('imports').count();
    const metaRequest = tx.objectStore('importMeta').getAll();
    let importCount = 0;
    let metadata = [];

    importsCountRequest.onsuccess = () => {
      importCount = Number(importsCountRequest.result || 0);
    };
    metaRequest.onsuccess = () => {
      metadata = Array.isArray(metaRequest.result) ? metaRequest.result : [];
    };
    tx.oncomplete = () => resolve({ importCount, metadata });
    tx.onerror = () => reject(tx.error || new Error('IndexedDB import metadata read failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB import metadata read aborted'));
  });

  if (snapshot.metadata.length === snapshot.importCount) {
    return snapshot.metadata;
  }

  // Self-heal metadata if an interrupted/older upgrade left it incomplete.
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['imports', 'importMeta'], 'readwrite');
    const importsStore = tx.objectStore('imports');
    const metaStore = tx.objectStore('importMeta');
    const items = [];
    const cursorRequest = importsStore.openCursor();

    metaStore.clear();

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const metadata = importMetadata(cursor.value || {});
      if (metadata.id) {
        items.push(metadata);
        metaStore.put(metadata);
      }
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error || new Error('IndexedDB import metadata rebuild failed'));
    tx.oncomplete = () => resolve(items);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB import metadata rebuild failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB import metadata rebuild aborted'));
  });
}

export async function cacheArtwork(url) {
  if (!url || typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(ART_CACHE);
    const existing = await cache.match(url);
    if (existing) return true;
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok || !(response.headers.get('content-type') || '').startsWith('image/')) {
      return false;
    }
    await cache.put(url, response.clone());

    const keys = await cache.keys();
    const overflow = keys.length - ART_CACHE_LIMIT;
    if (overflow > 0) {
      await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
    }

    return true;
  } catch {
    return false;
  }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl) {
  const [header, body] = String(dataUrl).split(',');
  const type = header.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
  const bytes = atob(body || '');
  const output = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) output[i] = bytes.charCodeAt(i);
  return new Blob([output], { type });
}

export function makeId(prefix = 'item') {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + '-' + random;
}
