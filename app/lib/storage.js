'use client';

const DB_NAME = 'aircard-studio-v2';
const DB_VERSION = 1;
const STORES = ['kv', 'favorites', 'projects', 'imports', 'exports'];
const ART_CACHE = 'card-studio-art-v3';
const ART_CACHE_LIMIT = 180;

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
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
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
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
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
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
