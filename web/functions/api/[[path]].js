/**
 * ============================================================================
 *  web/functions/api/[[path]].js — Cloudflare Pages Function
 * ============================================================================
 *
 *  Level 1, step 2/3 of the migration (DECISIONS.md #15), moved from a
 *  standalone Worker (see worker/, now superseded — its README explains
 *  why) into a Pages Function. The `[[path]]` filename is Cloudflare
 *  Pages' catch-all route syntax: this one file handles every request
 *  under /api/* for the Pages project that web/ deploys as.
 *
 *  SAME-ORIGIN BY CONSTRUCTION: a Pages Function is served from the exact
 *  same origin as the static site it ships alongside — /api/* and
 *  index.html are the same scheme+host+port no matter which URL the
 *  project is reached at (the free *.pages.dev one included, not only a
 *  custom domain). There is therefore no cross-origin request here at
 *  all, and no CORS headers of any kind are needed, added, or missing —
 *  do not add Access-Control-Allow-Origin "just in case". If you ever see
 *  a CORS error calling this from web/index.html, that means web/ and
 *  this function were deployed as two separate origins, which is a
 *  deployment mistake to fix (serve them as one Pages project), not a
 *  reason to add CORS headers here.
 *
 *  Two jobs, unchanged from the Worker version:
 *
 *  1. POST /api/:fn — forwards to the Apps Script API (Api.gs's doPost),
 *     injecting the shared secret server-side. The browser never sees or
 *     sends a token; it only ever talks to this Function.
 *
 *  2. GET /api/sefaria/name / /api/sefaria/shape — a straight, cached proxy
 *     to sefaria.org, so free-text catalog search doesn't pay an Apps
 *     Script round-trip. This is the only reason these routes exist; they
 *     have nothing to do with the token or with Api.gs.
 *
 *  WHY text/plain to Apps Script, not application/json — this is about
 *  the Function-to-Apps-Script leg, unrelated to the same-origin note
 *  above: Apps Script has no CORS support at all — no OPTIONS handling,
 *  no way to set response headers on TextOutput. Only "simple" requests
 *  skip a preflight: GET, or POST with Content-Type: text/plain. A JSON
 *  content-type would trigger a preflight Apps Script can never answer.
 *  The JSON itself still travels as the body either way — Api.gs's
 *  doPost parses the raw string itself, regardless of what Content-Type
 *  says. Do not "fix" this to application/json; see DECISIONS.md #15 and
 *  apps-script/Api.gs's own header comment.
 *
 *  WHY the redirect is followed manually, not via fetch's redirect:
 *  'follow': Apps Script's web app POST endpoint responds with a redirect
 *  to script.googleusercontent.com. Per the Fetch spec, a 301/302 response
 *  to a POST request downgrades the follow-up request to GET and drops the
 *  body — exactly the request we need to preserve. 307/308 would keep POST
 *  and body under 'follow', but we don't control which Apps Script sends
 *  and don't want a silently-broken call the day that changes. Fetching
 *  with redirect: 'manual' and manually re-issuing the exact same method,
 *  body and headers at each hop guarantees POST + body survive regardless
 *  of the redirect's status code.
 * ============================================================================
 */

const FN_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const APPS_SCRIPT_TIMEOUT_MS = 25000;
const MAX_REDIRECTS = 5;

const SEFARIA_BASE = 'https://www.sefaria.org';
const SEFARIA_CACHE_TTL_SECONDS = 24 * 60 * 60;   // Sefaria asks not to be hammered; shape data rarely changes.

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'GET' &&
      (url.pathname === '/api/sefaria/name' || url.pathname === '/api/sefaria/shape')) {
    return handleSefariaProxy(url, context);
  }

  if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
    const fnName = url.pathname.slice('/api/'.length);
    return handleApiCall(fnName, request, env);
  }

  return jsonResponse({ ok: false, error: 'נתיב לא נמצא.' }, 404);
}

/* ==========================================================================
   1. /api/:fn — forwarded to Apps Script, with the token injected here
   ========================================================================== */

async function handleApiCall(fnName, request, env) {
  // האלייצ׳-ליסט האמיתי הוא ב-Api.gs; הבדיקה הזו היא היגיינה — דוחה שם
  // מפוקפק לפני שהוא בכלל מגיע לרשת, לא שכבת אבטחה עצמאית.
  if (!FN_NAME_RE.test(fnName)) {
    return jsonResponse({ ok: false, error: 'שם פונקציה לא תקין: ' + fnName }, 400);
  }

  if (!env.SCRIPT_URL || !env.API_TOKEN) {
    return jsonResponse({ ok: false, error: 'הפונקציה לא הוגדרה: חסר SCRIPT_URL או API_TOKEN.' }, 500);
  }

  let args;
  try {
    args = await request.json();
  } catch (err) {
    return jsonResponse({ ok: false, error: 'גוף הבקשה אינו JSON תקין.' }, 400);
  }
  if (!Array.isArray(args)) args = [];

  // הטוקן מוזרק כאן, בשרת — הלקוח (הדפדפן) לעולם לא שולח ולא רואה אותו.
  const outgoingBody = JSON.stringify({ token: env.API_TOKEN, fn: fnName, args: args });

  let res;
  try {
    res = await fetchFollowingRedirectsManually(env.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: outgoingBody
    }, APPS_SCRIPT_TIMEOUT_MS);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return jsonResponse({ ok: false, error: 'הבקשה ל-Apps Script חרגה מהזמן המוקצב (25 שניות).' }, 504);
    }
    return jsonResponse({ ok: false, error: 'לא ניתן להגיע ל-Apps Script.' }, 502);
  }

  return parseAppsScriptResponse(res);
}

