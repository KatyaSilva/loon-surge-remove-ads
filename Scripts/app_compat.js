// Surge adapters for the collection's Umetrip, 12306 and Tonghuashun rules.
// Original rule logic: Kelee / RuCu6 and androidcn/userscripts.
(function () {
  'use strict';
  const mode = typeof $argument === 'string' ? $argument : '';
  const request = typeof $request === 'undefined' ? {} : $request;
  const response = typeof $response === 'undefined' ? {} : $response;

  function header(name) {
    const headers = request.headers || {};
    const key = Object.keys(headers).find((key) => key.toLowerCase() === name);
    return key ? String(headers[key]) : '';
  }

  if (mode === 'umetrip') {
    const rpid = header('rpid');
    return $done(rpid.includes('1000002') || rpid.includes('1000019') ? { status: 404 } : {});
  }

  if (mode === '12306') {
    const operations = new Set([
      'com.cars.otsmobile.integration.activityBanner',
      'com.cars.otsmobile.memberInfo.getMemberQa',
      'com.cars.otsmobile.newHomePage.initData',
      'com.cars.otsmobile.newHomePageBussData',
      'com.cars.otsmobile.paySuccBuss.bussEntryShow',
    ]);
    return $done(operations.has(header('operation-type')) ? { abort: true } : {});
  }

  if (mode === 'tonghuashun' && typeof response.body === 'string' && response.body) {
    let body;
    try { body = JSON.parse(response.body); } catch (_) { return $done({}); }
    if (!body || typeof body !== 'object' || !Array.isArray(body.data)) return $done({});
    const filtered = body.data.filter((item) => !(item && typeof item === 'object'
      && item.info && typeof item.info === 'object' && item.info.subject === 'ad'));
    if (filtered.length === body.data.length) return $done({});
    body.data = filtered;
    body.total = filtered.length;
    return $done({ body: JSON.stringify(body) });
  }

  return $done({});
})();
