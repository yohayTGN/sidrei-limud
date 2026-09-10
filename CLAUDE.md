# Project rules

Study session tracker ("מנהל סדרי הלימוד"). Backend detail is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the reasoning behind these
rules is in [docs/DECISIONS.md](docs/DECISIONS.md) — read that before
changing anything a rule below touches.

## Language

All user-facing strings, comments in `.gs` files, and catalog data
(book names, sheet headers, sections) are in Hebrew and **must stay in
Hebrew**. Never translate them, including while refactoring or renaming
surrounding code. Code identifiers and docs (this file, `docs/`) are
English.

## No browser storage

`localStorage` and `sessionStorage` are blocked inside the Apps Script
iframe (`userCodeAppPanel`) and fail silently. Never use them, in this
codebase or the static-site migration — server-side state
(`PropertiesService`, the sheet) is what makes the phone-starts /
PC-finishes handoff work at all. See `docs/DECISIONS.md` #1.

## Sheet columns are append-only

New columns go at the end of a sheet's header row, never inserted in the
middle. Existing column indices (`G_*`, `P_*`, `L_*`, `C_*` in `Code.gs` /
`SefariaCatalog.gs`) must not shift — old rows are read by index, not by
header text, and a shifted index misreads every existing row silently.
See `docs/DECISIONS.md` #2.

## Never invent catalog numbers

Daf counts, chapter counts, and every other catalog total must come from
a verified source (Sefaria, or a hand-checked figure documented in
`docs/DECISIONS.md`). If a count isn't verified, it's `null` — never a
guess or a recollection-based estimate. A wrong number corrupts every
progress bar built from it, silently. See `docs/DECISIONS.md` #7.

## Tests are the safety net

`npm test` runs all 225 tests (`tests/test.js`, `ui_test.js`,
`catalog_test.js`, `backup_test.js`) against the real `.gs` source with
stubbed Apps Script globals. If a test fails, the code is wrong — fix the
code, or ask, but do not edit a test's expected value to make it pass.
Adjusting a test after a file move (e.g. its require path) is fine. See
`docs/DECISIONS.md` #16.

<!--
TODO: the original rule list had a fifth item, "Every logic change …",
that was cut off before it reached this file. Ask the project owner what
that rule should say and fill it in here.
-->
