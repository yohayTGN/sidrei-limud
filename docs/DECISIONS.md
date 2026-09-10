# Decisions

Why the system is built the way it is. Each entry records the reasoning, not
just the rule — so a future reader can tell whether a decision still holds.

Written before the migration to a static site began. Anything marked OPEN is
unresolved.

---

## 1. No `localStorage` or `sessionStorage`, ever

Apps Script serves `Index.html` inside a sandboxed nested iframe
(`userCodeAppPanel`). Browser storage APIs are blocked there and fail silently.

This turned out to be a benefit, not a limitation. The requirement was to start
a timer on a phone and write the summary on a PC. `localStorage` is per-device
and could never have done that. All live state lives server-side in
`PropertiesService`, which is what makes the handoff work at all.

**Rule:** never reintroduce browser storage, even after the migration away from
the iframe. The server remains the source of truth for session state.

---

## 2. Sheet columns are appended at the end, never inserted

The app was already deployed with real data when the schema grew (Seder in v2.0,
catalog fields, position fields). Inserting a column mid-sheet shifts every index
after it, so every existing row would be misread until a full rewrite succeeded.

Appending keeps `G_ID=9`, `P_ID=9`, `L_ID=12` exactly where v1 left them, so old
rows parse correctly with zero migration risk. The cost is that "סדר" sits to the
right of "מזהה" in the sheet, which reads oddly. That was accepted deliberately:
ugly column order over a risky rewrite.

`migrateToV2()` is idempotent — it only fills empty cells.

---

## 3. `StudyLog` is one row per goal per session

A single sitting can cover more than one book (switching mid-session is
supported). Each book gets its own row, grouped by a shared `SessionId`, so
Taanit and Rambam each carry their own position and summary.

`plannedMin` is written **only on the first row** of a session. Writing it on
every row would double-count planned time in the weekly adherence math.

---

## 4. A target is optional; `total = 0` means "no target"

Originally `saveGoal` threw if `total <= 0`. That made it impossible to record
"I'm learning Mesillat Yesharim" without first knowing how many chapters it has
— a hard blocker at the point of entry, for information the user often doesn't
have.

Now a book with no target simply accumulates units and shows no progress bar.
A progress bar with an invented denominator is a visual lie; showing a
cumulative count is honest.

---

## 5. The daily path is driven by the schedule, not by goal-setting

The original flow was: create a goal → set a target → then you may start. That
inverts the natural order. A person sits down at seder, opens the gemara they're
holding, and learns. How many pages the tractate has is an afterthought.

Now: the Today card reads the block from `WeeklyPlan`, the book is already
attached, and there is one button. There is no `<select>` in that path and no
mention of targets. Free study exists as an escape hatch behind a small link.

Book selection and target-setting moved into the weekly Motzaei Shabbat ritual.

---

## 6. Motzaei Shabbat is a separate mode, and 21:00 is a deliberate approximation

Two distinct usage modes: daily (one button) and weekly (review, plan, targets).
Mixing them is what produced decision 5's problem.

`isPlanningWindow()` opens Saturday at 21:00. The latest tzeit hakochavim in
Israel is around 20:30 in midsummer, so the banner can never appear on Shabbat.
In winter it appears roughly two hours later than it could.

**This is not a zmanim calculation.** It is a conservative fixed bound chosen to
never err on the wrong side. Replacing it with real sunset-based zmanim is a
known improvement, not a bug fix.

`isShabbatWindow()` is the mirror guard, blocking automated email from Friday
noon until Saturday 21:00. Tests assert the two windows never overlap.

---

## 7. The catalog never invents a number

Per-book unit counts are the denominator of every progress bar. A wrong number
corrupts the display silently and permanently.

Where a count could not be verified, the catalog stores `null` and the user fills
it in once. This applied to Mishneh Torah chapter counts before the Sefaria
integration; a recollection-based table summed to 1021 instead of the canonical
1000, which is exactly the failure mode this rule prevents.

Bavli daf counts were hand-verified against a documented total of 2,711 and later
independently confirmed by Sefaria. Both sources agree on all 37 tractates.

---

## 8. Talmud length comes from scanning zeros, not from `length`

Sefaria indexes Talmud by *amud*, starting at daf 1a, which does not exist — so
the first two entries of `chapters` are 0. Critically, a tractate that does not
begin at daf 2 is padded with zeros up to its real start: Tamid begins at 25b.

`ceil((length - 2) / 2)` gives Tamid 32 dapim instead of 9 — wrong by a factor of
four, with no error raised. `talmudRange()` therefore scans for the first and
last non-zero entry.

This also settled a genuine disagreement between sources: Tamid is 9 dapim
(25b–33b), matching the Daf Yomi cycle, not the 8 listed elsewhere.

---

## 9. Position is quantitative, and units are derived from it — DECIDED, NOT YET IMPLEMENTED

Current state: `StudyLog` stores `reached` as free text ("דף י״ב ע״ב")
alongside a separate numeric `units` field, hand-entered on the wrap-up
form, and `Goals.G_POS` holds display text. Both are entered by hand and
can contradict each other, with the progress bar trusting one and the
user trusting the other.

Decided design: position becomes a number, and units learned are computed
as the difference between two positions — the `units` field is removed
from the wrap-up form, since it becomes redundant with position rather
than an independent input. The summary form is to ask for position only.

