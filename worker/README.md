# Worker proxy — superseded, kept for now

**⚠️ This standalone Worker is superseded by
[`web/functions/api/[[path]].js`](../web/functions/api/%5B%5Bpath%5D%5D.js),
a Cloudflare Pages Function with identical logic, deployed alongside
the static site in `web/` instead of as a separate Worker. That's the
active code path now — see [web/README.md](../web/README.md).**

The reason for the move: this Worker sent no CORS headers, so calling
it from `web/index.html` only worked without a browser CORS error if
the site and the Worker shared an origin — which required a custom
domain plus a Worker Route, an extra manual step. A Pages Function is
served from the exact same origin as the static site it ships with,
on *any* Pages deployment (including the free `*.pages.dev` URL, no
custom domain needed) — so the same proxy logic works with no CORS
headers needed anywhere, by construction, not by configuration.

This directory is kept in the repo, unmodified and still deployable,
until the Pages Function deploy is confirmed working end to end — at
which point it gets deleted along with this file. Don't build on top
of this Worker in the meantime; make any further changes to the Pages
Function version instead, which is what `tests/pages_function_test.js`
now covers (this Worker's own dedicated test file was renamed and
retargeted along with the move — there's no separate `worker_test.js`
anymore).

---

This was step 2 of 3 of the migration described in
[docs/DECISIONS.md](../docs/DECISIONS.md) #15. It's a small Cloudflare
Worker that sits between the eventual static site and the Apps Script
API (`apps-script/Api.gs`). Nothing in `apps-script/` or `Index.html`
changes because of this — the existing app keeps working exactly as it
does today, untouched.

**⚠️ Before you touch the deployment's execute-as setting, read this
first:** the Apps Script deployment must stay **"Execute as: Me / Only
myself"** until the legacy UI (`doGet`) is disabled. See
[README.md](../README.md) and
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) §4 for why — this
Worker being ready to call the API is *not* the same as it being safe
to open the deployment to "Anyone" yet. That's step 3, not this one.

This guide assumes you've never used Cloudflare before.

## Quick checklist: test the pipeline without exposing the app

This is the short version — enough to prove the Worker can reach Apps
Script, without changing anything the rest of the app depends on.

> **🛑 Do NOT switch the Apps Script deployment to "Anyone" for any of
> this.** Leave it on **"Execute as: Me / Only myself"** for every step
> below — that setting is not part of what this checklist tests.
> "Anyone" is the *last* step of the whole migration, and only after
> `disableLegacyUi()` has been run (see `README.md` and
> `docs/ARCHITECTURE.md` §4). Until then, **every call below is
> expected to fail with the Google-login-page error** —
> `{"ok":false,"error":"...Only myself..."}`. That is the correct,
> expected result at this stage. It is not a bug, and it is not a sign
> anything below is broken — it's Apps Script correctly refusing an
> unauthenticated caller, which is exactly what "Only myself" is
> supposed to do.

1. Install and log in to Wrangler:

   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. From `worker/`, set both secrets (see "Get the two values you'll
   need" below for what goes in each):

   ```bash
   wrangler secret put SCRIPT_URL
   wrangler secret put API_TOKEN
   ```

3. Deploy:

   ```bash
   wrangler deploy
   ```

4. Test one harmless, read-only call — `getCatalog` reads nothing from
   the spreadsheet and changes nothing:

   ```bash
   curl -sS -X POST https://<your-worker>.workers.dev/api/getCatalog \
     -H 'Content-Type: application/json' \
     -d '[]'
   ```

   What each outcome means:

   | Response | Meaning |
   |---|---|
   | `{"ok":true,"data":[...]}` (an array of catalog categories) | Everything works end to end, right now, while still "Only myself". This can only happen if the deployment is already "Anyone" — if you haven't changed it, you should not be seeing this yet. |
   | `{"ok":false,"error":"...Only myself..."}` (mentions a Google sign-in page) | **Expected right now.** The Worker reached Apps Script, but Apps Script correctly refused it because the deployment is still "Only myself". This confirms the Worker and both secrets are wired up correctly — it just can't authenticate yet, by design. |
   | `{"ok":false,"error":"ה-Worker לא הוגדר..."}` (Worker not configured) | One or both secrets aren't set on the Worker — redo step 2, then step 3 again. |
   | `{"ok":false,"error":"...Apps Script החזיר תשובה שאינה JSON..."}` (not specifically a login page) | Apps Script responded with something unexpected that also isn't JSON. See "Unverified: the redirect behavior" below — this is the first thing to check. |
   | `{"ok":false,"error":"...חרגה מהזמן המוקצב..."}` (timeout) | No response from Apps Script within 25s — check `SCRIPT_URL` is the right `/exec` URL. |
   | curl itself fails (connection error, 404 from `*.workers.dev`) | The Worker isn't deployed, or the URL is wrong — recheck step 3's output. |

## ⚠️ Unverified: the POST-redirect behavior against the real Apps Script

`worker/src/index.js` follows Apps Script's redirect (to
`script.googleusercontent.com`) manually rather than via
`redirect: 'follow'`, specifically so the POST method and body survive
the hop — see the comment at the top of that file for the reasoning.
**That reasoning has not been confirmed against a real, live Apps
Script deployment yet** — only against `tests/worker_test.js`'s stubbed
`fetch`, which returns exactly the redirect shape the code expects it
to. A real `/exec` endpoint could behave differently in some way the
stub doesn't capture.

