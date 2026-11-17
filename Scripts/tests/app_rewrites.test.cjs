const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const moduleText = fs.readFileSync(path.join(__dirname, '..', '..', 'App_remove_ads.sgmodule'), 'utf8');
const rewrites = moduleText.split('\n').filter((line) => line.startsWith('http-response-jq '))
  .map((line) => {
    const [, pattern, expression] = line.match(/^http-response-jq (\S+) '(.*)'$/);
    return { pattern, expression };
  });

function rewrite(endpoint, body) {
  const matches = rewrites.filter(({ pattern }) => pattern.includes(endpoint));
  assert.equal(matches.length, 1);
  const result = spawnSync('jq', ['-c', matches[0].expression], {
    input: JSON.stringify(body), encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return JSON.parse(result.stdout);
}

test('Coolapk initialization preserves ordinary and future entries', () => {
  const normal = { entityId: 1, title: '正常入口' };
  const future = { entityId: 999999, title: '新增功能' };
  const nested = { entityId: 20131, entities: [{ title: '酷品' }, { title: '正常工具' }, null] };
  const body = { code: 0, data: [normal, { entityId: 944 }, { entityId: 945 }, { entityId: 6390 },
    future, nested, {}, null, 7] };
  assert.deepEqual(rewrite('/main\\/init', body), { code: 0, data: [normal, future,
    { ...nested, entities: [nested.entities[1], null] }, {}, null, 7] });
});

test('Coolapk home feed removes configured ad cards without dropping normal cards', () => {
  const normal = { entityId: 1, entityTemplate: 'normal', title: '普通内容' };
  const future = { entityId: 999999, entityTemplate: 'new_type', title: 42 };
  const data = [normal, { entityTemplate: 'sponsorCard' }, ...[8639, 29349, 33006, 32557]
    .map((entityId) => ({ entityId })), { title: '值得买' }, { title: '领红包' }, future, {}, null, 7];
  assert.deepEqual(rewrite('/main\\/indexV8', { data }), { data: [normal, future, {}, null, 7] });
});

test('Coolapk filters preserve missing or changed response schemas', () => {
  for (const endpoint of ['/main\\/init', '/main\\/indexV8']) {
    for (const body of [{}, { data: null }, { data: {} }, { data: [] }, { code: -1, message: 'error' }]) {
      assert.deepEqual(rewrite(endpoint, body), body);
    }
  }
});

test('Zhihu answer rewrites match only Zhihu hosts', () => {
  const rules = rewrites.filter(({ pattern }) => pattern.includes('(api|page-info)'));
  assert.equal(rules.length, 2);
  for (const { pattern } of rules) {
    const regex = new RegExp(pattern.replace(/^\(\?i\)/, ''), 'i');
    for (const host of ['api.zhihu.com', 'page-info.zhihu.com']) {
      assert.equal(regex.test(`https://${host}/answers/v1/123`), true);
    }
    for (const host of ['api.com', 'page-info.com', 'api.zhihu.com.example.org']) {
      assert.equal(regex.test(`https://${host}/answers/v1/123`), false);
    }
  }
});
