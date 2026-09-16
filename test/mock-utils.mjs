// In-memory Firebase mock shared by DOM tests
export function makeFirebaseMock() {
  const docs = new Map();            // "a/b/c" -> data
  const docListeners = new Map();    // path -> Set<cb>
  const collListeners = new Map();   // collPath -> Set<cb>
  const queryListeners = new Map();  // queryId -> { cb:Set, query }
  const users = new Map();           // email -> user
  let currentAuth = null;
  const authListeners = new Set();
  let idc = 0;

  const seg = p => p.split('/').pop();

  const snapDoc = p => ({
    id: seg(p),
    exists: () => docs.has(p),
    data: () => ({ ...(docs.get(p) || {}) }),
  });
  const collDocs = collPath => {
    const prefix = collPath + '/';
    return [...docs.keys()]
      .filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map(k => ({ id: k.slice(prefix.length), data: () => ({ ...docs.get(k) }) }));
  };
  const fireDoc = p => (docListeners.get(p) || new Set()).forEach(cb => cb(snapDoc(p)));
  const fireColl = p => (collListeners.get(p) || new Set()).forEach(cb => cb({ docs: collDocs(p), forEach(fn) { collDocs(p).forEach(fn); } }));
  const qSnap = arr => ({ docs: arr, forEach(fn) { arr.forEach(fn); } });
  const fireQueries = collPath => {
    for (const [id, entry] of queryListeners) {
      if (entry.query.collPath === collPath) entry.cb.forEach(cb => cb(qSnap(evalQuery(entry.query))));
    }
  };
  const evalQuery = q => {
    return collDocs(q.collPath).filter(d => q.constraints.every(c => {
      const v = docs.get(q.collPath + '/' + d.id)[c.field];
      if (c.op === '==') return v === c.value;
      if (c.op === 'array-contains') return Array.isArray(v) && v.includes(c.value);
      return true;
    }));
  };

  const applyPatch = (data, patch) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && v.__fv && v.op === 'union') data[k] = [...new Set([...(data[k] || []), ...v.values])];
      else if (v && typeof v === 'object' && v.__fv && v.op === 'remove') data[k] = (data[k] || []).filter(x => !v.values.includes(x));
      else data[k] = v;
    }
  };

  const mkRef = p => ({ _path: p, get id() { return seg(p); } });
  const fsM = {
    doc: (db, ...segs) => {
      if (db && typeof db === 'object' && db._isColl) {
        return mkRef(db._path + '/t' + (++idc)); // doc(collectionRef) -> auto id
      }
      return mkRef(segs.join('/'));
    },
    collection: (_db, ...segs) => ({ _path: segs.join('/'), _isColl: true }),
    query: (coll, ...constraints) => ({ _isQuery: true, id: 'q' + (++idc), collPath: coll._path, constraints }),
    where: (field, op, value) => ({ field, op, value }),
    onSnapshot(target, cb, errCb) {
      let un;
      if (target._isQuery) {
        const entry = queryListeners.get(target.id) || { cb: new Set(), query: target };
        entry.cb.add(cb);
        queryListeners.set(target.id, entry);
        cb(qSnap(evalQuery(target)));
        un = () => entry.cb.delete(cb);
      } else if (target._isColl) {
        const set = collListeners.get(target._path) || new Set();
        set.add(cb);
        collListeners.set(target._path, set);
        cb({ docs: collDocs(target._path), forEach(fn) { collDocs(target._path).forEach(fn); } });
        un = () => set.delete(cb);
      } else {
        const set = docListeners.get(target._path) || new Set();
        set.add(cb);
        docListeners.set(target._path, set);
        cb(snapDoc(target._path));
        un = () => set.delete(cb);
      }
      return un;
    },
    async setDoc(ref, data) {
      const p = ref._path;
      docs.set(p, { ...data });
      fireDoc(p);
      const parent = p.slice(0, p.lastIndexOf('/'));
      if (parent) { fireColl(parent); fireQueries(parent); }
    },
    async getDoc(ref) { return snapDoc(ref._path); },
    async getDocs(target) {
      const ds = target._isQuery ? evalQuery(target) : collDocs(target._path);
      return { docs: ds, forEach(fn) { ds.forEach(fn); } };
    },
    async updateDoc(ref, patch) {
      const p = ref._path;
      const data = docs.get(p);
      if (!data) throw new Error('no such doc ' + p);
      applyPatch(data, patch);
      fireDoc(p);
      const parent = p.slice(0, p.lastIndexOf('/'));
      if (parent) { fireColl(parent); fireQueries(parent); }
    },
    async deleteDoc(ref) {
      const p = ref._path;
      docs.delete(p);
      fireDoc(p);
      const parent = p.slice(0, p.lastIndexOf('/'));
      if (parent) { fireColl(parent); fireQueries(parent); }
    },
    async addDoc(coll, data) {
      const ref = mkRef(coll._path + '/r' + (++idc));
      await this.setDoc(ref, data);
      return ref;
    },
    serverTimestamp: () => Date.now(),
    arrayUnion: (...v) => ({ __fv: true, op: 'union', values: v.flat() }),
    arrayRemove: (...v) => ({ __fv: true, op: 'remove', values: v.flat() }),
    FieldValue: { serverTimestamp: () => Date.now() },
  };

  const authM = {
    onAuthStateChanged(_auth, cb) {
      authListeners.add(cb);
      setTimeout(() => cb(currentAuth), 0);
      return () => authListeners.delete(cb);
    },
    async createUserWithEmailAndPassword(_auth, email, pass) {
      if (users.has(email)) throw { code: 'auth/email-already-in-use' };
      const u = { uid: 'uid_' + (++idc), email, displayName: null };
      users.set(email, u);
      currentAuth = u;
      authListeners.forEach(cb => cb(u));
      return { user: u };
    },
    async signInWithEmailAndPassword(_auth, email) {
      const u = users.get(email);
      if (!u) throw { code: 'auth/invalid-credential' };
      currentAuth = u;
      authListeners.forEach(cb => cb(u));
      return { user: u };
    },
    async signOut(_auth) {
      currentAuth = null;
      authListeners.forEach(cb => cb(null));
    },
    async updateProfile(u, opts) { if (opts && opts.displayName) u.displayName = opts.displayName; },
  };

  return { fsM, authM, docs, __auth: authM };
}

