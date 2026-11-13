import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluate, request, fixtureReply, ORIGIN, IP, SESSION_KEY } from './harness.mjs';

const decode = (value) => JSON.parse(value.response.body);
async function session(policy = '测试节点 A') {
  const store = new Map();
  const value = await evaluate(request('/api/session', { policy }), { store });
  assert.equal(value.response.status, 200);
  return { store, run: decode(value).run };
}

test('page is served locally and its CSP hash matches the actual inline script', async () => {
  const value = await evaluate(request(''));
  assert.equal(value.response.status, 200);
  assert.equal(value.calls.length, 0);
  assert.equal(value.apiCalls.length, 0);
  const script = /<script>([\s\S]*?)<\/script>/.exec(value.response.body)[1];
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(value.response.headers['Content-Security-Policy'].includes(`'sha256-${hash}'`));
  assert.match(value.response.headers['Content-Security-Policy'], /require-trusted-types/);
});

test('context lists external identifiers, excludes rejecting policies and only reads Surge state', async () => {
  const value = await evaluate(request('/api/context'));
  const data = decode(value);
  assert.ok(data.policies.some((p) => p.value === 'POLICY::fixture-external' && p.label.includes('测试订阅节点')));
  assert.ok(!data.policies.some((p) => p.value === 'REJECT'));
  assert.equal(value.calls.length, 0);
  assert.ok(value.apiCalls.every((call) => call.method === 'GET'));
  assert.equal(value.apiCalls[0].body.include_external, true);
});

test('invalid policy is rejected without changing storage or running probes', async () => {
  const value = await evaluate(request('/api/session', { policy: 'missing-policy' }));
  assert.equal(value.response.status, 400);
  assert.equal(value.store.size, 0);
  assert.equal(value.calls.length, 0);
});

test('API denies cross-origin requests and missing client headers before inspecting policies', async () => {
  for (const headers of [{ Origin: 'https://unrelated.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-IPQuality-Client': '' }]) {
    const value = await evaluate(request('/api/context', undefined, headers));
    assert.equal(value.response.status, 403);
    assert.equal(value.apiCalls.length, 0);
    assert.equal(value.calls.length, 0);
  }
});

test('session IDs and expiry gate external requests', async () => {
  const active = await session();
  assert.match(active.run, /^[0-9a-f]{48}$/);
  const wrong = await evaluate(request('/api/check', { run: 'wrong', module: 'basic' }), active);
  assert.equal(wrong.response.status, 409);
  assert.equal(wrong.calls.length, 0);
  const saved = JSON.parse(active.store.get(SESSION_KEY));
  saved.createdAt -= 31 * 60 * 1000; active.store.set(SESSION_KEY, JSON.stringify(saved));
  const expired = await evaluate(request('/api/check', { run: active.run, module: 'basic' }), active);
  assert.equal(expired.response.status, 410);
  assert.equal(expired.calls.length, 0);
});

test('failed session persistence is reported without probing', async () => {
  const value = await evaluate(request('/api/session', { policy: 'DIRECT' }), { writeFails: true });
  assert.equal(value.response.status, 500);
  assert.equal(value.calls.length, 0);
});

test('configured fallback works if policy listing is unavailable', async () => {
  const value = await evaluate(request('/api/context'), { policies: null, argument: 'Fallback Group' });
  const data = decode(value);
  assert.equal(data.defaultPolicy, 'Fallback Group');
  assert.ok(data.warning);
  assert.ok(data.policies.some((p) => p.value === 'Fallback Group'));
});

test('all 15 modules finish with isolated synthetic responses and bind policies in seconds', async (t) => {
  const active = await session('POLICY::fixture-external');
  const modules = ['basic', 'types', 'scores', 'factors', 'egress', 'bgp', 'bgppath', 'speed', 'inbound', 'ping', 'mtr', 'stability', 'media', 'regions', 'status'];
  for (const module of modules) {
    await t.test(module, async () => {
      const value = await evaluate(request('/api/check', { run: active.run, module }), active);
      assert.equal(value.response.status, 200, value.response.body);
      const data = decode(value);
      assert.equal(data.module, module);
      assert.ok(data.html.includes('report-root'));
      assert.equal(value.doneCount, 1);
      assert.ok(value.calls.length > 0);
      assert.ok(value.calls.every((call) => new URL(call.url).hostname !== 'api.ipapi.is'), 'do not consume limited anonymous ipapi requests');
      for (const call of value.calls) {
        assert.ok(!('node' in call));
        assert.ok(call.policy === 'DIRECT' || call.policy === 'POLICY::fixture-external', call.policy);
        assert.ok(call.timeout > 0 && call.timeout <= 8, String(call.timeout));
        assert.ok(!('alpn' in call));
      }
      const selected = value.calls.filter((call) => call.policy === 'POLICY::fixture-external');
      assert.ok(selected.length > 0);
      if (module === 'speed') {
        assert.ok(value.calls.some((call) => call['binary-mode'] === true));
        assert.ok(value.calls.some((call) => call.method === 'post' && typeof call.body === 'string'));
      } else {
        assert.ok(value.calls.some((call) => call.policy === 'DIRECT') || data.cachedQueries > 0, 'public database queries keep DIRECT or reuse this session cache');
        assert.ok(!data.html.includes('POLICY::fixture-external'), 'report uses readable label');
      }
    });
  }
});

