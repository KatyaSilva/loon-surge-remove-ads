// Build a single Surge script; no eval or runtime JavaScript downloads.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { adaptEngine } from './src/engine-adapter.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [runtime, html, engine, speed] = await Promise.all([
  read('./src/runtime.js'), read('./src/index.html'),
  read('./vendor/ipquality-r32.js'), read('./vendor/ipquality-speed.js'),
]);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error('Expected one inline page script');
const scriptHash = createHash('sha256').update(scripts[0][1]).digest('base64');
const csp = `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self' blob:; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; require-trusted-types-for 'script'`;
const adaptedEngine = adaptEngine(engine);
const speedReportAnchor = '            html: renderReport(result),';
if (speed.split(speedReportAnchor).length !== 2) throw new Error('Upstream speed report anchor changed');
const adaptedSpeed = speed.replace(speedReportAnchor, speedReportAnchor + '\n'
  + '            completion: result.download && result.upload && result.latencyCount === 3 ? "complete" : "partial",\n'
  + '            warnings: [].concat(result.download ? [] : ["下载未返回有效样本"], result.upload ? [] : ["上传未返回有效样本"], result.latencyCount === 3 ? [] : ["延迟样本未全部完成"]),');
const replacements = new Map([
  ['/* @PAGE_HTML */', JSON.stringify(html)],
  ['/* @PAGE_CSP */', JSON.stringify(csp)],
  ['/* @ENGINE_BODY */', adaptedEngine],
  ['/* @SPEED_BODY */', adaptedSpeed],
]);
let bundle = runtime;
for (const [marker, value] of replacements) {
  if (bundle.split(marker).length !== 2) throw new Error(`Expected exactly one ${marker}`);
  bundle = bundle.replace(marker, () => value);
}
const output = new URL('./ipquality.js', import.meta.url);
await writeFile(output, bundle);
console.log(`Built ${fileURLToPath(output)} (${Buffer.byteLength(bundle)} bytes)`);
