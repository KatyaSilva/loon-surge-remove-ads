/**
 * Surge port of MaYIHEI/paperclip IP quality web test.
 * Upstream source/credits and MIT license: see README.md and LICENSE.
 * Generated deployment file: run node IPQuality/build.mjs to rebuild.
 */
(function () {
  'use strict';
  const VERSION = '2026.11.14';
  const ORIGIN = 'http://paperclip.test';
  const PAGE_URL = ORIGIN + '/ipquality';
  const SESSION_KEY = 'paperclip.ipquality.surge.session';
  const SESSION_TTL = 30 * 60 * 1000;
  const QUERY_CACHE_PREFIX = 'paperclip.ipquality.surge.query.';
  const QUERY_CACHE_TTL = 60000;
  const QUERY_CACHE_SLOTS = 32;
  const QUERY_CACHE_LIMIT = 64 * 1024;
  const PAGE_HTML = /* @PAGE_HTML */;
  const PAGE_CSP = /* @PAGE_CSP */;
  const MODULES = {
    basic: { title: '基础信息', enabled: ['显示基础信息'] },
    types: { title: 'IP 类型属性', enabled: ['显示 IP 类型'] },
    scores: { title: '风险评分', enabled: ['显示风险评分'] },
    factors: { title: '风险因素', enabled: ['显示风险因素'] },
    egress: { title: '出口分流', enabled: ['显示出口分流'] },
    bgp: { title: 'BGP 信息', enabled: ['显示 BGP 信息'] },
    bgppath: { title: 'BGP 路径', enabled: ['显示目标前缀 BGP 路径'] },
    speed: { title: '节点 HTTPS 轻量测速', enabled: [] },
    inbound: { title: '外部探针入站路径', enabled: ['测试外部探针入站路径'] },
    ping: { title: '三网探针延迟', enabled: ['测试外部探针 Ping'] },
    mtr: { title: '外部探针 MTR', enabled: ['测试外部探针 MTR'] },
    stability: { title: 'HTTPS 稳定性', enabled: ['测试 HTTPS 稳定性'] },
    media: { title: '流媒体与 AI', enabled: ['执行媒体与 AI 检测', '显示媒体与 AI 结果'] },
    regions: { title: '地区一致性', enabled: ['执行媒体与 AI 检测', '显示地区一致性'] },
    status: { title: '数据状态', enabled: ['显示数据状态'] },
  };
  const nativeDone = $done;
  const nativeHTTP = typeof $httpClient === 'undefined' ? null : $httpClient;
  const storage = typeof $persistentStore === 'undefined' ? null : $persistentStore;
  let finished = false;
  let deadlineTimer;
  let cachedQueries = 0;
  let routingFallbacks = 0;

  function finish(value) {
    if (finished) return;
    finished = true;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    nativeDone(value);
  }

  function response(status, body, type, extra) {
    finish({ response: {
      status,
      headers: Object.assign({
        'Content-Type': type || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Vary': 'Origin, Sec-Fetch-Site',
      }, extra || {}),
      body: typeof body === 'string' ? body : JSON.stringify(body),
    } });
  }

  function error(status, message) {
    response(status, { ok: false, error: message });
  }

  function header(name) {
    const headers = $request.headers || {};
    const key = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
    return key ? String(headers[key]) : '';
  }

  function readSession() {
    try { return JSON.parse(storage.read(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function policyDefault() {
    return typeof $argument === 'string' ? $argument.trim() : '';
  }

  function validPolicy(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 1024
      && !/[\u0000-\u001f\u007f]/.test(value)
      && !/^REJECT(?:-|$)/i.test(value);
  }

  function policyList() {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => complete(null), 3500);
      function complete(data) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const policies = [{ value: 'DIRECT', label: 'DIRECT · 当前直连网络', kind: 'direct' }];
        const seen = new Set(['DIRECT']);
        function add(value, label, kind) {
          if (!validPolicy(value) || seen.has(value)) return;
          seen.add(value);
          policies.push({ value, label: String(label || value), kind });
        }
        const available = data && (Array.isArray(data.proxies) || Array.isArray(data['policy-groups']));
        if (available) {
          (data['policy-groups'] || []).forEach((name) => add(name, name, 'group'));
          (data.proxies || []).forEach((name) => add(name, name, 'proxy'));
          (data['external-policies'] || []).forEach((item) => {
            if (item && typeof item.identifier === 'string') {
              add(item.identifier, `${item.group || '外部订阅'} / ${item.name || '未命名节点'}`, 'external');
            }
          });
        } else if (validPolicy(policyDefault())) {
          add(policyDefault(), policyDefault(), 'configured');
        }
        resolve({
          policies,
          defaultPolicy: seen.has(policyDefault()) ? policyDefault() : '',
          warning: available ? '' : '无法读取完整节点列表。可在模块参数 policy 中填写已有节点或策略组名称后刷新。',
        });
      }
      try {
        if (typeof $httpAPI !== 'function') complete(null);
        else $httpAPI('GET', '/v1/policies', { include_external: true }, complete);
      } catch (_) { complete(null); }
    });
  }

  function newSession(policy) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return {
      id: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
      node: policy.value,
      label: policy.label,
      createdAt: Date.now(),
    };
  }

  function metadataCacheKey(method, options, session) {
    if (method !== 'get' || options['binary-mode'] || options.body !== undefined) return null;
    if (Object.keys(options.headers || {}).some((name) => /^(authorization|cookie)$/i.test(name))) return null;
    let url;
    try { url = new URL(options.url); } catch (_) { return null; }
    if (url.protocol !== 'https:') return null;
    const ipv4 = '(?:[0-9]{1,3}\\.){3}[0-9]{1,3}';
    const explicitIP = new RegExp('^/' + ipv4 + '/?$');
    const cacheable = (url.hostname === 'ipinfo.check.place' && explicitIP.test(url.pathname))
      || (url.hostname === 'ipwho.is' && explicitIP.test(url.pathname))
      || (url.hostname === 'ipinfo.io' && new RegExp('^/widget/demo/' + ipv4 + '/?$').test(url.pathname))
      || (url.hostname === 'api.ipapi.is' && new RegExp('^' + ipv4 + '$').test(url.searchParams.get('q') || ''))
      || (url.hostname === 'proxycheck.io' && new RegExp('^/v2/' + ipv4 + '/?$').test(url.pathname))
      || (url.hostname === 'stat.ripe.net' && /^\/data\/(network-info|prefix-overview|reverse-dns-ip|rpki-validation|looking-glass|routing-status)\/data\.json$/.test(url.pathname));
    if (!cacheable) return null;
    const identity = JSON.stringify([session.id, session.node, options.policy, options.url]);
    let hash = 2166136261;
    for (let index = 0; index < identity.length; index++) hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
    return { identity, slot: QUERY_CACHE_PREFIX + ((hash >>> 0) % QUERY_CACHE_SLOTS) };
  }

  function cachedMetadata(key) {
    if (!key || !storage) return null;
    try {
      const item = JSON.parse(storage.read(key.slot) || 'null');
      if (!item || item.identity !== key.identity || typeof item.body !== 'string') return null;
      const age = Date.now() - item.createdAt;
      return age >= 0 && age < QUERY_CACHE_TTL ? item : null;
    } catch (_) { return null; }
  }

  function cacheMetadata(key, err, reply, body) {
    if (!key || !storage || err || Number(reply && reply.status) !== 200 || typeof body !== 'string') return;
    if (new TextEncoder().encode(body).byteLength > QUERY_CACHE_LIMIT) return;
    try {
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || !Object.keys(parsed).length || parsed.error || parsed.success === false
        || /^(?:error|fail|failed)$/i.test(String(parsed.status || ''))) return;
      const headers = {};
      for (const [name, value] of Object.entries(reply.headers || {})) {
        if (name.toLowerCase() === 'content-type') headers[name] = value;
      }
      storage.write(JSON.stringify({ identity: key.identity, createdAt: Date.now(), status: 200, headers, body }), key.slot);
    } catch (_) { /* A cache failure must not change the original response. */ }
  }

  // Loon uses node + milliseconds; Surge uses policy + seconds.
  // Preserve upstream DIRECT requests for public IP databases and external probes.
  function bridgeHTTP(session) {
    const bridge = {};
    for (const method of ['get', 'post']) {
      bridge[method] = (options, callback) => {
        if (finished) return;
        const input = typeof options === 'string' ? { url: options } : options;
        const mapped = Object.assign({}, input);
        if (validPolicy(mapped.node)) mapped.policy = mapped.node;
        delete mapped.node;
        // Loon-only ALPN hint: Surge negotiates the protocol itself.
        delete mapped.alpn;
        if (Number.isFinite(Number(mapped.timeout))) {
          mapped.timeout = Math.max(0.25, Number(mapped.timeout) / 1000);
        }
        const key = metadataCacheKey(method, mapped, session);
        const cached = cachedMetadata(key);
        if (cached) {
          cachedQueries++;
          Promise.resolve().then(() => {
            if (!finished) callback(null, { status: cached.status, headers: cached.headers }, cached.body);
          });
          return;
        }
        try {
          const startedAt = Date.now();
          const budget = Number(mapped.timeout) || 5;
          const host = new URL(mapped.url).hostname;
          const canFallback = method === 'get' && mapped.policy === 'DIRECT' && session.node !== 'DIRECT'
            && ['stat.ripe.net', 'api.globalping.io', 'ipinfo.io', 'ipwho.is', 'ipregistry.co', 'api.ipregistry.co', 'proxycheck.io', 'www.ip2location.io', 'db-ip.com'].includes(host);
          const first = canFallback ? Object.assign({}, mapped, { timeout: Math.min(budget, 3) }) : mapped;
          const deliver = (err, reply, data) => {
            if (!finished) {
              cacheMetadata(key, err, reply, data);
              callback(err, reply, data);
            }
          };
          nativeHTTP[method](first, (err, reply, data) => {
            const remaining = budget - (Date.now() - startedAt) / 1000;
            const status = Number(reply && reply.status);
            if (!finished && canFallback && remaining > 0.25 && (err || status === 408 || status >= 500)) {
              routingFallbacks++;
              try { nativeHTTP[method](Object.assign({}, mapped, { policy: session.node, timeout: remaining }), deliver); }
              catch (fallbackError) { deliver(String(fallbackError), null, null); }
            } else deliver(err, reply, data);
          });
        } catch (err) { callback(String(err), null, null); }
      };
    }
    return bridge;
  }

  function enhanceHTML(html, name) {
    const layout = '<style>.report-section{content-visibility:visible!important;contain:none!important}'
      + '.section-body,.summary-card{contain:none!important}'
      + '.map-row{margin-top:7px;font-size:12px}.map-link{color:#0a84ff}'
      + '.map-note{color:#8e8e93;margin-left:8px;font-size:10px}</style>';
    if (name !== 'basic') return html + layout;
    const row = html.match(/(<div class="info-line"><span class="info-label">坐标<\/span><span class="info-value">([^<]+)<\/span><\/div>)/);
    const parts = row && row[2].match(/(\d+)°(\d+)′([\d.]+)″([NS]).*?(\d+)°(\d+)′([\d.]+)″([EW])/);
    if (!parts) return html + layout;
    const decimal = (d, m, s, direction) => (Number(d) + Number(m) / 60 + Number(s) / 3600) * (/[SW]/.test(direction) ? -1 : 1);
    const lat = decimal(...parts.slice(1, 5));
    const lon = decimal(...parts.slice(5, 9));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return html + layout;
    const url = `https://maps.apple.com/?ll=${lat.toFixed(6)},${lon.toFixed(6)}&amp;q=${encodeURIComponent('节点 IP 出口')}&amp;z=15&amp;t=m`;
    const link = `<div class="map-row"><a class="map-link" href="${url}" target="_blank" rel="noopener noreferrer">在 Apple 地图中查看</a><span class="map-note">IP 数据库估算位置</span></div>`;
    return html.replace(row[1], row[1] + link) + layout;
  }

  function runCheck(session, name, mask) {
    const config = MODULES[name];
    const start = Date.now();
    deadlineTimer = setTimeout(() => error(504, '本项检测超时，请稍后重试。'), 60000);
    const client = bridgeHTTP(session);
    if (name === 'speed') {
      runUpstreamSpeed((packet) => {
        try {
          const result = JSON.parse(packet.response.body);
          result.node = session.label;
          result.version = VERSION;
          result.cachedQueries = cachedQueries;
          response(packet.response.status, result);
        } catch (_) { error(502, '测速未返回有效报告。'); }
      }, { read: () => JSON.stringify(session) },
      { url: `${PAGE_URL}/api/speed?run=${session.id}` }, client);
      return;
    }
    const options = {
      read: (key) => key === '隐藏 IP' ? (mask ? 'true' : 'false')
        : config.enabled.includes(key) ? 'true' : 'false',
      write: () => false,
      remove: () => false,
    };
    runUpstreamEngine((result) => {
      if (!result || typeof result.htmlMessage !== 'string') {
        error(502, result && result.content || '检测未生成报告。');
        return;
      }
      response(200, {
        ok: true, module: name, title: config.title, node: session.label,
        elapsedMs: Date.now() - start, cachedQueries, routingFallbacks,
        completion: result.diagnostics && result.diagnostics.completion || 'complete',
        warnings: result.diagnostics && result.diagnostics.warnings || [],
        measurement: result.diagnostics && result.diagnostics.measurement || null,
        html: enhanceHTML(result.htmlMessage, name), version: VERSION,
      });
    }, options, { params: { node: session.node, displayNode: session.label, module: name,
      deadlineMs: ['inbound', 'ping', 'mtr'].includes(name) ? 55000 : 45000 } }, client,
    typeof $utils === 'undefined' ? {} : $utils,
    { post: () => {} });
  }

  function launcher() {
    const scriptName = String(typeof $script === 'undefined' ? '' : $script.name || '');
    const preset = /_Basic$/.test(scriptName) ? 'basic' : /_Risk$/.test(scriptName) ? 'risk'
      : /_Media$/.test(scriptName) ? 'media' : '';
    const url = PAGE_URL + (preset ? '?preset=' + preset : '');
    if (typeof $trigger === 'undefined' || $trigger !== 'auto-interval') {
      if (typeof $notification !== 'undefined') {
        $notification.post('节点 IP 质量检测', '', '点按打开网页，选择节点并开始检测。', { url });
      }
    }
    finish({ title: 'IP 质量检测', content: '点按通知打开网页\n' + url, icon: 'network', 'icon-color': '#0A84FF' });
  }

  async function route() {
    if (typeof $request === 'undefined') { launcher(); return; }
    const url = new URL($request.url);
    if (url.origin !== ORIGIN) { error(400, '无效的本地地址。'); return; }
    const method = String($request.method || 'GET').toUpperCase();
    if (url.pathname === '/ipquality') {
      if (method !== 'GET') { error(405, '请使用 GET 打开报告页。'); return; }
      response(200, PAGE_HTML, 'text/html; charset=utf-8', {
        'Content-Security-Policy': PAGE_CSP,
        'X-Frame-Options': 'SAMEORIGIN',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      });
      return;
    }
    // The local API has no public CORS access; browser requests must come from this page.
    const origin = header('Origin');
    const site = header('Sec-Fetch-Site');
    if ((origin && origin !== ORIGIN) || (site && !['same-origin', 'none'].includes(site))
      || header('X-IPQuality-Client') !== '1') {
      error(403, '请从本地 IP 检测网页发起请求。'); return;
    }
    if (url.pathname === '/ipquality/api/context' && method === 'GET') {
      const list = await policyList();
      response(200, Object.assign({ ok: true, version: VERSION }, list));
      return;
    }
    if (method !== 'POST') { error(405, '检测接口仅接受 POST。'); return; }
    let body;
    try { body = JSON.parse($request.body || '{}'); }
    catch (_) { error(400, '请求内容不是有效的 JSON。'); return; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      error(400, '无效的请求内容。'); return;
    }
    if (url.pathname === '/ipquality/api/session') {
      const list = await policyList();
      const policy = list.policies.find((item) => item.value === body.policy);
      if (!policy) { error(400, '节点或策略组不存在，请刷新列表后重新选择。'); return; }
      const session = newSession(policy);
      if (!storage || !storage.write(JSON.stringify(session), SESSION_KEY)) {
        error(500, '检测会话保存失败。'); return;
      }
      response(200, { ok: true, run: session.id, node: session.label, expiresIn: SESSION_TTL / 1000 });
      return;
    }
    if (url.pathname === '/ipquality/api/check') {
      if (!Object.prototype.hasOwnProperty.call(MODULES, body.module)) {
        error(400, '未知检测项目。'); return;
      }
      const session = readSession();
      if (!session || !session.node || !body.run || body.run !== session.id) {
        error(409, '检测会话无效，请重新开始检测。'); return;
      }
      const age = Date.now() - Number(session.createdAt);
      if (!Number.isFinite(age) || age < 0 || age > SESSION_TTL) {
        error(410, '检测会话已过期，请重新开始检测。'); return;
      }
      runCheck(session, body.module, body.mask === true);
      return;
    }
    error(404, '未知检测接口。');
  }

  route().catch((err) => {
    if (typeof $request === 'undefined') finish({ title: 'IP 质量检测', content: String(err), style: 'error' });
    else error(500, '检测启动失败：' + String(err && err.message || err));
  });

  function runUpstreamEngine($done, $persistentStore, $environment, $httpClient, $utils, $notification) {
    /* @ENGINE_BODY */
  }

  function runUpstreamSpeed($done, $persistentStore, $request, $httpClient) {
    /* @SPEED_BODY */
  }
})();
