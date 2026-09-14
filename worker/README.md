# Worker proxy — setup and deploy

This is step 2 of 3 of the migration described in
[docs/DECISIONS.md](../docs/DECISIONS.md) #15. It's a small Cloudflare
Worker that sits between the eventual static site and the Apps Script
API (`apps-script/Api.gs`). Nothing in `apps-script/` or `Index.html`
changes because of this — the existing app keeps working exactly as it
does today, untouched, for the whole rest of this step.

**⚠️ Before you touch the deployment's execute-as setting, read this
first:** the Apps Script deployment must stay **"Execute as: Me / Only
myself"** until the legacy UI (`doGet`) is disabled. See
[README.md](../README.md) and
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) §4 for why — this
Worker being ready to call the API is *not* the same as it being safe
to open the deployment to "Anyone" yet. That's step 3, not this one.

This guide assumes you've never used Cloudflare before.

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
