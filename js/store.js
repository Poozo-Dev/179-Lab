// store.js — IndexedDB persistence. One experiment at a time.
//   meta   : key 'session'  -> session object (settings, status, stats)
//   frames : {index, targetMs, actualMs, deviationMs, gapMs, duplicate, suspect, width, height, thumb:ArrayBuffer}
//   images : {index, data:ArrayBuffer}   (full-size JPEG; kept apart so listing the gallery loads thumbnails only)
//   meta   : key 'marks' -> measured points, key 'setup' -> masses / calibration / vertical
// Images are stored as ArrayBuffer rather than Blob: older Safari versions had bugs with Blobs in IndexedDB.

const DB_NAME = 'physlab', DB_VERSION = 1;
let dbPromise = null;

export class StorageError extends Error {
  constructor(full, cause) {
    super(full
      ? 'The phone is out of storage space. Free some space (delete photos/apps), then record again.'
      : 'The phone could not save the images (browser storage problem). Do not use private browsing mode.');
    this.full = full; this.cause = cause;
  }
}
const wrap = (e) => new StorageError(!!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'), e);

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new StorageError(false));
      const rq = indexedDB.open(DB_NAME, DB_VERSION);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        db.createObjectStore('meta');
        db.createObjectStore('frames', { keyPath: 'index' });
        db.createObjectStore('images', { keyPath: 'index' });
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(wrap(rq.error));
    }).catch((e) => { dbPromise = null; throw e instanceof StorageError ? e : wrap(e); });
  }
  return dbPromise;
}

// Run `fn(tx)` in one transaction; resolve (with fn's request result, if it returns one) when the
// transaction has COMMITTED, so "saved" really means saved.
async function run(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let tx, out;
    try { tx = db.transaction(stores, mode); } catch (e) { return reject(wrap(e)); }
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    tx.onerror = () => reject(wrap(tx.error));
    tx.onabort = () => reject(wrap(tx.error));
    try { out = fn(tx); } catch (e) { try { tx.abort(); } catch (_) {} reject(wrap(e)); }
  });
}

export const getSession = () => run('meta', 'readonly', (tx) => tx.objectStore('meta').get('session'));
export const setSession = (s) => run('meta', 'readwrite', (tx) => { tx.objectStore('meta').put(s, 'session'); });
// Measurement setup of the experiment: { masses: {a, b}, cal: {...}, vert: {...} } (see measure.js). Kept in 'meta'.
export const getSetup = () => run('meta', 'readonly', (tx) => tx.objectStore('meta').get('setup')).then((s) => s || {});
export const setSetup = (s) => run('meta', 'readwrite', (tx) => { tx.objectStore('meta').put(s, 'setup'); });
// Manually placed points: { [frameIndex]: {a?: {x, y}, b?: {x, y}} } in pixels of the saved image (older
// versions stored a single {x, y}; measure.normalizeMarks reads both). Kept in 'meta'.
export const getMarks = () => run('meta', 'readonly', (tx) => tx.objectStore('meta').get('marks')).then((m) => m || {});
export const setMarks = (m) => run('meta', 'readwrite', (tx) => { tx.objectStore('meta').put(m, 'marks'); });
export const listFrames = () => run('frames', 'readonly', (tx) => tx.objectStore('frames').getAll());
export const getImage = (index) => run('images', 'readonly', (tx) => tx.objectStore('images').get(index));
export const putFrame = (frameRec, imageRec) => run(['frames', 'images'], 'readwrite', (tx) => {
  tx.objectStore('frames').put(frameRec);
  tx.objectStore('images').put(imageRec);
});
export const deleteFrame = (index) => run(['frames', 'images'], 'readwrite', (tx) => {
  tx.objectStore('frames').delete(index); tx.objectStore('images').delete(index);
});
export const clearAll = () => run(['meta', 'frames', 'images'], 'readwrite', (tx) => {
  tx.objectStore('meta').clear(); tx.objectStore('frames').clear(); tx.objectStore('images').clear();
});
export const probe = () => openDb().then(() => true);

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
}
export async function freeBytes() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { quota, usage } = await navigator.storage.estimate();
      if (quota) return quota - (usage || 0);
    }
  } catch (_) {}
  return null;
}