Encoding: daf + 0.5 for amud bet, so `12.5` is דף י״ב ע״ב. This maps exactly onto
Sefaria's amud index and makes a difference times two equal the amud count.
For Rambam books, position uses the offset math in §10 — `positionToValue`
/ `valueToPosition` already exist in `SefariaCatalog.gs` for exactly this,
but nothing in `Code.gs` or the wrap-up form calls them yet (see
`docs/ARCHITECTURE.md` §3).

---

## 10. Rambam: the sefer is the book, halachot are sections

Numbering chapters per-halachot was chosen for display ("הלכות תשובה פרק ג׳").
That decision was initially over-applied, making each of the 83 halachot a
separate selectable book and flooding the picker.

The two levels are distinct: what you *learn* (one of the 14 sefarim) versus how
position is *numbered* (halachot + chapter). Each section stores an `offset` —
the chapter count preceding it — so a two-level position collapses to a single
running number. This is what makes a difference computable across a halachot
boundary.

**Excluded from the catalog:** the four introductions, the Steinsaltz node,
"קונטרס זיקה" (not part of the work, mis-filed under Sefer Nashim), and
"סדר התפילה" (an appendix to Sefer Ahavah, not one of the 83). With those
removed the count is exactly 83.

**OPEN:** chapter totals sum to 1001, not the canonical 1000. The halachot count
is exact. The one-chapter discrepancy is unexplained — possibly an edition
difference, possibly 1000 being a rounded traditional figure. It does not affect
the math, which uses per-halachot counts. Do not "fix" this by adjusting a number.

---

## 11. Bavli is 37 tractates, plus 3 manual entries

Only one tractate in Seder Zeraim (Berakhot) and one in Seder Tahorot (Niddah)
have Bavli gemara. That is why the count is 37 and not 63.

The Sefaria category returns 57 nodes; Minor Tractates, Guides and commentaries
are filtered out by `keepSections`.

Three are added manually because Sefaria correctly excludes them: Shekalim (the
tractate in the Shas is Yerushalmi), Middot and Kinnim (Mishnah only, no gemara).
All three are printed in the Shas and learned in Daf Yomi.

---

## 12. The catalog sheet is a cache; the built-in table is the fallback

`getCatalog()` prefers the synced `Catalog` sheet and falls back to the hardcoded
`CATALOG` in `Code.gs` if the sheet is missing, empty, or schema-mismatched. The
app works with no network and no Sefaria.

`readCatalogSheet()` validates the header row before reading. This guard exists
because a stale deployment reading a newer sheet misread every column silently —
showing "ללא יעד מובנה" everywhere and duplicating books. Falling back to a
complete built-in catalog beats displaying scrambled data.

Sefaria asks that the API not be used to bulk-download their dataset. The sync is
~15 calls, run manually every few months, cached in the sheet. Never call it from
`doGet`.

---

## 13. The app icon goes through `setFaviconUrl`, not the manifest

Browsers read `<link rel="manifest">` and `apple-touch-icon` only from the
top-level document. Under Apps Script that is Google's wrapper page, not our
HTML. Icon tags inside `Index.html` look correct and do nothing.

`HtmlOutput.setFaviconUrl()` is the only hook into the top document, and it needs
a real hosted URL — hence `installIcon()`, which uploads the PNG to Drive and
shares it by link.

The head tags remain anyway: they cost nothing and become correct once the app is
served outside the iframe.

---

## 14. Backups are two formats, weekly, on Sunday

The spreadsheet has built-in version history, which covers manual editing
mistakes. It covers code less well: `syncCatalog` calls `sheet.clear()`,
`saveWeekPlan` deletes rows, a bad deployment can overwrite.

A spreadsheet copy restores instantly; a JSON snapshot is portable and readable
without Google, and will make any future migration a read operation.

Sunday 05:00, not Motzaei Shabbat, so the backup captures the week after it has
been reviewed and the next one planned. Rotation keeps 8 of *each* format
separately, so a flood of one never evicts the other. Failures send email —
a silent backup failure is discovered at the worst possible moment.

---

## 15. Migration direction: static site + proxy, Apps Script as a replaceable API

Apps Script's real remaining value is Google Calendar access with no OAuth work,
plus Sheets and triggers for free. Calendar is the anchor: every alternative
backend requires a full OAuth flow with refresh-token handling.

**Constraint:** Apps Script does not support CORS. There is no OPTIONS handling
and no way to set response headers on `TextOutput`. Only "simple" requests work
(GET, or POST with `text/plain`). Additionally, a "Only myself" deployment cannot
be called cross-origin at all, since the request carries no Google session.

Therefore the browser must not call Apps Script directly. A small proxy on the
user's own domain holds a shared secret and forwards `/api/*`.

The proxy's main purpose is **not** CORS. It is the API boundary: as long as the
client only ever talks to `/api/*`, what sits behind it can change from Apps
Script to Firestore to a hybrid without touching the UI. That is what makes Apps
Script an MVP rather than a permanent dependency.

**Deferred, with reasons:** offline support (user says not critical), Hebrew
calendar/zmanim (later), Firestore migration (its main wins were live sync and
offline; with offline dropped, the remaining gain did not justify rewriting the
working calendar integration).

---

## 16. Tests are the safety net and are not edited to pass

The Node suites run the real `.gs` source with stubbed Apps Script globals. They
caught four bugs that produced no error and would have shipped:

- Tamid computed as 32 dapim instead of 9
- `total: -5` falling through to a catalog default of 30 instead of clamping to 0
- planned minutes double-counted across goals in one session
- a stale reader misaligning every catalog column

If a test fails, the code is wrong. Adjusting a path after files move is fine;
changing an expected value is not.
