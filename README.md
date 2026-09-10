# מנהל סדרי הלימוד — Study Session Manager

Study session tracker, Hebrew RTL. Currently a Google Apps Script app
(`apps-script/`), being migrated to a static site with a Worker proxy in
front of it; Apps Script stays on as a temporary API layer. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/DECISIONS.md](docs/DECISIONS.md) for the how and the why.

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

Runs all 225 tests in `tests/` against the real `.gs` source with
stubbed Apps Script globals.
