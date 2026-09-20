'use client';

const DB_NAME = 'aircard-studio-v2';
const DB_VERSION = 2;
const STORES = ['kv', 'favorites', 'projects', 'imports', 'importMeta', 'exports'];

function importMetadata(value = {}) {
  const id =
    typeof value.id === 'string' || typeof value.id === 'number'
      ? String(value.id).slice(0, 160)
      : '';
  const name =
    typeof value.name === 'string' || typeof value.name === 'number'
      ? String(value.name).trim().slice(0, 160)
      : '';
  const type =
    typeof value.type === 'string' || typeof value.type === 'number'
      ? String(value.type).trim().slice(0, 80)
      : '';

  return {
    id,
    name: name || 'Imported image',
    type: type || 'image/*',
    createdAt: Number(value.createdAt || Date.now())
  };
}
const ART_CACHE = 'card-studio-art-v4';
const ART_CACHE_LIMIT = 40;
const THUMB_CACHE = 'card-studio-thumb-v1';
const THUMB_CACHE_LIMIT = 160;
const CACHE_ARTWORK_TIMEOUT_MS = 12000;

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
    const importKeysRequest = tx.objectStore('imports').getAllKeys();
    const metaRequest = tx.objectStore('importMeta').getAll();
    let importKeys = [];
    let metadata = [];

    importKeysRequest.onsuccess = () => {
      importKeys = Array.isArray(importKeysRequest.result)
        ? importKeysRequest.result.map((key) => String(key))
        : [];
    };
    metaRequest.onsuccess = () => {
      metadata = Array.isArray(metaRequest.result) ? metaRequest.result : [];
    };
    tx.oncomplete = () => resolve({ importKeys, metadata });
    tx.onerror = () => reject(tx.error || new Error('IndexedDB import metadata read failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB import metadata read aborted'));
  });

  const importIds = new Set(snapshot.importKeys);
  const metadataIds = new Set(
    snapshot.metadata
      .map((entry) => String(entry?.id || ''))
      .filter(Boolean)
  );
  const metadataMatchesImports =
    importIds.size === metadataIds.size &&
    [...importIds].every((id) => metadataIds.has(id));

  if (metadataMatchesImports) {
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
    let requestedWidth = 0;
    try {
      const parsed = new URL(url, window.location.origin);
      requestedWidth = Number(parsed.searchParams.get('w') || 0);
    } catch {}

    const isThumbnail = requestedWidth > 0 && requestedWidth <= 800;
    const cacheName = isThumbnail ? THUMB_CACHE : ART_CACHE;
    const cacheLimit = isThumbnail ? THUMB_CACHE_LIMIT : ART_CACHE_LIMIT;
    const cache = await caches.open(cacheName);
    const existing = await cache.match(url);
    if (existing) return true;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CACHE_ARTWORK_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        credentials: 'same-origin',
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timer);
    }

    if (!response.ok || !(response.headers.get('content-type') || '').startsWith('image/')) {
      return false;
    }
    await cache.put(url, response.clone());

    const keys = await cache.keys();
    const overflow = keys.length - cacheLimit;
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
  const text = String(dataUrl || '');
  const comma = text.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URL');

  const header = text.slice(0, comma);
  const type = header.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';

  if (!/;base64/i.test(header)) {
    return new Blob([decodeURIComponent(text.slice(comma + 1))], { type });
  }

  // Decode in base64-aligned chunks so large preset/image exports do not
  // allocate one huge binary string plus a second equally large Uint8Array.
  const chunks = [];
  const chunkChars = 32768; // multiple of 4
  for (let offset = comma + 1; offset < text.length; offset += chunkChars) {
    const encoded = text.slice(offset, Math.min(text.length, offset + chunkChars));
    const decoded = atob(encoded);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) {
      bytes[i] = decoded.charCodeAt(i);
    }
    chunks.push(bytes);
  }

  return new Blob(chunks, { type });
}

export function makeId(prefix = 'item') {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + '-' + random;
}
