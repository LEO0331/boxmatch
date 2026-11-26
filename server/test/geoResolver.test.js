const { createGeoResolver } = require('../observability/geoResolver');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = { enableGeoEnrichment: true, geoCountryDbPath: '/private/country.mmdb', geoAsnDbPath: '/private/asn.mmdb' };
const network = (ip = '8.8.8.8', suffix = 'a') => ({
  ip, identityConfidence: 'trusted', ipFingerprint: `hmac:${suffix.repeat(64)}`
});
const countryRecord = { country: { iso_code: 'TW' }, location: { latitude: 25, longitude: 121 }, city: { name: 'PRIVATE_CITY' } };
const asnRecord = { autonomous_system_number: 3462, autonomous_system_organization: 'Chunghwa Telecom' };

function readers(country = countryRecord, asn = asnRecord) {
  const countryReader = { get: jest.fn(() => country) };
  const asnReader = { get: jest.fn(() => asn) };
  const open = jest.fn(async (path) => path.includes('country') ? countryReader : asnReader);
  return { open, countryReader, asnReader };
}

test('disabled resolver opens no files and never enriches', async () => {
  const open = jest.fn();
  const resolver = createGeoResolver({}, { open });
  await resolver.ready;
  expect(open).not.toHaveBeenCalled();
  expect(resolver.lookup(network()).geoStatus).toBe('disabled');
});

test('initialization is asynchronous and request lookups never await database IO', async () => {
  let finish;
  const resolver = createGeoResolver({ ...config, geoAsnDbPath: '' }, { open: () => new Promise((resolve) => { finish = resolve; }) });
  expect(resolver.lookup(network()).geoStatus).toBe('unavailable');
  finish({ get: () => countryRecord });
  await resolver.ready;
  expect(resolver.lookup(network())).toMatchObject({ country: 'TW', asn: null, geoStatus: 'resolved' });
});

test.each(['8.8.8.8', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('resolves reliable normalized public address %s locally', async (ip) => {
  const fixtures = readers();
  const resolver = createGeoResolver(config, fixtures);
  await resolver.ready;
  const result = resolver.lookup(network(ip));
  expect(result).toEqual({ country: 'TW', asn: 3462, organization: 'Chunghwa Telecom', networkCategory: 'unknown', geoStatus: 'resolved' });
  expect(fixtures.countryReader.get).toHaveBeenCalledWith(ip.includes('ffff') ? '8.8.8.8' : ip);
  expect(JSON.stringify(result)).not.toMatch(/8\.8\.8\.8|latitude|longitude|PRIVATE_CITY|hmac/);
  expect(Object.isFrozen(result)).toBe(true);
});

test.each([
  { ...network(), identityConfidence: 'proxy' },
  { ...network(), identityConfidence: 'unresolved' },
  { ...network(), ipFingerprint: null },
  { ...network(), ipFingerprint: 'sha256:guessable' },
  { ...network(), ip: '127.0.0.1' },
  { ...network(), ip: '169.254.169.254' },
  { ...network(), ip: '2001:db8::1' },
  { ...network(), ip: 'https://attacker.example' }
])('does not use an unreliable or unsafe identity: %j', async (identity) => {
  const fixtures = readers();
  const resolver = createGeoResolver(config, fixtures);
  await resolver.ready;
  expect(resolver.lookup(identity).geoStatus).toBe('unavailable');
  expect(fixtures.countryReader.get).not.toHaveBeenCalled();
  expect(fixtures.asnReader.get).not.toHaveBeenCalled();
});

test('does not trust a self-reported country or infer a network category', async () => {
  const fixtures = readers(countryRecord, { ...asnRecord, autonomous_system_organization: 'Example Cloud Hosting Mobile ISP' });
  const resolver = createGeoResolver(config, fixtures);
  await resolver.ready;
  expect(resolver.lookup({ ...network(), country: 'US', asn: 1, networkCategory: 'cloud_provider' }))
    .toMatchObject({ country: 'TW', asn: 3462, networkCategory: 'unknown' });
});

test('missing paths, missing files, corrupted databases, and invalid readers degrade safely', async () => {
  for (const settings of [{ enableGeoEnrichment: true }, config]) {
    for (const open of [async () => { throw new Error('PRIVATE_DATABASE_PATH'); }, async () => ({})]) {
      const resolver = createGeoResolver(settings, { open });
      await expect(resolver.ready).resolves.toBeUndefined();
      expect(resolver.lookup(network()).geoStatus).toBe('unavailable');
      expect(JSON.stringify(resolver.lookup(network()))).not.toContain('PRIVATE_DATABASE_PATH');
    }
  }
  const missing = createGeoResolver({ ...config, geoCountryDbPath: '/missing-file-country.mmdb', geoAsnDbPath: '' });
  await missing.ready;
  expect(missing.lookup(network()).geoStatus).toBe('unavailable');
});

test('lookup errors are unavailable without throwing or exposing exception text', async () => {
  const resolver = createGeoResolver(config, { open: async () => ({ get() { throw new Error('PRIVATE_FAILURE'); } }) });
  await resolver.ready;
  const result = resolver.lookup(network());
  expect(result.geoStatus).toBe('unavailable');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_FAILURE');
});

test('the real reader rejects corrupt, empty and oversized local files safely', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'boxmatch-geo-test-'));
  const files = ['corrupt.mmdb', 'empty.mmdb', 'large.mmdb'].map((name) => path.join(directory, name));
  fs.writeFileSync(files[0], Buffer.from('not an MMDB database'));
  fs.writeFileSync(files[1], '');
  const descriptor = fs.openSync(files[2], 'w');
  fs.ftruncateSync(descriptor, 33 * 1024 * 1024);
  fs.closeSync(descriptor);
  try {
    for (const file of [...files, directory]) {
      const resolver = createGeoResolver({ ...config, geoCountryDbPath: file, geoAsnDbPath: '' });
      await resolver.ready;
      expect(resolver.lookup(network()).geoStatus).toBe('unavailable');
    }
  } finally {
    for (const file of files) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
});

