const clone = (value) => {
  if (value === undefined) return undefined;
  return global.structuredClone
    ? global.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
};

const asComparable = (value) => {
  if (value && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return value;
};

const makeDocSnapshot = (id, data) => ({
  id,
  exists: data !== undefined,
  data: () => (data === undefined ? undefined : clone(data))
});

const makeQuerySnapshot = (docs) => ({
  docs,
  size: docs.length
});

function createMockFirestoreState() {
  return {
    collections: new Map(),
    idCounter: 0,
    verifyIdTokenImpl: null
  };
}

const state = createMockFirestoreState();

function getCollectionMap(name) {
  if (!state.collections.has(name)) {
    state.collections.set(name, new Map());
  }
  return state.collections.get(name);
}

function generateId() {
  state.idCounter += 1;
  return `doc_${state.idCounter}`;
}

function applyPatch(existing, patch) {
  const next = clone(existing || {});
  for (const [key, rawValue] of Object.entries(patch || {})) {
    if (rawValue && rawValue.__fieldValueOp === 'increment') {
      const current = Number(next[key] || 0);
      next[key] = current + Number(rawValue.operand || 0);
      continue;
    }
    next[key] = clone(rawValue);
  }
  return next;
}

function makeDocRef(collectionName, id) {
  return {
    _type: 'doc',
    id,
    async get() {
      const map = getCollectionMap(collectionName);
      return makeDocSnapshot(id, map.get(id));
    },
    async set(data, options = {}) {
      const map = getCollectionMap(collectionName);
      const prev = map.get(id);
      if (options && options.merge) {
        map.set(id, applyPatch(prev, data));
        return;
      }
      map.set(id, clone(data));
    },
    async update(data) {
      const map = getCollectionMap(collectionName);
      const prev = map.get(id);
      if (prev === undefined) {
        throw new Error('Document does not exist');
      }
      map.set(id, applyPatch(prev, data));
    }
  };
}

function matchFilters(data, filters) {
  return filters.every(({ field, op, value }) => {
    const left = asComparable(data[field]);
    if (op === '==') return left === asComparable(value);
    if (op === '>=') return left >= asComparable(value);
    if (op === '<') return left < asComparable(value);
    if (op === 'in') {
      if (!Array.isArray(value)) return false;
      return value.map(asComparable).includes(left);
    }
    throw new Error(`Unsupported where operator: ${op}`);
  });
}

function makeQuery(collectionName, filters = [], limitCount = null) {
  return {
    _type: 'query',
    where(field, op, value) {
      return makeQuery(collectionName, [...filters, { field, op, value }], limitCount);
    },
    limit(count) {
      return makeQuery(collectionName, filters, count);
    },
    async get() {
      const map = getCollectionMap(collectionName);
      const out = [];
      for (const [id, data] of map.entries()) {
        if (matchFilters(data, filters)) {
          out.push(makeDocSnapshot(id, data));
        }
      }
      const finalDocs = limitCount == null ? out : out.slice(0, limitCount);
      return makeQuerySnapshot(finalDocs);
    }
  };
}

function makeCollectionRef(name) {
  return {
    _type: 'collection',
    name,
    doc(id) {
      return makeDocRef(name, id || generateId());
    },
    where(field, op, value) {
      return makeQuery(name, [{ field, op, value }], null);
    },
    limit(count) {
      return makeQuery(name, [], count);
    },
    async get() {
      return makeQuery(name, [], null).get();
    },
    async add(data) {
      const ref = this.doc();
      await ref.set(data);
      return ref;
    }
  };
}

const db = {
  collection(name) {
    return makeCollectionRef(name);
  },
  async runTransaction(callback) {
    const tx = {
      async get(refOrQuery) {
        return refOrQuery.get();
      },
      set(ref, data, options) {
        return ref.set(data, options);
      },
      update(ref, data) {
        return ref.update(data);
      }
    };
    return callback(tx);
  }
};

const admin = {
  apps: [],
  credential: {
    cert(payload) {
      return payload;
    }
  },
  initializeApp() {
    admin.apps.push({ initialized: true });
    return admin.apps[admin.apps.length - 1];
  },
  firestore() {
    return db;
  },
  auth() {
    return {
      async verifyIdToken(token) {
        if (typeof state.verifyIdTokenImpl === 'function') {
          return state.verifyIdTokenImpl(token);
        }
        if (String(token).startsWith('valid:')) {
          return { uid: String(token).slice(6) };
        }
        throw new Error('Invalid token');
      }
    };
  },
  __reset() {
    state.collections = new Map();
    state.idCounter = 0;
    state.verifyIdTokenImpl = null;
    admin.apps = [];
  },
  __setVerifyIdTokenImpl(fn) {
    state.verifyIdTokenImpl = fn;
  },
  __seed(collectionName, id, data) {
    const map = getCollectionMap(collectionName);
    map.set(id, clone(data));
  },
  __dump(collectionName) {
    const map = getCollectionMap(collectionName);
    return Array.from(map.entries()).map(([id, data]) => ({ id, data: clone(data) }));
  }
};

admin.firestore.FieldValue = {
  increment(operand) {
    return {
      __fieldValueOp: 'increment',
      operand
    };
  }
};

module.exports = admin;