/** מעביר תגובת Apps Script כמו שהיא — אבל רק אם היא באמת JSON. */
async function parseAppsScriptResponse(res) {
  const text = await res.text();

  // בודקים 401 לפני שמנסים בכלל לפענח JSON: Api.gs's doPost תמיד מחזיר
  // HTTP 200, אז 401 הוא תמיד סימן ל"Only myself" — גם אם הגוף שלו במקרה
  // כן מפוענח כ-JSON (למשל שגיאת Google גנרית), אסור להעביר אותו כמו שהוא.
  if (res.status === 401 || looksLikeGoogleLoginPage(text)) {
    return jsonResponse({
      ok: false,
      error: 'Apps Script חסם את הבקשה (HTTP ' + res.status + ', דף התחברות של Google או 401). ' +
             'כנראה שהפריסה עדיין "Only myself" — היא חייבת להיות "Anyone" ' +
             'כדי שהפונקציה תוכל לקרוא ל-API (ורק אחרי שה-UI הישן כובה — ' +
             'ראה web/README.md ו-docs/ARCHITECTURE.md §4).'
    }, 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'Apps Script החזיר תשובה שאינה JSON (HTTP ' + res.status + ').'
    }, 502);
  }

  // Api.gs's doPost עצמו כבר מחזיר תמיד { ok, ... } ב-HTTP 200 — מעבירים כמו שהוא.
  return jsonResponse(parsed, 200);
}

/** היגיינה בזיהוי דף התחברות של Google — לא מדויק, אבל ספציפי מספיק. */
function looksLikeGoogleLoginPage(text) {
  return /accounts\.google\.com/i.test(text) ||
         /ServiceLogin/i.test(text) ||
         /<title>\s*Sign in/i.test(text);
}

/* ==========================================================================
   2. /api/sefaria/* — straight, cached proxy to sefaria.org
   ========================================================================== */

function buildSefariaUrl(url) {
  if (url.pathname === '/api/sefaria/name') {
    const q = url.searchParams.get('q');
    if (!q) return null;
    return new URL(SEFARIA_BASE + '/api/name/' + encodeURIComponent(q));
  }
  if (url.pathname === '/api/sefaria/shape') {
    const title = url.searchParams.get('title');
    if (!title) return null;
    const target = new URL(SEFARIA_BASE + '/api/shape/' + encodeURIComponent(title));
    url.searchParams.forEach(function (v, k) { if (k !== 'title') target.searchParams.set(k, v); });
    return target;
  }
  return null;
}

async function handleSefariaProxy(url, context) {
  const target = buildSefariaUrl(url);
  if (!target) return jsonResponse({ ok: false, error: 'נתיב Sefaria לא נתמך.' }, 404);

  const cache = caches.default;
  const cacheKey = new Request(target.toString(), { method: 'GET' });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let res;
  try {
    res = await fetchWithTimeout(target.toString(), { method: 'GET' }, APPS_SCRIPT_TIMEOUT_MS);
  } catch (err) {
    return jsonResponse({ ok: false, error: 'לא ניתן להגיע ל-Sefaria.' }, 502);
  }

  const text = await res.text();
  const response = new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=' + SEFARIA_CACHE_TTL_SECONDS
    }
  });

  if (res.status === 200) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

/* ==========================================================================
   3. עזרים
   ========================================================================== */

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * כמו fetchWithTimeout, אבל עוקב אחרי הפניות (3xx) בעצמו — עם אותה שיטה,
 * גוף וכותרות בכל קפיצה — במקום להסתמך על redirect:'follow', שעלול להפוך
 * POST ל-GET ולזרוק את הגוף. ראה את הערת הכותרת של הקובץ.
 *
 * redirect:'manual' בדפדפן רגיל מחזיר תגובה "אטומה" (status=0, בלי
 * headers) שאי אפשר לקרוא ממנה Location בכלל — אבל בזמן-הריצה של
 * Cloudflare (Workers ו-Pages Functions גם yes) ה-fetch החלופי חושף את
 * קוד הסטטוס וה-headers האמיתיים גם ב-manual, בכוונה, בשביל התבנית הזו.
 * אם זה אי-פעם רץ מחוץ לזמן-הריצה הזה, זה יישבר בשקט (status תמיד 0).
 */
async function fetchFollowingRedirectsManually(url, options, timeoutMs) {
  let currentUrl = url;
  let hops = 0;

  while (true) {
    const res = await fetchWithTimeout(currentUrl, Object.assign({}, options, { redirect: 'manual' }), timeoutMs);
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = isRedirect ? res.headers.get('location') : null;

    if (!location || hops >= MAX_REDIRECTS) return res;

    currentUrl = new URL(location, currentUrl).toString();
    hops++;
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