test('masking removes literal fixture IPv4 from the rendered basic report', async () => {
  const active = await session();
  const value = await evaluate(request('/api/check', { run: active.run, module: 'basic', mask: true }), active);
  assert.equal(value.response.status, 200);
  assert.ok(!decode(value).html.includes(IP));
});

test('same-session metadata caching reduces requests without caching egress probes', async () => {
  const active = await session();
  const input = request('/api/check', { run: active.run, module: 'basic' });
  const cold = await evaluate(input, active);
  const warm = await evaluate(input, active);
  assert.equal(decode(cold).cachedQueries, 0);
  assert.ok(decode(warm).cachedQueries > 0);
  assert.ok(warm.calls.length < cold.calls.length);
  for (const host of ['api4.ipify.org', 'myip.check.place', 'my.ippure.com', 'v4.ident.me', 'ipv4.icanhazip.com']) {
    assert.equal(warm.calls.filter((c) => new URL(c.url).hostname === host).length, cold.calls.filter((c) => new URL(c.url).hostname === host).length);
  }
  assert.ok(active.store.size <= 33, 'one session and at most 32 bounded cache slots');
  console.log(`Offline repeated-basic fixture: ${cold.calls.length} requests cold, ${warm.calls.length} requests warm.`);
});

test('expired entries and a new target session cannot reuse old metadata', async () => {
  const active = await session();
  const input = request('/api/check', { run: active.run, module: 'basic' });
  const cold = await evaluate(input, active);
  for (const [key, raw] of active.store) {
    if (!key.startsWith('paperclip.ipquality.surge.query.')) continue;
    const item = JSON.parse(raw); item.createdAt -= 60001; active.store.set(key, JSON.stringify(item));
  }
  const expired = await evaluate(input, active);
  assert.equal(decode(expired).cachedQueries, 0);
  assert.equal(expired.calls.length, cold.calls.length);
  const next = await evaluate(request('/api/session', { policy: '测试策略组' }), active);
  const fresh = await evaluate(request('/api/check', { run: decode(next).run, module: 'basic' }), active);
  assert.equal(decode(fresh).cachedQueries, 0);
  assert.ok(!fresh.calls.some((call) => call.policy === '测试节点 A'));
});

test('speed samples are always executed, even after another speed run', async () => {
  const active = await session();
  const input = request('/api/check', { run: active.run, module: 'speed' });
  const first = await evaluate(input, active);
  const second = await evaluate(input, active);
  assert.equal(decode(first).cachedQueries, 0);
  assert.equal(decode(second).cachedQueries, 0);
  assert.equal(second.calls.length, first.calls.length);
  assert.ok(second.calls.some((call) => call['binary-mode']));
});

test('HTTP errors and JSON error results are not cached', async () => {
  for (const status of [200, 503]) {
    const active = await session();
    const metadataURL = (url) => new URL(url).hostname === 'ipinfo.check.place' && new URL(url).pathname === '/' + IP;
    const options = { ...active, replyFor: (method, config) => metadataURL(config.url)
      ? { status, headers: {}, body: JSON.stringify({ error: 'fixture source unavailable' }) }
      : fixtureReply(method, config) };
    const input = request('/api/check', { run: active.run, module: 'basic' });
    const first = await evaluate(input, options);
    const second = await evaluate(input, options);
    assert.ok(first.calls.some((call) => metadataURL(call.url)));
    assert.equal(second.calls.filter((call) => metadataURL(call.url)).length, first.calls.filter((call) => metadataURL(call.url)).length);
  }
});

test('unknown modules never trigger any third-party request', async () => {
  const active = await session();
  const value = await evaluate(request('/api/check', { run: active.run, module: '__proto__' }), active);
  assert.equal(value.response.status, 400);
  assert.equal(value.calls.length, 0);
});