If the first live call comes back as `{"ok":false,"error":"...Apps
Script החזיר תשובה שאינה JSON..."}` (and it isn't the login-page
message above), the redirect handling is the first thing to check —
specifically, whether Apps Script's 302 actually needs POST+body
preserved, or whether it works fine as GET. To compare directly against
Apps Script (bypassing the Worker), with `SCRIPT_URL` and `API_TOKEN`
set as shell variables:

```bash
# See the raw redirect without following it — confirms the status code
# and Location header Apps Script actually sends for a POST:
curl -sS -i -X POST "$SCRIPT_URL" \
  -H 'Content-Type: text/plain' \
  -d "{\"token\":\"$API_TOKEN\",\"fn\":\"getCatalog\",\"args\":[]}"

# curl's default -L converts POST to GET on a 301/302 (same risk the
# Worker's manual redirect is meant to avoid) — this is "following with GET":
curl -sS -L -X POST "$SCRIPT_URL" \
  -H 'Content-Type: text/plain' \
  -d "{\"token\":\"$API_TOKEN\",\"fn\":\"getCatalog\",\"args\":[]}"

# --post302 forces curl to preserve POST + body across the redirect —
# this is "replaying the POST", matching what the Worker's manual
# redirect logic is supposed to do:
curl -sS -L --post302 -X POST "$SCRIPT_URL" \
  -H 'Content-Type: text/plain' \
  -d "{\"token\":\"$API_TOKEN\",\"fn\":\"getCatalog\",\"args\":[]}"
```

If the `--post302` version returns real JSON and the plain `-L` version
doesn't, that confirms Apps Script does need the method and body
preserved — i.e. the Worker's manual-redirect approach is necessary and
correct. If both return the same thing, the redirect may not be the
issue and the non-JSON response has some other cause worth chasing
down before assuming the redirect logic is at fault.

## 1. Create a Cloudflare account

If you don't have one: [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
The free plan is enough for this — Workers has a generous free tier and
nothing here needs a paid plan.

## 2. Install Wrangler (Cloudflare's CLI)

Wrangler is the tool that deploys a Worker from your machine. You need
Node.js installed already (you already do, for `npm test`).

```bash
npm install -g wrangler
```

Then log in — this opens a browser window to authorize Wrangler against
your Cloudflare account:

```bash
wrangler login
```

## 3. Get the two values you'll need

You'll be asked for two secrets in step 5. Have them ready:

- **`SCRIPT_URL`** — your Apps Script web app's URL. It's the `/exec`
  URL from Apps Script's **Deploy → Manage deployments** screen —
  something like `https://script.google.com/macros/s/AKfyc.../exec`.
- **`API_TOKEN`** — a secret string *you* make up (a long random
  password works fine — e.g. generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
  This same value must be set in Apps Script by running, once, from the
  Apps Script editor:

  ```js
  setApiToken('the-same-random-string-you-just-generated')
  ```

  (That function is in `apps-script/Api.gs`. Run it once from the
  editor's function picker, not from anywhere else — see the comment on
  `setApiToken` for why it must never be committed anywhere.)

Both values are secrets. Neither goes in `wrangler.toml`, in this repo,
or anywhere else committed — see the comment block at the top of
[`wrangler.toml`](wrangler.toml).

## 4. Deploy the Worker for the first time

From this `worker/` directory:

```bash
cd worker
wrangler deploy
```

The first `wrangler deploy` creates the Worker on Cloudflare (using the
`name` in `wrangler.toml`) and gives you its `*.workers.dev` URL. The
Worker will run, but every call will fail until you set the secrets in
the next step — it checks for them and returns a clear error
(`"ה-Worker לא הוגדר"`) rather than doing anything silently wrong.

## 5. Set the two secrets

Still from `worker/`:

```bash
wrangler secret put SCRIPT_URL
```

Paste the Apps Script `/exec` URL when prompted, press Enter.

```bash
wrangler secret put API_TOKEN
```

Paste the same random token you used with `setApiToken(...)` in step 3,
press Enter.

Each `wrangler secret put` uploads the value straight to Cloudflare,
encrypted — it is never written to any file on your machine or in this
repo. You can run either command again later with a new value (e.g. if
a token leaks) to rotate it; that also means re-running `setApiToken`
in Apps Script with the matching new value.

## 6. Redeploy so the Worker picks up the secrets

```bash
wrangler deploy
```

(Setting a secret doesn't require a redeploy in general, but doing one
now is a good way to confirm everything's wired up before you rely on
it.)

## 7. Try it

```bash
curl -X POST https://<your-worker>.workers.dev/api/getCatalog \
  -H 'Content-Type: application/json' \
  -d '[]'
```

You should get back `{"ok":true,"data":[...]}`. If instead you get
`{"ok":false,"error":"..."}` mentioning a Google sign-in page or "Only
myself" — that means the Apps Script deployment's execute-as setting
is still (correctly, per the warning at the top of this file) "Only
myself", so the Worker can't reach it yet as an authenticated caller.
That's expected until step 3 changes that setting deliberately, with
`doGet` disabled first.

## Running the Worker locally, before deploying

```bash
wrangler dev
```

This runs the Worker on your machine (`http://localhost:8787` by
default) against the real Cloudflare runtime, so you can `curl` it the
same way as in step 7 without deploying anything. Secrets set with
`wrangler secret put` are available in `wrangler dev` too, once you've
run step 5 at least once.

## Tests

The Worker's logic is covered by `tests/worker_test.js` in the project
root (`npm test` or `npm run test:worker`) — no Cloudflare account or
network access needed; `fetch` and the Cache API are both stubbed. That
suite is what to run after changing anything in `src/index.js`, before
`wrangler deploy`.
