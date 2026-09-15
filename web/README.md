# Static site — deploy and cutover

This is step 3 of 3 of the migration described in
[docs/DECISIONS.md](../docs/DECISIONS.md) #15. `web/index.html` is a
straight copy of `apps-script/Index.html` with only the transport
rewritten (`google.script.run` → `fetch` against the Worker from step
2) and the PWA bits made real (a real manifest, a real icon file, a
service worker). Every call site, every button, every toast is
otherwise unchanged.

`apps-script/Index.html` is **not deleted** and keeps working exactly
as it does today — it's the fallback until this is confirmed working.

## ⚠️ Cutover order — read this before touching the Apps Script deployment

Doing these out of order exposes the app publicly, even briefly.
Follow this exact sequence:

**a. Deploy `web/` to Pages and confirm it loads.** The Apps Script
   deployment is still "Only myself" at this point — every `/api/*`
   call from the new site will correctly fail with the "Only myself"
   error (see `worker/README.md`'s checklist). That's expected; you're
   only confirming the *page itself* loads, looks right, and the
   Worker is reachable (even if it can't reach Apps Script yet).

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

After (d), the Worker can reach Apps Script as an authenticated
caller, and `web/`'s copy of the app is the one actually being used.
`apps-script/Index.html` stays in the repo as the fallback, but
nothing should be linking to the old `/exec` URL as the app entry
point anymore.

## Before deploying: point `web/` at your Worker

Edit the `<meta name="api-base">` tag near the top of `web/index.html`:

```html
<meta name="api-base" content="https://sidrei-limud-api.YOUR-SUBDOMAIN.workers.dev">
```

Replace the URL with your actual Worker URL from `worker/README.md`
step 4. No secret goes here — the API token lives only in the Worker,
injected server-side; this is just an address.

## Same-origin vs. cross-origin — which one you get by default

`worker/src/index.js` does not send CORS headers. That's deliberate
for now, matching DECISIONS.md #15's framing of the Worker as living
"on the user's own domain" — i.e. the intended setup is Pages and the
Worker sharing one domain, which makes every `/api/*` call same-origin
and CORS irrelevant. Two ways to get there:

- **Recommended: a Cloudflare custom domain with a Worker Route.** If
  you have (or add) a domain in Cloudflare, point Pages at it (Pages
  project → Custom domains), then add a Route in the Worker's settings
  matching `yourdomain.com/api/*` pointed at this Worker. `api-base` in
  `web/index.html` can then just be an empty string or `""` and every
  `/api/...` call resolves relative to the page itself — genuinely
  same-origin, no CORS involved at any point.

- **Quick testing without a domain, on the free `*.pages.dev` /
  `*.workers.dev` URLs.** These are two different origins, so a
  cross-origin `fetch` from the Pages site to the Worker **will be
  blocked by the browser** — `worker/src/index.js` doesn't answer a
  CORS preflight or send `Access-Control-Allow-Origin`. If you deploy
  this way for a first test, expect `fetch` calls in the browser
  console to fail with a CORS error, not the "Only myself" message
  from the checklist in `worker/README.md`. That's a known, current
  gap — not yet fixed here — and this file is intentionally not
  wiring around it, since the fix belongs in `worker/src/index.js`,
  deliberately, rather than worked around from this side. If you hit
  this, that's the thing to fix next, not a sign anything below is
  wrong.

## Deploying `web/` to Cloudflare Pages

This guide assumes you've used `wrangler` exactly once before (from
`worker/README.md`'s setup) — logged in already, `wrangler` installed
globally.

From the project root (not `worker/`):

```bash
wrangler pages deploy web --project-name=sidrei-limud
```

The first time you run this for a new project name, Wrangler creates
the Pages project and asks a couple of prompts (which Git branch this
upload counts as — accept the default, `main`, unless you know you
want something else). It then uploads everything in `web/` as static
files and gives you a `*.pages.dev` URL — open that to do step (a) of
the cutover order above.

To publish any later change to `web/`, run the exact same command
again — it uploads the current contents of `web/` as a new deployment
under the same project.

### Custom domain (recommended — see "Same-origin vs. cross-origin" above)

In the Cloudflare dashboard: **Workers & Pages → sidrei-limud (the
Pages project) → Custom domains → Set up a custom domain**, and follow
the prompts for a domain already in your Cloudflare account. Then, to
mount the Worker at `/api/*` on that same domain: **Workers & Pages →
sidrei-limud-api (the Worker) → Settings → Domains & Routes → Add →
Route**, with the route pattern `yourdomain.com/api/*`.

### Local preview before deploying

```bash
wrangler pages dev web
```

Serves `web/` locally (default `http://localhost:8788`) so you can
click through the UI before publishing. `fetch` calls to `api-base`
still go out over the real network to whatever Worker URL is
configured — this does not stub or mock the Worker.

## Tests

`tests/ui_test.js` covers the new transport (`call()`/`rpcFetch`
posting to the right URL with the right body, surfacing `{ok:false}`
as an error toast, and asserting `google.script.run` appears nowhere
in `web/index.html`) alongside its existing `apps-script/Index.html`
render tests — `npm test` runs both. There is no way to test the
Pages deployment itself without actually deploying it; the cutover
order above is the closest thing to a dry run.