test('public metadata falls back from DIRECT to the selected policy on transport failures', async () => {
  const active = await session();
  const value = await evaluate(request('/api/check', { run: active.run, module: 'bgp' }), { ...active,
    replyFor: (method, config) => new URL(config.url).hostname === 'stat.ripe.net' && config.policy === 'DIRECT'
      ? { error: 'fixture timeout', status: 0, body: '' } : fixtureReply(method, config) });
  const data = decode(value);
  assert.equal(data.completion, 'complete');
  assert.ok(data.routingFallbacks > 0);
  assert.ok(value.calls.some((call) => new URL(call.url).hostname === 'stat.ripe.net' && call.policy === '测试节点 A'));
  assert.ok(value.calls.filter((call) => new URL(call.url).hostname === 'stat.ripe.net' && call.policy === 'DIRECT').every((call) => call.timeout <= 3));
});

test('provider rate limits are reported without retrying from another policy', async () => {
  const active = await session();
  const value = await evaluate(request('/api/check', { run: active.run, module: 'bgp' }), { ...active,
    replyFor: (method, config) => new URL(config.url).hostname === 'stat.ripe.net'
      ? { status: 429, headers: { 'Retry-After': '60' }, body: '{}' } : fixtureReply(method, config) });
  assert.equal(decode(value).completion, 'partial');
  assert.ok(decode(value).warnings.some((message) => message.includes('429')));
  assert.equal(value.calls.filter((call) => new URL(call.url).hostname === 'stat.ripe.net').length, 1);
});

test('Globalping waits beyond four polls and checks per-probe completion', async () => {
  const active = await session(); let polls = 0;
  const value = await evaluate(request('/api/check', { run: active.run, module: 'ping' }), { ...active, timeScale: 0.02,
    replyFor: (method, config) => {
      const reply = fixtureReply(method, config);
      if (method === 'get' && new URL(config.url).hostname === 'api.globalping.io' && ++polls < 6) {
        const body = JSON.parse(reply.body); body.status = 'in-progress';
        body.results.forEach((item) => { item.result = { status: 'in-progress' }; }); reply.body = JSON.stringify(body);
      }
      return reply;
    } });
  assert.equal(polls, 6);
  assert.equal(decode(value).completion, 'complete');
  assert.equal(decode(value).measurement.pending, 0);
});

test('unfinished Globalping results are explicitly partial after the wait budget', async () => {
  const active = await session();
  const value = await evaluate(request('/api/check', { run: active.run, module: 'mtr' }), { ...active, timeScale: 0.01,
    replyFor: (method, config) => {
      const reply = fixtureReply(method, config);
      if (method === 'get' && new URL(config.url).hostname === 'api.globalping.io') {
        const body = JSON.parse(reply.body); body.status = 'in-progress';
        body.results.forEach((item) => { item.result = { status: 'in-progress' }; }); reply.body = JSON.stringify(body);
      }
      return reply;
    } });
  const data = decode(value);
  assert.equal(data.completion, 'partial');
  assert.equal(data.measurement.pending, 3);
  assert.ok(data.warnings.some((message) => message.includes('仍未结束')));
});

test('completed Ping with 100 percent loss is a measured no-response result', async () => {
  const active = await session();
  const value = await evaluate(request('/api/check', { run: active.run, module: 'ping' }), { ...active, timeScale: 0.05,
    replyFor: (method, config) => {
      const reply = fixtureReply(method, config);
      if (method === 'get' && new URL(config.url).hostname === 'api.globalping.io') {
        const body = JSON.parse(reply.body);
        body.results.forEach((item) => { item.result.stats = { avg: null, min: null, max: null, loss: 100 }; item.result.timings = []; });
        reply.body = JSON.stringify(body);
      }
      return reply;
    } });
  assert.equal(decode(value).completion, 'complete');
  assert.ok(decode(value).html.includes('无 ICMP 响应 · 丢包 100%'));
});

test('speed reports missing measurements as partial instead of complete', async () => {
  const active = await session();
  const value = await evaluate(request('/api/check', { run: active.run, module: 'speed' }), { ...active,
    replyFor: () => ({ status: 503, headers: {}, body: 'unavailable' }) });
  const data = decode(value);
  assert.equal(data.completion, 'partial');
  assert.ok(data.warnings.includes('下载未返回有效样本'));
});

test('launchers use Surge notification URLs and automatic panel refresh is quiet', async () => {
  for (const [scriptName, preset] of [['IPQuality_Basic', 'basic'], ['IPQuality_Risk', 'risk'], ['IPQuality_Media', 'media']]) {
    const value = await evaluate(undefined, { scriptName, trigger: 'button' });
    assert.equal(value.notifications.length, 1);
    assert.equal(value.notifications[0][3].url, ORIGIN + '/ipquality?preset=' + preset);
    assert.equal(value.calls.length, 0);
  }
  const automatic = await evaluate(undefined, { trigger: 'auto-interval' });
  assert.equal(automatic.notifications.length, 0);
  assert.equal(automatic.calls.length, 0);
});
