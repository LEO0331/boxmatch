const { createRequire } = require('module');

// Resolve the dependencies used by the runtime clients, even if npm nests them.
const expressRequire = createRequire(require.resolve('express'));
const qs = expressRequire('qs');
const firebaseRequire = createRequire(require.resolve('firebase-admin'));
let storagePath;
try {
  storagePath = firebaseRequire.resolve('@google-cloud/storage');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

describe('runtime dependency security regressions', () => {
  test('qs enforces array limits on comma-separated bracket keys (alert #36)', () => {
    expect(() => qs.parse('a[]=1,2,3,4', {
      comma: true,
      arrayLimit: 3,
      throwOnLimitExceeded: true
    })).toThrow(RangeError);
  });

  test('qs safely serializes an attacker-controlled isBuffer property (alert #35)', () => {
    const parsed = qs.parse('x[constructor][isBuffer]=y', { plainObjects: true });
    expect(qs.stringify(parsed)).toBe('x%5Bconstructor%5D%5BisBuffer%5D=y');
  });

  test.each([null, undefined])('qs handles a %s comma-array value (alert #15)', (value) => {
    expect(qs.stringify({ a: [value, 'b'] }, {
      arrayFormat: 'comma',
      encodeValuesOnly: true
    })).toBe('a=,b');
  });
});

// Firebase declares Storage optional; npm may omit it on unsupported runtimes.
const storageTests = storagePath ? describe : describe.skip;
storageTests('optional Google Storage dependency security regressions', () => {
  let Gaxios;
  let uuid;
  beforeAll(() => {
    const storageRequire = createRequire(storagePath);
    const gaxiosPath = storageRequire.resolve('gaxios');
    ({ Gaxios } = storageRequire('gaxios'));
    uuid = createRequire(gaxiosPath)('uuid');
  });

  test.each(['v3', 'v5'])('uuid %s rejects an undersized output buffer (alert #14)', (method) => {
    expect(() => uuid[method]('x', uuid.v5.DNS, new Uint8Array(8), 4)).toThrow(RangeError);
  });

  test('gaxios can build a multipart request with the overridden uuid', async () => {
    const client = new Gaxios();
    const response = await client.request({
      url: 'https://example.invalid/upload',
      method: 'POST',
      multipart: [{ headers: { 'Content-Type': 'text/plain' }, content: 'payload' }],
      adapter: async (options) => {
        const boundary = options.headers['Content-Type'].split('boundary=')[1];
        expect(uuid.validate(boundary)).toBe(true);
        let body = '';
        for await (const chunk of options.body) body += chunk.toString();
        expect(body).toContain(`--${boundary}`);
        expect(body).toContain('payload');
        return { data: 'ok', status: 200, statusText: 'OK', headers: {}, config: options };
      }
    });
    expect(response.data).toBe('ok');
  });
});
