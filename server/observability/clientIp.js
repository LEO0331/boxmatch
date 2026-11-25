const { createHmac } = require('crypto');
const { isIP } = require('net');

function normalizeIp(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  let address = value.trim();
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  // Scope IDs depend on the host interface and do not identify remote clients.
  if (address.includes('%')) return null;
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return null;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

function isPublicIp(value) {
  const ip = normalizeIp(value);
  if (!ip) return false;
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  // Restrict identity verification to globally routable unicast space.
  const first = parseInt(ip.split(':')[0], 16);
  const second = parseInt(ip.split(':')[1] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff &&
    !(first === 0x2001 && second <= 0x1ff) && !ip.startsWith('2001:db8:');
}

function fingerprint(ip, secret) {
  if (!ip || typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 4096) return null;
  return `hmac:${createHmac('sha256', secret).update(ip).digest('hex')}`;
}

function resolveNetworkIdentity(req, secret) {
  const peer = normalizeIp(req.socket?.remoteAddress);
  const resolved = normalizeIp(req.ip);
  let ip = peer;
  let identityConfidence = peer ? 'proxy' : 'unresolved';
  const headers = req.headers || {};
  const hasForwarding = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'forwarded']
    .some((name) => headers[name] != null);
  const trust = req.app?.get?.('trust proxy fn');
  const trustedPeer = peer && typeof trust === 'function' && trust(req.socket.remoteAddress, 0);

  if (trustedPeer && headers['x-forwarded-for'] != null) {
    const header = headers['x-forwarded-for'];
    const chain = typeof header === 'string' && header.length <= 2048 ? header.split(',') : [];
    if (chain.length > 0 && chain.length <= 32 && chain.every((part) => normalizeIp(part))) {
      const ips = Array.isArray(req.ips) ? req.ips.map(normalizeIp) : [];
      if (ips.length > 0 && ips.every(Boolean) && resolved === ips[0] && isPublicIp(resolved)) {
        ip = resolved;
        identityConfidence = 'trusted';
      }
    }
  } else if (peer && resolved === peer && !hasForwarding && isPublicIp(peer)) {
    identityConfidence = 'trusted';
  }

  // Invalid Express resolution never upgrades an otherwise known socket peer.
  if (!resolved && peer) identityConfidence = 'proxy';
  return { ip, ipFingerprint: fingerprint(ip, secret), identityConfidence };
}

module.exports = { normalizeIp, isPublicIp, resolveNetworkIdentity };
