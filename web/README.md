# Static site — deploy and cutover

This is step 3 of 3 of the migration described in
[docs/DECISIONS.md](../docs/DECISIONS.md) #15. `web/index.html` is a
straight copy of `apps-script/Index.html` with only the transport
rewritten (`google.script.run` → `fetch` against `/api/*`) and the PWA
bits made real (a real manifest, a real icon file, a service worker).
Every call site, every button, every toast is otherwise unchanged.

The API proxy itself is **not** a standalone Worker — it's
[`web/functions/api/[[path]].js`](functions/api/%5B%5Bpath%5D%5D.js), a
Cloudflare Pages Function deployed together with the static files in
this directory. See "Same-origin by construction" below for why that
matters. (`worker/` still exists in the repo with the same logic; it's
superseded and marked as such in its own README — not part of this
deployment.)

`apps-script/Index.html` is **not deleted** and keeps working exactly
as it does today — it's the fallback until this is confirmed working.

## ⚠️ Cutover order — read this before touching the Apps Script deployment

Doing these out of order exposes the app publicly, even briefly.
Follow this exact sequence:

**a. Deploy `web/` to Pages and confirm it loads.** The Apps Script
   deployment is still "Only myself" at this point — every `/api/*`
   call from the new site will correctly fail with a message naming
   "Only myself" as the cause (that's `web/functions/api/[[path]].js`
   detecting the 401/login-page Apps Script sends an unauthenticated
   caller). That's expected; you're only confirming the *page itself*
   loads, looks right, and the Function is reachable (even if it can't
   reach Apps Script yet).

**b. Only then, set the Apps Script deployment's execute-as to
   "Anyone."** The instant you do this, `doGet` starts serving the
   full legacy UI — with no token check at all — to anyone with the
   `/exec` URL. This is the exposure window.

**c. Immediately run `disableLegacyUi()`** from the Apps Script
   editor. This closes the window from (b). Do not do anything else
   between (b) and (c) — no testing, no reading the response, nothing.
   Have the Apps Script editor open with `disableLegacyUi` already
   selected in the function picker *before* you do (b), so (c) is one
   click away. The window between (b) and (c) should be seconds, not
   minutes.

**d. Verify the old `/exec` URL no longer serves the app.** Open it in
   a browser (or `curl` it) — it should show the "moved" message from
   `disableLegacyUi()`, not the study tracker. If it still shows the
   app, something in (b) or (c) didn't take — do not consider the
   cutover done until this check passes.

After (d), the Pages Function can reach Apps Script as an
authenticated caller, and `web/`'s copy of the app is the one actually
being used. `apps-script/Index.html` stays in the repo as the
fallback, but nothing should be linking to the old `/exec` URL as the
app entry point anymore.

## Same-origin by construction — nothing to configure, nothing to add

`web/functions/api/[[path]].js` sends no CORS headers, and never
needs to: a Pages Function is served from the exact same origin as
the static site it deploys with, on *any* Pages URL — the free
`*.pages.dev` one included, no custom domain required. `/api/*` and
`index.html` are never a cross-origin pair, so there is no CORS
preflight, no `Access-Control-Allow-Origin`, and nothing to configure
before a first deploy. `web/index.html`'s `<meta name="api-base">` is
therefore just `content=""` — an empty string, so `fetch('' +
'/api/' + fn)` resolves as `/api/...`, relative to whatever origin the
page itself is loaded from. **Do not add CORS headers to the Function
"just in case."** If you ever see a CORS error calling `/api/*` from
this page, that means the two are somehow being served from different
origins — a deployment mistake to fix, not a reason to add headers
here.

A custom domain is still worth having for its own sake (a nicer URL
than `*.pages.dev`), but it plays no role in making `/api/*` reachable
— that already works without one.

## Deploying `web/` to Cloudflare Pages

This guide assumes you've used `wrangler` exactly once before —
logged in already (`wrangler login`), `wrangler` installed globally
(`npm install -g wrangler`).

### 1. Set both secrets on the Pages project

From the project root:

```bash
wrangler pages secret put SCRIPT_URL --project-name=sidrei-limud
```

Paste the Apps Script `/exec` URL when prompted.

```bash
wrangler pages secret put API_TOKEN --project-name=sidrei-limud
```

Paste the same token you set in Apps Script via `setApiToken(...)`
(`apps-script/Api.gs`) — generate one first if you haven't, e.g.
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

If the project `sidrei-limud` doesn't exist in Cloudflare yet, this
command creates it. Either way, both secrets become available to
`web/functions/api/[[path]].js` as `env.SCRIPT_URL` / `env.API_TOKEN`
— there's no separate Worker to configure.

### 2. Deploy

```bash
wrangler pages deploy web --project-name=sidrei-limud
```

The first time, Wrangler may ask which Git branch this upload counts
as — accept the default (`main`) unless you know you want something
else. It uploads everything in `web/` (including `functions/`) and
gives you a `*.pages.dev` URL — open that to do step (a) of the
cutover order above.

To publish any later change, run the exact same command again.

### Local preview before deploying

```bash
wrangler pages dev web
```

Serves `web/` locally (default `http://localhost:8788`), Function
included, so you can click through the UI before publishing. Secrets
set with `wrangler pages secret put` are available here too, once
you've run step 1 at least once. `fetch` calls still go out over the
real network to whatever `SCRIPT_URL` is configured — this does not
stub or mock Apps Script.

## Known gap carried over from the Worker version: the redirect logic is unverified against a live Apps Script

`web/functions/api/[[path]].js`'s manual-redirect handling (see the
comment at the top of that file) is the same logic that lived in
`worker/src/index.js`, and has the same status: exercised against
`tests/pages_function_test.js`'s stubbed `fetch`, not yet against a
real, live Apps Script `/exec` endpoint. `worker/README.md` has the
full writeup and three diagnostic `curl` commands for checking this
directly against Apps Script if a live call ever comes back non-JSON
without being the "Only myself" case — that section is still accurate
even though the Worker itself is superseded, since the redirect
behavior being diagnosed is Apps Script's, not the proxy's.

## Tests

`tests/ui_test.js` covers the new transport (`call()`/`rpcFetch`
posting to the right URL with the right body, surfacing `{ok:false}`
as an error toast, and asserting `google.script.run` appears nowhere
in `web/index.html`) alongside its existing `apps-script/Index.html`
render tests. `tests/pages_function_test.js` covers
`web/functions/api/[[path]].js` itself (token injection, non-JSON and
401 detection, the manual redirect, the Sefaria routes and their
cache) — `npm test` runs all three. There is no way to test the Pages
deployment itself without actually deploying it; the cutover order
above is the closest thing to a dry run.
