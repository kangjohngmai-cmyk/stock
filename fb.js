// Firebase 연결 래퍼 — 화면 코드는 이 파일의 함수만 사용
import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, onValue, onChildAdded, push, update, set, get, remove, query, limitToLast, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

let app, auth, db;
function init() {
  if (app) return;
  if (!firebaseConfig || !firebaseConfig.databaseURL || String(firebaseConfig.apiKey).includes('여기에')) {
    throw new Error('config.js에 Firebase 설정값을 아직 안 넣었어 (databaseURL 포함)');
  }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
}

export const fb = {
  init,
  onUser(cb) { init(); return onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email, anon: u.isAnonymous } : null)); },
  async anon() { init(); const c = await signInAnonymously(auth); return c.user.uid; },
  async login(email, pw) { init(); const c = await signInWithEmailAndPassword(auth, email, pw); return c.user.uid; },
  async logout() { init(); await signOut(auth); },
  on(path, cb, onErr) { init(); return onValue(ref(db, path), s => cb(s.val()), e => { console.error(path, e); onErr && onErr(e); }); },
  onAdded(path, n, cb, onErr) {
    init();
    const r = n ? query(ref(db, path), limitToLast(n)) : ref(db, path);
    return onChildAdded(r, s => cb(s.key, s.val()), e => { console.error(path, e); onErr && onErr(e); });
  },
  push(path, val) { init(); return push(ref(db, path), val); },
  newKey(path) { init(); return push(ref(db, path)).key; },
  update(updates) { init(); return update(ref(db), updates); },
  set(path, val) { init(); return set(ref(db, path), val); },
  async get(path) { init(); return (await get(ref(db, path))).val(); },
  remove(path) { init(); return remove(ref(db, path)); },
  offset(cb) { init(); return onValue(ref(db, '.info/serverTimeOffset'), s => cb(s.val() || 0)); },
  connected(cb) { init(); return onValue(ref(db, '.info/connected'), s => cb(!!s.val())); },
  TS: () => serverTimestamp(),
};
