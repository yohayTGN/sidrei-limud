/* Node harness for worker/src/index.js. That file is an ES module (Cloudflare
   Workers require the "modules" format); this test file is CommonJS like
   every other suite, so it loads the worker via dynamic import() inside an
   async IIFE instead of eval-ing source text the way the apps-script suites
   do. No network: fetch and the Cache API are both stubbed in-memory. */

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? '  ✓ ' : '  ✗ ') + label +
    (ok ? '' : `   got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`));
  ok ? pass++ : fail++;
}

/* ---- fetch stub: records every outgoing call, answers per-test --------- */
let FETCH_CALLS = [];
let FETCH_HANDLER = null;
global.fetch = async (url, options) => {
  FETCH_CALLS.push({ url: String(url), options: options || {} });
  return FETCH_HANDLER(String(url), options || {});
};

/* ---- Cache API stub: an in-memory map keyed by request URL ------------- */
function makeFakeCache() {
  const store = new Map();
  return {
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      const hit = store.get(key);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      const key = typeof req === 'string' ? req : req.url;
      store.set(key, res.clone());
    },
    _store: store
  };
}
global.caches = { default: makeFakeCache() };

function makeCtx() {
  const waited = [];
  return { waitUntil: (p) => waited.push(p), _flush: () => Promise.all(waited) };
}

const ENV = { SCRIPT_URL: 'https://script.google.com/macros/s/FAKE_ID/exec', API_TOKEN: 'the-shared-secret' };

function jsonRes(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}
function htmlRes(html, status) {
  return new Response(html, { status: status || 200, headers: { 'Content-Type': 'text/html' } });
}
function redirectRes(location, status) {
  return new Response('', { status: status || 302, headers: { Location: location } });
}

