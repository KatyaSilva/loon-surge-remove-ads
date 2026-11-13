// Small, checked patches against the pinned upstream source. Vendor files stay intact.
export function adaptEngine(source) {
  function once(before, after) {
    if (source.split(before).length !== 2) throw new Error('Upstream patch anchor changed: ' + before.slice(0, 70));
    source = source.replace(before, () => after);
  }
  once('const displayNodeName = truncateText(nodeName, 30);', 'const displayNodeName = truncateText(params.displayNode || nodeName, 30);');
  once('const RUN_DEADLINE_MS = 45000;', 'const RUN_DEADLINE_MS = Number($environment.params.deadlineMs) || 45000;');
  // The anonymous API now permits only 30 requests/day and omits risk/type fields.
  once('        ["ipapi", requestJson(IPAPI_URL)],\n', '');
  once([
    '        ipapi: discovery.ipapi',
    '            ? Promise.resolve(discovery.ipapi)',
    '            : requestJson(`${IPAPI_URL}?q=${pathIP}`, { node: "DIRECT" }),',
  ].join('\n'), '        ipapi: Promise.resolve({ _surgeAnonymousLimited: true }),');
  once('{ keys: ["ipapi"], name: "ipapi", ok: !!(data.ipapi && data.ipapi.ip) },', '{ keys: ["ipapi"], name: "ipapi", ok: !!(data.ipapi && data.ipapi.ip), skipped: !!(data.ipapi && data.ipapi._surgeAnonymousLimited) },');
  once('        ipapiMatch && Number.isFinite(ipapiRatio)', '        data.ipapi && data.ipapi._surgeAnonymousLimited ? null : ipapiMatch && Number.isFinite(ipapiRatio)');
  once('/insufficient\\s+credits?/i', '/insufficient\\s+credits?|(?:exceed|exhaust)[\\s\\S]*(?:quota|limit|credit)|(?:quota|limit|credit)[\\s\\S]*(?:exceed|exhaust)/i');
  once('`${item.name}（上游额度不足）`', 'item.name === "ipapi" ? "ipapi（匿名接口不提供风险字段，已跳过）" : `${item.name}（上游配额用尽）`');
  once('        htmlMessage: html,', '        htmlMessage: html,\n        diagnostics: surgeDiagnostics(data, audit, risks, media),');
  function replaceFunction(startName, nextName, replacement) {
    const start = source.indexOf(startName);
    const end = source.indexOf(nextName, start);
    if (start < 0 || end < 0) throw new Error('Upstream function boundary changed');
    source = source.slice(0, start) + replacement + '\n' + source.slice(end);
  }
  replaceFunction('async function createGlobalpingMeasurement(', 'function parseInboundMeasurement(', globalpingPatch.toString().replace('globalpingPatch', 'createGlobalpingMeasurement'));
  replaceFunction('function renderProbePing(', 'function renderProbeMTR(', pingReportPatch.toString().replace('pingReportPatch', 'renderProbePing'));
  return source + '\n' + surgeDiagnostics.toString();
}

async function globalpingPatch(type, target, measurementOptions, attempts) {
  const created = await capture(requestJson('https://api.globalping.io/v1/measurements', {
    method: 'POST', node: 'DIRECT', timeout: 8000,
    body: JSON.stringify({ type, target, locations: GLOBALPING_LOCATIONS, measurementOptions: measurementOptions || {} }),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'paperclip-ipquality/1.0' },
  }));
  if (!created.ok || !created.value || !created.value.id) {
    return { error: `Globalping 创建测量失败：${created.error || '未返回任务编号'}` };
  }
  let measurement = null;
  for (let attempt = 0; attempt < Math.max(30, attempts || 0) && deadlineRemaining() > 1800; attempt++) {
    await delay(attempt ? 1400 : 700);
    if (deadlineRemaining() < 800) break;
    const polled = await capture(requestJson(`https://api.globalping.io/v1/measurements/${encodeURIComponent(created.value.id)}`, {
      node: 'DIRECT', timeout: Math.min(6000, deadlineRemaining() - 200),
    }));
    if (polled.ok) measurement = polled.value;
    if (measurement && measurement.status && measurement.status !== 'in-progress'
      && !(measurement.results || []).some((item) => item.result && item.result.status === 'in-progress')) break;
  }
  return measurement || { error: 'Globalping 测量结果未返回' };
}