test('validates ISO country codes, ASNs and organization strings rather than persisting arbitrary metadata', async () => {
  for (const country of ['ZZ', 'XK', 'US\nSECRET', 1, 'us']) {
    const resolver = createGeoResolver(config, readers({ country: { iso_code: country } }, null));
    await resolver.ready;
    expect(resolver.lookup(network())).toMatchObject({ country: null, asn: null, organization: null, geoStatus: 'not_found' });
  }
  for (const asn of [-1, 0, 4294967296, '3462', 1.2, NaN]) {
    const resolver = createGeoResolver(config, readers(null, { autonomous_system_number: asn, autonomous_system_organization: 'PRIVATE_ORG' }));
    await resolver.ready;
    expect(resolver.lookup(network())).toMatchObject({ asn: null, organization: null });
  }
  for (const name of ['x'.repeat(101), 'Bad\nOrganization', '<script>PRIVATE</script>', '=FORMULA()']) {
    const resolver = createGeoResolver(config, readers(null, { ...asnRecord, autonomous_system_organization: name }));
    await resolver.ready;
    expect(resolver.lookup(network())).toMatchObject({ asn: 3462, organization: null, geoStatus: 'resolved' });
  }
});

test('uses only bounded expiring HMAC cache keys and refreshes after expiration', async () => {
  let timestamp = 0;
  const fixtures = readers();
  const resolver = createGeoResolver({ ...config, geoCacheMaxEntries: 2, geoCacheTtlMs: 1000 }, { ...fixtures, now: () => timestamp });
  await resolver.ready;
  resolver.lookup(network());
  resolver.lookup(network());
  expect(fixtures.countryReader.get).toHaveBeenCalledTimes(1);
  timestamp = 1000;
  resolver.lookup(network());
  expect(fixtures.countryReader.get).toHaveBeenCalledTimes(2);
  resolver.lookup(network('8.8.4.4', 'b'));
  resolver.lookup(network('1.1.1.1', 'c'));
  expect(resolver.size).toBe(2);
  resolver.lookup(network());
  expect(fixtures.countryReader.get).toHaveBeenCalledTimes(5);
});

test('close clears readers/cache and late initialization cannot reactivate lookups', async () => {
  let finish;
  const resolver = createGeoResolver({ ...config, geoAsnDbPath: '' }, { open: () => new Promise((resolve) => { finish = resolve; }) });
  resolver.close();
  finish({ get: () => countryRecord });
  await resolver.ready;
  expect(resolver.lookup(network()).geoStatus).toBe('unavailable');
  expect(resolver.size).toBe(0);
});
