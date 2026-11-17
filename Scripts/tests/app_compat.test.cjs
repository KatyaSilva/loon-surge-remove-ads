const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app_compat.js'), 'utf8');

function run(mode, { headers = {}, body } = {}) {
  const results = [];
  vm.runInNewContext(source, {
    $argument: mode,
    $request: { headers },
    $response: { body },
    $done: (result) => results.push(JSON.parse(JSON.stringify(result))),
  }, { timeout: 1000 });
  assert.equal(results.length, 1, '$done must be called once');
  return results[0];
}

test('12306 blocks only the five configured advertising operations', () => {
  const operations = ['integration.activityBanner', 'memberInfo.getMemberQa',
    'newHomePage.initData', 'newHomePageBussData', 'paySuccBuss.bussEntryShow'];
  for (const operation of operations) {
    assert.deepEqual(run('12306', { headers: { 'Operation-Type': 'com.cars.otsmobile.' + operation } }), { abort: true });
  }
});

test('12306 login, ticket queries and missing headers pass through', () => {
  for (const operation of ['com.cars.otsmobile.checkLoginStatus', 'com.cars.otsmobile.queryLeftTicket', '']) {
    assert.deepEqual(run('12306', { headers: { 'operation-type': operation } }), {});
  }
  assert.deepEqual(run('12306'), {});
});

test('Umetrip returns a numeric HTTP status for ad identifiers', () => {
  for (const rpid of ['1000002', 'prefix-1000019-suffix']) {
    assert.deepEqual(run('umetrip', { headers: { RPID: rpid } }), { status: 404 });
  }
});

test('Umetrip tolerates absent headers and preserves other operations', () => {
  assert.deepEqual(run('umetrip'), {});
  assert.deepEqual(run('umetrip', { headers: { Rpid: 'normal-operation' } }), {});
});

test('Tonghuashun removes ads and preserves unrecognized non-ad entries', () => {
  const data = [{ id: 1, info: { subject: 'news' } }, { id: 2, info: { subject: 'ad' } }, { id: 3 }, null, 7];
  const result = run('tonghuashun', { body: JSON.stringify({ data, total: 5, code: 0 }) });
  assert.deepEqual(JSON.parse(result.body), { data: [data[0], data[2], null, 7], total: 5, code: 0 });
});

test('Tonghuashun preserves server pagination metadata when ads are removed', () => {
  const body = { data: [{ id: 1, info: { subject: 'news' } }, { id: 2, info: { subject: 'ad' } }],
    total: 200, page: 3, has_more: true, next_cursor: 'next-page' };
  const result = JSON.parse(run('tonghuashun', { body: JSON.stringify(body) }).body);
  assert.deepEqual(result, { ...body, data: [body.data[0]] });
  const withoutTotal = JSON.parse(run('tonghuashun', {
    body: JSON.stringify({ data: body.data }),
  }).body);
  assert.equal(Object.hasOwn(withoutTotal, 'total'), false);
});

test('Tonghuashun leaves no-ad pagination totals and malformed responses untouched', () => {
  for (const body of [undefined, '', '<html>upstream error</html>', '{}', '{"data":null}', 'null', '[]',
    '{"data":[{"info":{"subject":"news"}}],"total":100}']) {
    assert.deepEqual(run('tonghuashun', { body }), {});
  }
});

test('unknown adapter mode is a no-op', () => {
  assert.deepEqual(run('unknown'), {});
});
