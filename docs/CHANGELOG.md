# Changelog

## 2.3 — catalog synced from Sefaria
- `SefariaCatalog.gs`: pulls Bavli (37), Mishnah (63), Rambam (14 sefarim /
  83 halachot), Tanakh (39), Halacha, Machshava into a `Catalog` sheet.
- Book/section hierarchy: the sefer is the selectable book, halachot are
  position sections carrying a chapter `offset`.
- Talmud lengths derived by scanning zeros in `chapters`, not from `length`
  (fixes Tamid: 9 dapim, not 32).
- Hebrew gematria helpers, round-trip verified for 1..999.
- `getCatalog()` prefers the sheet, falls back to the built-in table.
- Header-schema guard: a mismatched sheet is ignored rather than misread.
- Retry on 5xx from Sefaria; per-title reporting names what failed.
- `Backup.gs`: weekly spreadsheet copy + JSON snapshot, 8 of each retained.

## 2.2 — app icon
- Generated PNG icon; `installIcon()` uploads to Drive and shares by link.
- `doGet` sets it via `setFaviconUrl` (the only hook into the top document).
- Manifest and apple-touch-icon tags added to `<head>` for post-migration use.

## 2.1 — schedule-first flow
- Targets became optional (`total = 0` means no target).
- Today card driven by `WeeklyPlan`: one button, no selects, no target prompts.
- Motzaei Shabbat ritual: week review, next-week planning, optional targets.
- Shabbat guard on the forgotten-session reminder email.
- Fixed: an explicit negative `total` fell through to the catalog default.

## 2.0 — catalog and seder
- Structured book catalog replacing free-text goals.
- Seder dimension (boker / tzohorayim / erev) across plan, log, calendar titles.
- Columns appended at the end; `migrateToV2()` backfills, idempotent.

## 1.0 — initial
- Sheets-backed study tracker, server-side session state, multi-goal sessions,
  Google Calendar sync, weekly trend / streak / daily distribution.
