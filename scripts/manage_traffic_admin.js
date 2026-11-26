#!/usr/bin/env node

function validateUid(value) {
  if (typeof value !== 'string' || !value.length || value.length > 128 ||
      value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('A valid Firebase UID of 1–128 characters is required.');
  }
  return value;
}

function parseOptions(args = []) {
  if (args.length !== 3 || !['grant', 'revoke'].includes(args[0]) || args[1] !== '--uid') {
    throw new Error('Usage: manage_traffic_admin.js <grant|revoke> --uid FIREBASE_UID');
  }
  return { action: args[0], uid: validateUid(args[2]) };
}

async function manageTrafficAdmin(auth, { action, uid }) {
  uid = validateUid(uid);
  if (!['grant', 'revoke'].includes(action)) throw new Error('Choose grant or revoke explicitly.');
  const account = await auth.getUser(uid);
  const providers = account.providerData;
  // UserRecord does not expose isAnonymous. Require an actual linked provider;
  // conservatively reject unlinked/custom-token-only accounts as well.
  if (!Array.isArray(providers) || !providers.length || providers.some((provider) =>
    typeof provider?.providerId !== 'string' || !provider.providerId || provider.providerId === 'anonymous')) {
    throw new Error('Traffic administrators require a non-anonymous linked sign-in provider.');
  }
  if (action === 'grant' && account.disabled === true) {
    throw new Error('A disabled account cannot be granted access.');
  }
  const claims = { ...(account.customClaims || {}) };
  if (action === 'grant') claims.trafficAdmin = true;
  else delete claims.trafficAdmin;
  await auth.setCustomUserClaims(uid, claims);
  if (action === 'revoke') await auth.revokeRefreshTokens(uid);
  return { action, updated: true, sessionsRevoked: action === 'revoke' };
}

function operatorAuth(env = process.env) {
  const admin = require('../server/firebaseAdmin');
  if (!admin.apps.length) {
    const projectId = env.FIREBASE_PROJECT_ID;
    const clientEmail = env.FIREBASE_CLIENT_EMAIL;
    const privateKey = env.FIREBASE_PRIVATE_KEY;
    if (projectId && clientEmail && privateKey) {
      admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n') }) });
    } else if (projectId || clientEmail || privateKey) {
      throw new Error('All Firebase Admin credential variables must be supplied together.');
    } else {
      admin.initializeApp();
    }
  }
  return admin.auth();
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  console.log(JSON.stringify(await manageTrafficAdmin(operatorAuth(), options)));
}

if (require.main === module) main().catch(() => {
  // SDK errors can contain identities or account details. Keep CLI output generic.
  console.error('Traffic administrator update failed. Check the explicit action, linked account, project and Admin access. If revoking, rerun until both claim removal and session revocation succeed.');
  process.exitCode = 1;
});

module.exports = { parseOptions, validateUid, manageTrafficAdmin, operatorAuth };
