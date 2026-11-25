// Keep the application's small Admin API surface stable across the modular SDK
// and the legacy-shaped test double. SDK modules resolve from server dependencies.
const root = require('firebase-admin');

if (Array.isArray(root.apps) && typeof root.firestore === 'function') {
  module.exports = root;
} else {
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const firestore = (...args) => getFirestore(...args);
  firestore.FieldValue = FieldValue;

  module.exports = {
    get apps() {
      return getApps();
    },
    initializeApp,
    credential: { cert },
    firestore,
    auth: (...args) => getAuth(...args)
  };
}