function pingReportPatch(result) {
  if (!result || result.error) return mutedLine(result && result.error || '本次没有外部探针 Ping 结果');
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const content = rows.map((row) => {
    const name = uniqueValues([row.carrier, row.asn ? `AS${row.asn}` : '', row.location]).join(' · ');
    const labels = { finished: '测量已完成', 'in-progress': '探针仍在执行', failed: '探针执行失败', offline: '探针离线' };
    const stats = row.avg !== null
      ? `${row.avg} ms · 丢包 ${row.loss !== null ? `${row.loss}%` : '--'}` + (row.jitter !== null ? ` · 抖动 ${row.jitter} ms` : '')
      : row.status === 'finished' && row.loss === 100 ? '无 ICMP 响应 · 丢包 100%'
        : `${labels[row.status] || '尚未完成'} · 未返回 RTT`;
    return infoLine(name || '外部探针', stats);
  }).join('');
  const missing = result.missing && result.missing.length ? mutedLine(`当前无可用探针 · ${result.missing.join('、')}`) : '';
  return (content || mutedLine('本次没有探针返回 Ping 统计')) + missing
    + mutedLine(`Globalping 测量 ${result.id || '--'}；这是外部探针到出口 IP 的 ICMP 测量。100% 丢包表示本次未收到 ICMP 回应，不代表 HTTPS 或代理不可用。`);
}

function surgeDiagnostics(data, audit, risks, media) {
  const module = params.module;
  const warnings = [];
  if (['basic', 'types', 'factors', 'egress', 'status'].includes(module) && audit.failed.length) {
    warnings.push('未返回所需数据：' + audit.failed.join('、'));
  }
  if (module === 'scores') {
    for (const risk of risks.filter((item) => !item.available)) {
      const reason = risk.name === 'DB-IP' ? data._errors.dbip : '';
      warnings.push(risk.name + (reason ? '：' + reason : '：未提供风险评分'));
    }
  }
  if (['types', 'scores', 'factors', 'status'].includes(module)) warnings.push(...audit.skipped);
  if (module === 'bgp' || module === 'bgppath') {
    if (!data._bgp || data._bgp.error) warnings.push(data._bgp && data._bgp.error || 'BGP 数据未返回');
    else if (module === 'bgppath' && !(data._bgp.pathAnalysis && data._bgp.pathAnalysis.pathCount)) warnings.push('本次未返回可分析的 BGP 路径');
    else if (data._bgp.errors.length) warnings.push('BGP 部分来源未返回：' + data._bgp.errors.join('、'));
  }
  const probe = module === 'inbound' ? data._inboundRoutes : module === 'ping' ? data._probePing : module === 'mtr' ? data._probeMTR : null;
  let measurement = null;
  if (['inbound', 'ping', 'mtr'].includes(module)) {
    if (!probe || probe.error) warnings.push(probe && probe.error || '外部探针结果未返回');
    else {
      const rows = probe.rows || probe.routes || [];
      measurement = { id: probe.id, status: probe.status, total: rows.length,
        pending: rows.filter((row) => row.status === 'in-progress').length,
        unavailable: rows.filter((row) => ['failed', 'offline'].includes(row.status)).length };
      if (probe.status === 'in-progress' || measurement.pending) warnings.push('外部测量在本次等待时限内仍未结束');
      if (measurement.unavailable) warnings.push(measurement.unavailable + ' 个探针执行失败或离线');
      if (!rows.length) warnings.push('没有返回可用探针');
      if (probe.missing && probe.missing.length) warnings.push('缺少运营商探针：' + probe.missing.join('、'));
    }
  }
  if (['media', 'regions'].includes(module)) {
    const unknown = media.filter((item) => item.status === 'unknown').map((item) => item.name);
    if (unknown.length) warnings.push('端点状态未确认：' + unknown.join('、'));
  }
  return { completion: warnings.length ? 'partial' : 'complete', warnings: uniqueValues(warnings), measurement };
}
