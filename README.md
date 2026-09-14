# מנהל סדרי הלימוד — Study Session Manager

Study session tracker, Hebrew RTL. Currently a Google Apps Script app
(`apps-script/`), being migrated to a static site with a Worker proxy in
front of it; Apps Script stays on as a temporary API layer. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/DECISIONS.md](docs/DECISIONS.md) for the how and the why.

## ⚠️ Deployment ordering — do not change out of order

The Apps Script deployment must stay **"Execute as: Me / Only myself"**
until the legacy UI (`doGet` → `Index.html`) is disabled or removed.

`Api.gs`'s `doPost` is token-gated, but `doGet` is not — it never needed
to be, because "Only myself" already means no one else can reach it. The
moment the deployment is switched to **"Anyone"** (required for the
Worker to call `doPost` cross-origin), `doGet` starts serving the full
UI to anyone with the URL too, and that UI calls every function through
`google.script.run` with **no token at all**.

So: switch to "Anyone" only after running `disableLegacyUi()` (see
`Code.gs` / `docs/ARCHITECTURE.md` §4) — or after `doGet` is removed for
good, later in the migration. Until then, `doPost`'s token check is not
the only thing standing between the internet and this spreadsheet;
"Only myself" is doing real work too.

## Setup

```bash
git config core.hooksPath .githooks
```

`.githooks` is tracked in the repo, but `core.hooksPath` is local git
config and isn't set automatically by cloning — run this once per clone
so the pre-commit secret-scan hook actually runs.

```bash
npm test
```

Runs every suite in `tests/` against the real `.gs` source with stubbed
Apps Script globals.
