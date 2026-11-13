// Offline Surge host: never performs real network requests or changes policies.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

export const ORIGIN = 'http://paperclip.test';
export const IP = '203.0.113.24';
export const SESSION_KEY = 'paperclip.ipquality.surge.session';
export const defaultPolicies = {
  proxies: ['测试节点 A', 'REJECT'],
  'policy-groups': ['测试策略组'],
  'external-policies': [{ name: '测试订阅节点', group: '测试订阅', identifier: 'POLICY::fixture-external' }],
};
const source = await readFile(new URL('../ipquality.js', import.meta.url), 'utf8');

export function request(path, body, headers = {}) {
  return {
    url: ORIGIN + '/ipquality' + path,
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: ORIGIN, 'X-IPQuality-Client': '1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function fixtureReply(method, options) {
  const url = new URL(options.url);
  const json = (value, status = 200) => ({ status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  if (url.hostname === 'speed.cloudflare.com') {
    if (method === 'post') return { status: 200, headers: {}, body: 'ok' };
    const size = Number(url.searchParams.get('bytes') || 0);
    return { status: 200, headers: { 'Content-Length': String(size) }, body: new Uint8Array(size) };
  }
  if (url.pathname === '/cdn-cgi/trace') return { status: 200, headers: {}, body: `ip=${IP}\nloc=US\n` };
  if (['myip.check.place', 'v4.ident.me', 'ipv4.icanhazip.com'].includes(url.hostname)) return { status: 200, headers: {}, body: IP };
  if (url.hostname === 'api4.ipify.org') return json({ ip: IP });
  if (url.hostname === 'my.ippure.com') return json({ ip: IP, country: 'United States', countryCode: 'US', asn: 13335, riskScore: 10 });
  if (url.hostname === 'api.ipapi.is') return json({ ip: IP, asn: { asn: 13335, org: 'Offline Fixture' }, location: { country: 'United States', country_code: 'US', city: 'Test City', latitude: 37, longitude: -122 }, company: { name: 'Offline Fixture', type: 'hosting' } });
  if (url.hostname === 'ipinfo.check.place') return json({ ip: IP,
    Country: { IsoCode: 'US', Name: 'United States' },
    ASN: { AutonomousSystemNumber: 13335, AutonomousSystemOrganization: 'Offline Fixture' },
    City: { Name: 'Test City', Latitude: 37, Longitude: -122, Location: { TimeZone: 'Etc/UTC' } } });
  if (url.hostname === 'ipinfo.io') return json({ ip: IP, data: { ip: IP, country: 'US', city: 'Test City', org: 'AS13335 Offline Fixture', loc: '37,-122' } });
  if (url.hostname === 'ipwho.is') return json({ ip: IP, success: true, country: 'United States', country_code: 'US', latitude: 37, longitude: -122, connection: { asn: 13335, org: 'Offline Fixture' } });
  if (url.hostname === 'stat.ripe.net') {
    const endpoint = url.pathname.split('/')[2];
    const data = endpoint === 'network-info' ? { prefix: '203.0.113.0/24', asns: [13335] }
      : endpoint === 'prefix-overview' ? { announced: true, asns: [{ asn: 13335, holder: 'Offline Fixture' }], block: { name: 'TEST-NET' } }
      : endpoint === 'rpki-validation' ? { status: 'valid' } : {};
    return json({ status: 'ok', data });
  }
  if (url.hostname === 'api.globalping.io') {
    if (method === 'post') return json({ id: 'fixture', probesCount: 3 });
    return json({ id: 'fixture', status: 'finished', target: IP, results: [4134, 4837, 9808].map((asn) => ({
      probe: { asn, city: 'Test City', country: 'CN', network: 'Offline Fixture' },
      result: { status: 'finished', stats: { avg: 42, min: 40, max: 44, loss: 0 }, timings: [{ rtt: 40 }, { rtt: 44 }],
        hops: [{ resolvedAddress: IP, asn: [13335], timings: [{ rtt: 42 }], stats: { avg: 42, loss: 0, jAvg: 2 } }] },
    })) });
  }
  return { status: 503, headers: {}, body: 'Offline fixture: source intentionally unavailable' };
}

export async function evaluate(input, options = {}) {
  const store = options.store || new Map();
  const calls = [], apiCalls = [], notifications = [], logs = [], timers = new Set();
  const replyFor = options.replyFor || fixtureReply;
  const timeScale = options.timeScale || 1;
  const beganAt = Date.now();
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [TestDate.now()])); }
    static now() { return beganAt + (Date.now() - beganAt) / timeScale; }
  }
  let doneCount = 0;
  return new Promise((resolve, reject) => {
    const watchdog = setTimeout(() => { cleanup(); reject(new Error('Offline script did not finish')); }, 12000);
    function cleanup() { clearTimeout(watchdog); for (const timer of timers) clearTimeout(timer); timers.clear(); }
    function later(fn, delay = 0) {
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay * timeScale);
      timers.add(timer); return timer;
    }
    function http(method, config, callback) {
      const opts = typeof config === 'string' ? { url: config } : config;
      calls.push({ method, ...opts });
      later(() => {
        try { const reply = replyFor(method, opts); callback(reply.error || null, { status: reply.status, headers: reply.headers || {} }, reply.body); }
        catch (error) { callback(String(error), null, null); }
      }, 2);
    }
    const sandbox = {
      URL, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, crypto: webcrypto, Date: TestDate,
      setTimeout: later,
      clearTimeout: (timer) => { timers.delete(timer); clearTimeout(timer); },
      console: { log: (...args) => logs.push(args.join(' ')) },
      $script: { type: input ? 'http-request' : 'generic', name: options.scriptName || 'IPQuality_Open' },
      $environment: { system: 'iOS', 'surge-version': '6.0.0' },
      $argument: options.argument || '',
      $persistentStore: { read: (key) => store.get(key) ?? null, write: (value, key) => { if (options.writeFails) return false; store.set(key, value); return true; } },
      $httpClient: { get: (opts, cb) => http('get', opts, cb), post: (opts, cb) => http('post', opts, cb) },
      $utils: { ipasn: () => 13335, ipaso: () => 'Offline Fixture' },
      $notification: { post: (...args) => notifications.push(args) },
      $httpAPI: (method, path, body, callback) => {
        apiCalls.push({ method, path, body });
        later(() => callback(options.policies === null ? { error: 'fixture API unavailable' } : options.policies || defaultPolicies));
      },
      $done: (value) => {
        doneCount++; cleanup();
        resolve({ result: value, response: value?.response, calls, apiCalls, notifications, store, logs, doneCount });
      },
    };
    if (input) sandbox.$request = input;
    if (options.trigger) sandbox.$trigger = options.trigger;
    try { vm.runInNewContext(source, sandbox, { timeout: 2000, filename: 'IPQuality/ipquality.js' }); }
    catch (error) { cleanup(); reject(error); }
  });
}