(async function main() {
  const worker = (await import('../worker/src/index.js')).default;

  function post(path, bodyArray) {
    FETCH_CALLS = [];
    const req = new Request('https://example.com' + path, {
      method: 'POST',
      body: JSON.stringify(bodyArray)
    });
    return worker.fetch(req, ENV, makeCtx());
  }
  function get(path) {
    const req = new Request('https://example.com' + path, { method: 'GET' });
    const ctx = makeCtx();
    return { res: worker.fetch(req, ENV, ctx), ctx };
  }

  console.log('\n--- token is injected server-side, never present in what the client sent ---');
  FETCH_HANDLER = () => jsonRes({ ok: true, data: 'hi' });
  let res = await post('/api/getCatalog', []);
  let body = await res.json();
  eq('worker forwards ok:true through unchanged', body, { ok: true, data: 'hi' });
  eq('exactly one outgoing call', FETCH_CALLS.length, 1);
  eq('outgoing call goes to SCRIPT_URL', FETCH_CALLS[0].url, ENV.SCRIPT_URL);
  eq('outgoing call is POST', FETCH_CALLS[0].options.method, 'POST');
  eq('outgoing call is sent as text/plain, not application/json (no CORS preflight)',
    FETCH_CALLS[0].options.headers['Content-Type'], 'text/plain;charset=utf-8');
  const sentBody = JSON.parse(FETCH_CALLS[0].options.body);
  eq('the token the worker sent matches env.API_TOKEN', sentBody.token, ENV.API_TOKEN);
  eq('fn name forwarded correctly', sentBody.fn, 'getCatalog');

  // The client's own body is just the args array — it has no say over the
  // token at all, so even a client trying to smuggle one in is harmless:
  // it just becomes a value inside args, never the top-level token field.
  FETCH_CALLS = [];
  res = await post('/api/getCatalog', [{ token: 'a-client-supplied-value' }]);
  const smuggled = JSON.parse(FETCH_CALLS[0].options.body);
  eq('client-supplied "token" stays inside args, never overrides the real one',
    smuggled.token, ENV.API_TOKEN);
  eq('...and is passed through untouched as ordinary data', smuggled.args, [{ token: 'a-client-supplied-value' }]);

  console.log('\n--- an HTML response from Apps Script becomes { ok:false, error } ---');
  FETCH_HANDLER = () => htmlRes('<html><body>Something broke</body></html>', 500);
  res = await post('/api/getCatalog', []);
  body = await res.json();
  eq('never passed through raw', body.ok, false);
  eq('has a Hebrew error message, not the raw HTML', typeof body.error === 'string' && body.error.indexOf('<html>') === -1, true);

  console.log('\n--- a login-page response produces the "still Only myself" message ---');
  FETCH_HANDLER = () => htmlRes(
    '<html><title>Sign in - Google Accounts</title><body>' +
    'Redirecting to accounts.google.com/ServiceLogin</body></html>', 302);
  res = await post('/api/getCatalog', []);
  body = await res.json();
  eq('rejected', body.ok, false);
  eq('names "Only myself" specifically', body.error.indexOf('Only myself') > -1, true);

  console.log('\n--- a bad :fn is rejected before any fetch happens ---');
  FETCH_HANDLER = () => { throw new Error('should never be called'); };
  res = await post('/api/sync Catalog!', []);
  body = await res.json();
  eq('rejected', body.ok, false);
  eq('no network call was made', FETCH_CALLS.length, 0);
  res = await post('/api/123abc', []);   // must start with a letter
  eq('a name starting with a digit is also rejected', (await res.json()).ok, false);
  eq('still no network call', FETCH_CALLS.length, 0);

  console.log('\n--- the redirect to script.googleusercontent.com is followed manually ---');
  let hop = 0;
  FETCH_HANDLER = (url, options) => {
    hop++;
    if (hop === 1) return redirectRes('https://script.googleusercontent.com/echo', 302);
    return jsonRes({ ok: true, data: JSON.parse(options.body).fn });
  };
  hop = 0;
  res = await post('/api/getCatalog', []);
  body = await res.json();
  eq('followed exactly one redirect (two fetches total)', FETCH_CALLS.length, 2);
  eq('second hop went to the redirect target', FETCH_CALLS[1].url, 'https://script.googleusercontent.com/echo');
  eq('second hop was still POST, not downgraded to GET', FETCH_CALLS[1].options.method, 'POST');
  eq('second hop carried the same body (proves the body survived the hop)',
    JSON.parse(FETCH_CALLS[1].options.body).fn, 'getCatalog');
  eq('final result comes from the redirect target, not the initial 302', body, { ok: true, data: 'getCatalog' });

  console.log('\n--- Apps Script call is aborted cleanly on timeout, not left to crash ---');
  FETCH_HANDLER = () => { const e = new Error('aborted'); e.name = 'AbortError'; return Promise.reject(e); };
  res = await post('/api/getCatalog', []);
  body = await res.json();
  eq('timeout becomes a clean ok:false, not an uncaught rejection', body.ok, false);
  eq('mentions the timeout', /25/.test(body.error) || /זמן/.test(body.error), true);

  console.log('\n--- sefaria routes hit the right URL, and are cached ---');
  global.caches.default = makeFakeCache();
  let sefariaCalls = 0;
  FETCH_HANDLER = (url) => {
    sefariaCalls++;
    return jsonRes({ heTitle: 'משנה תורה' }, 200);
  };
  let { res: p1, ctx: ctx1 } = get('/api/sefaria/name?q=' + encodeURIComponent('משנה תורה'));
  res = await p1;
  await ctx1._flush();
  body = await res.json();
  eq('name route hits sefaria.org/api/name/<q>',
    FETCH_CALLS[FETCH_CALLS.length - 1].url,
    'https://www.sefaria.org/api/name/' + encodeURIComponent('משנה תורה'));
  eq('response body passed through', body, { heTitle: 'משנה תורה' });
  eq('one real network call so far', sefariaCalls, 1);

  const { res: p2, ctx: ctx2 } = get('/api/sefaria/name?q=' + encodeURIComponent('משנה תורה'));
  res = await p2;
  await ctx2._flush();
  body = await res.json();
  eq('second identical call is served from cache, not a new fetch', sefariaCalls, 1);
  eq('cached response body matches', body, { heTitle: 'משנה תורה' });

  sefariaCalls = 0;
  const { res: p3, ctx: ctx3 } = get('/api/sefaria/shape?title=' + encodeURIComponent('Talmud/Bavli') + '&depth=1');
  res = await p3;
  await ctx3._flush();
  eq('shape route hits sefaria.org/api/shape/<title> and forwards other params',
    FETCH_CALLS[FETCH_CALLS.length - 1].url,
    'https://www.sefaria.org/api/shape/' + encodeURIComponent('Talmud/Bavli') + '?depth=1');
  eq('shape call also went to the real network once', sefariaCalls, 1);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
