// Acceso a Firestore (sólo en modo firebase). En modo local todas las funciones devuelven undefined
// y los módulos de datos usan IndexedDB.
import { FIREBASE_VERSION } from '../config.js';

let fsP = null;

function cloud(auth) {
  if (auth.user?.isGuest || auth.user?.provider === 'guest') return null;
  if (auth.mode !== 'firebase' || !auth.fb) return null;
  return (fsP ??= import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
    .then((F) => ({ F, db: F.getFirestore(auth.fb.app) })));
}

export async function cloudGet(auth, col, id) {
  const c = await cloud(auth);
  if (!c) return undefined;
  const snap = await c.F.getDoc(c.F.doc(c.db, col, id));
  return snap.exists() ? snap.data() : null;
}

export async function cloudSet(auth, col, id, data) {
  const c = await cloud(auth);
  if (!c) return;
  await c.F.setDoc(c.F.doc(c.db, col, id), data, { merge: true });
}

export async function cloudRecent(auth, col, field, limit = 50) {
  const c = await cloud(auth);
  if (!c) return undefined;
  const snap = await c.F.getDocs(c.F.query(c.F.collection(c.db, col), c.F.orderBy(field, 'desc'), c.F.limit(limit)));
  return snap.docs.map((d) => d.data());
}

export async function cloudDelete(auth, col, id) {
  const c = await cloud(auth);
  if (!c) return;
  await c.F.deleteDoc(c.F.doc(c.db, col, id));
}

export async function cloudWhere(auth, col, field, value) {
  const c = await cloud(auth);
  if (!c) return undefined;
  const snap = await c.F.getDocs(c.F.query(c.F.collection(c.db, col), c.F.where(field, '==', value)));
  return snap.docs.map((d) => d.data());
}
