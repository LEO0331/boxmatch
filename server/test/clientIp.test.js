const express = require('express');
const request = require('supertest');
const { createHmac } = require('crypto');
const { normalizeIp, isPublicIp, resolveNetworkIdentity } = require('../observability/clientIp');

const secret = 'request-intelligence-test-secret-32-bytes';
const direct = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, ip, headers });

test.each([
  ['8.8.8.8', '8.8.8.8'],
  [' 8.8.8.8 ', '8.8.8.8'],
  ['::ffff:8.8.8.8', '8.8.8.8'],
  ['::ffff:808:808', '8.8.8.8'],
  ['2001:4860:0000:0000:0000:0000:0000:8888', '2001:4860::8888'],
  ['[2001:4860::8888]', '2001:4860::8888'],
  ['::', '::'],
  ['fe80::1%eth0', null],
  ['127.1', null],
  ['008.8.8.8', null],
  ['8.8.8.8:80', null],
  ['8.8.8.8,1.1.1.1', null],
  ['not-an-ip', null],
  [undefined, null],
  [{ toString: () => '8.8.8.8' }, null]
])('normalizes and validates %j', (input, expected) => {
  expect(normalizeIp(input)).toBe(expected);
});

test('only global unicast addresses qualify for trusted public identity', () => {
  for (const ip of ['8.8.8.8', '2001:4860:4860::8888']) expect(isPublicIp(ip)).toBe(true);
  for (const ip of ['127.0.0.1', '10.1.2.3', '100.64.1.1', '172.16.0.1', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '224.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1',
    '::1', '::', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1',
    '2001::1', '2001:2::1', '2001:10::1']) expect(isPublicIp(ip)).toBe(false);
});

test('normalizes equivalent network identities before HMAC and never returns the secret', () => {
  const result = resolveNetworkIdentity(direct('::ffff:8.8.8.8'), secret);
  expect(result).toEqual({ ip: '8.8.8.8', identityConfidence: 'trusted',
    ipFingerprint: `hmac:${createHmac('sha256', secret).update('8.8.8.8').digest('hex')}` });
  expect(resolveNetworkIdentity(direct('8.8.8.8'), secret)).toEqual(result);
  expect(JSON.stringify(result)).not.toContain(secret);
});

test('missing and weak HMAC secrets disable fingerprints instead of using a default', () => {
  for (const missing of [undefined, '', null, 'short', 'x'.repeat(4097)]) {
    expect(resolveNetworkIdentity(direct('8.8.8.8'), missing).ipFingerprint).toBeNull();
  }
  expect(resolveNetworkIdentity(direct('8.8.8.8'), `${secret}-rotated`).ipFingerprint)
    .not.toBe(resolveNetworkIdentity(direct('8.8.8.8'), secret).ipFingerprint);
});

test('spoofed forwarding headers never select the attacker supplied address', () => {
  for (const name of ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'forwarded']) {
    const result = resolveNetworkIdentity(direct('8.8.8.8', { [name]: '1.1.1.1' }), secret);
    expect(result.ip).toBe('8.8.8.8');
    expect(result.identityConfidence).toBe('proxy');
  }
  expect(resolveNetworkIdentity(direct('10.1.1.1'), secret).identityConfidence).toBe('proxy');
  expect(resolveNetworkIdentity({ ip: '8.8.8.8', headers: {} }, secret))
    .toEqual({ ip: null, ipFingerprint: null, identityConfidence: 'unresolved' });
});

test('trusted Express proxy resolution uses validated req.ip and refuses malformed chains', async () => {
  const app = express();
  app.set('trust proxy', ['loopback']);
  app.get('/', (req, res) => res.json(resolveNetworkIdentity(req, secret)));
  const valid = await request(app).get('/').set('X-Forwarded-For', '8.8.8.8');
  expect(valid.body.ip).toBe('8.8.8.8');
  expect(valid.body.identityConfidence).toBe('trusted');
  const mapped = await request(app).get('/').set('X-Forwarded-For', '::ffff:8.8.8.8');
  expect(mapped.body.ipFingerprint).toBe(valid.body.ipFingerprint);
  for (const header of ['malformed', 'malformed, 8.8.8.8', '8.8.8.8,'.repeat(300)]) {
    const invalid = await request(app).get('/').set('X-Forwarded-For', header);
    expect(invalid.body.identityConfidence).toBe('proxy');
    expect(invalid.body.ip).not.toBe('8.8.8.8');
  }
});

test('untrusted Express proxy configuration ignores all forwarding candidates', async () => {
  const app = express();
  app.get('/', (req, res) => res.json(resolveNetworkIdentity(req, secret)));
  const response = await request(app).get('/').set('X-Forwarded-For', '8.8.8.8')
    .set('X-Real-IP', '1.1.1.1').set('CF-Connecting-IP', '1.0.0.1');
  expect(response.body.identityConfidence).toBe('proxy');
  expect(response.body.ip).toBe('127.0.0.1');
});

test('Express stops at an untrusted proxy rather than accepting a spoofed left-most address', async () => {
  const app = express();
  app.set('trust proxy', ['loopback']);
  app.get('/', (req, res) => res.json(resolveNetworkIdentity(req, secret)));
  const response = await request(app).get('/').set('X-Forwarded-For', '1.1.1.1, 8.8.8.8');
  expect(response.body.ip).toBe('8.8.8.8');
  expect(response.body.identityConfidence).toBe('trusted');
});
