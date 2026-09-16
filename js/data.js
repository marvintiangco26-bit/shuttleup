// ============================================================
// ShuttleUp — data layer (Firebase Auth + Cloud Firestore)
// Requires the config in js/config.js.
//
// Only the tournament manager has an account. Players never sign in —
// the manager registers them, and anyone with the shared link can
// watch the tournament live (read-only).
//
// Data shape:
//   users/{uid}                            { name, email, createdAt }
//   users/{uid}/players/{pid}              { name, rating, yearsIdx, createdAt }
//                                          (the manager's reusable player roster)
//   tournaments/{tid}                      { name, organizerId, settings, status,
//                                            gen, createdAt, updatedAt }
//   tournaments/{tid}/registrations/{rid}  { mode, name/p1/p2/teamName, rating,
//                                            yearsIdx, addedBy, createdAt }
// ============================================================

let M = null; // { app, auth, db, fsM }

export async function init(config) {
  if (M) return M;
  // Test hook: allow a mock of the SDK modules (used by the DOM test).
  if (window.__FIREBASE_MODULES__) { M = window.__FIREBASE_MODULES__; return M; }
  if (!config || !config.apiKey || String(config.apiKey).toUpperCase().includes('PASTE')) {
    throw new Error('NO_CONFIG');
  }
  const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';
  const [appM, authM, fsM] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  let app;
  try { app = appM.getApp(); } catch { app = appM.initializeApp(config); }
  M = { app, appM, authM, fsM, auth: authM.getAuth(app), db: fsM.getFirestore(app) };
  return M;
}

export function isConfigured() {
  const c = window.FIREBASE_CONFIG;
  return !!(c && c.apiKey && c.projectId && !String(c.apiKey).toUpperCase().includes('PASTE'));
}

// ---------------- Auth (managers only) ----------------

export function onAuthChange(cb, errCb) {
  return init().then(() => M.authM.onAuthStateChanged(M.auth, cb, errCb));
}

export async function signUp(name, email, pass) {
  await init();
  const cred = await M.authM.createUserWithEmailAndPassword(M.auth, email, pass);
  try { await M.authM.updateProfile(cred.user, { displayName: name }); } catch { /* optional */ }
  const ref = M.fsM.doc(M.db, 'users', cred.user.uid);
  const snap = await M.fsM.getDoc(ref);
  if (!snap.exists()) {
    M.fsM.setDoc(ref, { name, email, createdAt: M.fsM.serverTimestamp() }).catch(() => { });
  }
  return cred.user;
}

export async function signIn(email, pass) {
  await init();
  return M.authM.signInWithEmailAndPassword(M.auth, email, pass);
}

export function signOut() {
  return init().then(() => M.authM.signOut(M.auth));
}

// ---------------- Tournaments ----------------

function tRef(tid) { return M.fsM.doc(M.db, 'tournaments', tid); }
function rColl(tid) { return M.fsM.collection(M.db, 'tournaments', tid, 'registrations'); }

export function onTournament(tid, cb, errCb) {
  return init().then(() => M.fsM.onSnapshot(tRef(tid),
    s => cb(s.exists() ? { id: s.id, ...s.data() } : null), errCb));
}

export async function createTournament(uid, userName, name, settings) {
  await init();
  const ref = M.fsM.doc(M.fsM.collection(M.db, 'tournaments'));
  await M.fsM.setDoc(ref, {
    name,
    organizerId: uid,
    organizerName: userName,
    settings,
    status: 'planning',
    gen: null,
    createdAt: M.fsM.serverTimestamp(),
    updatedAt: M.fsM.serverTimestamp(),
  });
  return ref.id;
}

export async function patchTournament(tid, patch) {
  await init();
  await M.fsM.updateDoc(tRef(tid), { ...patch, updatedAt: M.fsM.serverTimestamp() });
}

export async function deleteTournament(tid) {
  await init();
  await M.fsM.deleteDoc(tRef(tid));
}

// "My tournaments" = the ones I organize (players have no accounts).
export function onMyOrganized(uid, cb) {
  return init().then(() => {
    const u1 = M.fsM.onSnapshot(
      M.fsM.query(M.fsM.collection(M.db, 'tournaments'), M.fsM.where('organizerId', '==', uid)),
      s => cb(s.docs.map(d => ({ id: d.id, ...d.data(), _organizer: true }))
        .sort((a, b) => ts(b) - ts(a))));
    return () => u1();
  });
}
const ts = t => (t && t.updatedAt ? (t.updatedAt.toMillis ? t.updatedAt.toMillis() : t.updatedAt) : 0);

// ---------------- Player roster (per manager) ----------------

function pColl(uid) { return M.fsM.collection(M.db, 'users', uid, 'players'); }

export function onPlayers(uid, cb, errCb) {
  return init().then(() => {
    const un = M.fsM.onSnapshot(pColl(uid),
      s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))), errCb);
    return un;
  });
}

// Returns the roster doc for this name (case-insensitive), creating it if new.
export async function findOrCreatePlayer(uid, { name, rating = null, yearsIdx = null }) {
  await init();
  const nm = String(name || '').trim();
  if (!nm) return null;
  const snap = await M.fsM.getDocs(pColl(uid));
  const key = nm.toLowerCase();
  let found = null;
  snap.forEach(d => {
    if (String(d.data().name || '').trim().toLowerCase() === key) found = { id: d.id, ...d.data() };
  });
  if (found) return found;
  const ref = M.fsM.doc(pColl(uid));
  await M.fsM.setDoc(ref, { name: nm, rating, yearsIdx, createdAt: M.fsM.serverTimestamp() });
  return { id: ref.id, name: nm, rating, yearsIdx };
}

export async function removePlayer(uid, pid) {
  await init();
  await M.fsM.deleteDoc(M.fsM.doc(M.db, 'users', uid, 'players', pid));
}

// ---------------- Registrations ----------------

export function onRegistrations(tid, cb, errCb) {
  return init().then(() => M.fsM.onSnapshot(rColl(tid),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), errCb));
}

export async function addRegistration(tid, data) {
  await init();
  const ref = await M.fsM.addDoc(rColl(tid), { ...data, createdAt: M.fsM.serverTimestamp() });
  return ref.id;
}

export async function updateRegistration(tid, rid, patch) {
  await init();
  await M.fsM.updateDoc(M.fsM.doc(M.db, 'tournaments', tid, 'registrations', rid), patch);
}

export async function removeRegistration(tid, rid) {
  await init();
  await M.fsM.deleteDoc(M.fsM.doc(M.db, 'tournaments', tid, 'registrations', rid));
}
