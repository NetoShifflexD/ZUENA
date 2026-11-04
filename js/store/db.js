// Persistencia local en IndexedDB.
// tracks/analysis: biblioteca del equipo · accounts/profiles: cuentas locales y perfiles
// playlists: listas por usuario · claims/releases: reclamos de artista y lanzamientos
// catalog: contenido externo guardado (canciones, episodios, radios) · posts: feed · kv: ajustes sueltos
const DB_NAME = 'zuena';
const VERSION = 2;
let dbp = null;

function open() {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore('tracks', { keyPath: 'id' });
        db.createObjectStore('analysis', { keyPath: 'id' });
        db.createObjectStore('kv');
        db.createObjectStore('accounts', { keyPath: 'uid' }).createIndex('email', 'email', { unique: true });
        db.createObjectStore('profiles', { keyPath: 'uid' }).createIndex('username', 'username', { unique: false });
        db.createObjectStore('playlists', { keyPath: 'id' }).createIndex('owner', 'owner', { unique: false });
        db.createObjectStore('claims', { keyPath: 'uid' }).createIndex('status', 'status', { unique: false });
        db.createObjectStore('releases', { keyPath: 'id' }).createIndex('uid', 'uid', { unique: false });
      }
      if (e.oldVersion < 2) {
        db.createObjectStore('catalog', { keyPath: 'id' });
        db.createObjectStore('posts', { keyPath: 'id' }).createIndex('uid', 'uid', { unique: false });
      }
    };
    let notice = null;
    req.onsuccess = () => {
      notice?.remove();
      const db = req.result;
      // si otra pestaña trae una versión nueva, ésta se cierra y recarga para no bloquearla
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // otra pestaña con una versión vieja tiene la base abierta: se espera (no es un error)
    req.onblocked = () => {
      notice = document.createElement('div');
      notice.className = 'db-blocked glass';
      notice.textContent = 'Actualizando ZUENA… cerrá las otras pestañas de la app para continuar.';
      document.body.appendChild(notice);
    };
  }));
}

function run(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const db = {
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
  put: (store, value) => run(store, 'readwrite', (s) => s.put(value)),
  del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  all: (store) => run(store, 'readonly', (s) => s.getAll()),
  byIndex: (store, index, value) => run(store, 'readonly', (s) => s.index(index).getAll(value)),
  clear: (store) => run(store, 'readwrite', (s) => s.clear()),
  kvGet: (key) => run('kv', 'readonly', (s) => s.get(key)),
  kvSet: (key, value) => run('kv', 'readwrite', (s) => s.put(value, key)),
  kvDel: (key) => run('kv', 'readwrite', (s) => s.delete(key)),
};
