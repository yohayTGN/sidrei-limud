# Architecture

Technical reference for how the system is built. For *why* it's built this
way, see [DECISIONS.md](DECISIONS.md) — this file describes the current
shape only and does not restate that reasoning.

Current deployment: Apps Script serves `Index.html` via `HtmlService`
(`Code.gs` `doGet`), backed by a bound Google Sheet. Migration target: a
static site talking to Apps Script through a Worker proxy, with Apps Script
kept only for its free Calendar/Sheets/triggers access (DECISIONS.md #15).
Nothing below changes because of that migration — the sheet schemas, the
session model, and the position math are all backend concerns the proxy
will sit in front of unchanged.

---

## 1. Sheet schemas

Four sheets, all managed through `ensureSheet(name, headers)` in `Code.gs`,
which creates the sheet if missing and appends any header the current code
knows about but the sheet doesn't yet have (never inserts — see
DECISIONS.md #2). Column constants (`G_*`, `P_*`, `L_*`, `C_*`) are the
single source of truth for indices; nothing reads a sheet by header text.

### Goals (`SHEET_GOALS`)

One row per book being learned (`readGoals` / `saveGoal` / `deleteGoal` /
`setGoalTarget` / `advanceGoal`).

| Index | Const | Header (he) | Meaning |
|---|---|---|---|
| 0 | `G_NAME` | שם היעד | Display name (from catalog book or free text) |
| 1 | `G_UNIT` | יחידה | Unit label (דף / פרק / סימן / …) |
| 2 | `G_TOTAL` | סה״כ יחידות | Target size. `0` = no target (see below) |
| 3 | `G_STARTU` | יחידת התחלה | First unit number (e.g. Bavli starts at daf 2) |
| 4 | `G_DONE` | יחידות שהושלמו | Cumulative units completed |
| 5 | `G_POS` | מיקום נוכחי | Last recorded position, display text |
| 6 | `G_COLOR` | צבע | Swatch, from `PALETTE` |
| 7 | `G_STATUS` | סטטוס | `active` / other |
| 8 | `G_CREATED` | נוצר בתאריך | Creation date |
| 9 | `G_ID` | מזהה | UUID, stable identity for all references |
| 10 | `G_CATEGORY` | קטגוריה | Catalog category key (`bavli`, `rambam`, `custom`, …) |
| 11 | `G_BOOKKEY` | מפתח בקטלוג | Catalog book key within that category |

Columns 10–11 were added in v2.0 and appended after `G_ID` — v1 rows are
migrated by `migrateToV2()`, which backfills `category = 'custom'` on any
row missing it, and is safe to re-run (only fills empty cells).

`total = 0` is a real state, not a missing value: it means "accumulate
units, show no progress bar" (DECISIONS.md #4). `readGoals()` derives
`hasTarget = total > 0` and `percent` (null when there's no target) from it
on every read; nothing else in the sheet marks a goal as targetless.

### WeeklyPlan (`SHEET_PLAN`)

One row per scheduled study block (`readPlanRows` / `readWeekPlan` /
`appendPlanBlock` / `updatePlanEventId` / `updatePlanStatus` /
`archivePlanBlock`).

| Index | Const | Header (he) | Meaning |
|---|---|---|---|
| 0 | `P_WEEK` | תחילת שבוע | Week-start date (Sunday), groups blocks into a week |
| 1 | `P_DATE` | תאריך | Block's calendar date |
| 2 | `P_DOW` | יום | Day-of-week number |
| 3 | `P_START` | שעת התחלה | Start time |
| 4 | `P_DUR` | משך (דק׳) | Duration in minutes |
| 5 | `P_GOALID` | מזהה יעד | FK → `Goals.G_ID` |
| 6 | `P_GOALNAME` | שם היעד | Denormalized goal name (survives goal rename/delete) |
| 7 | `P_EVENTID` | מזהה אירוע יומן | Google Calendar event ID, for update/delete |
| 8 | `P_STATUS` | סטטוס | `planned` / `done` |
| 9 | `P_ID` | מזהה | UUID |
| 10 | `P_SEDER` | סדר | `boker` / `tzohorayim` / `erev` |

Column 10 (`seder`) was added in v2.0. `saveWeekPlan(weekStart, blocks)`
replaces a week atomically: it archives every existing row for that
`weekStart` into `Archive` (`SHEET_ARCHIVE`, same columns as `WeeklyPlan`
plus a "moved to archive" timestamp) and deletes the corresponding calendar
events, before writing the new blocks — full validation of every incoming
block runs *before* anything is deleted.

### StudyLog (`SHEET_LOG`)

One row per `(goal, session)` pair — a single sitting that touches two
books writes two rows sharing a `sessionId` (`readLog` / `appendLogEntry` /
`deleteLogEntry`). See DECISIONS.md #3 for why it's shaped this way.

| Index | Const | Header (he) | Meaning |
|---|---|---|---|
| 0 | `L_DATE` | תאריך | Session date |
| 1 | `L_START` | שעת התחלה | Session start time |
| 2 | `L_END` | שעת סיום | Session end time |
| 3 | `L_ACTUAL` | דקות בפועל | Minutes actually spent on this goal |
| 4 | `L_PLANNED` | דקות מתוכננות | Planned minutes — written only on the session's first row |
| 5 | `L_GOALID` | מזהה יעד | FK → `Goals.G_ID` |
| 6 | `L_GOALNAME` | שם היעד | Denormalized goal name |
| 7 | `L_REACHED` | היכן הגעתי | Position reached, as entered by the user |
| 8 | `L_UNITS` | יחידות שהושלמו | Units completed this entry |
| 9 | `L_SUMMARY` | סיכום | Free-text summary |
| 10 | `L_PLANID` | מזהה תכנון | FK → `WeeklyPlan.P_ID`, or `'--'` for free study |
| 11 | `L_SESSIONID` | מזהה מפגש | Shared across rows from the same sitting |
| 12 | `L_ID` | מזהה | UUID |
| 13 | `L_SEDER` | סדר | `boker` / `tzohorayim` / `erev` |

Column 13 (`seder`) was added in v2.0, appended after `L_ID`.
`appendLogEntry` always writes all 14 fields in order — there is no partial
row, since a single skipped field would misalign everything after it.

### Catalog (`SHEET_CATALOG`, in `SefariaCatalog.gs`)

A cache, not a source of truth: `getCatalog()` (`Code.gs`) prefers this
sheet via `readCatalogSheet()`, and falls back to the hardcoded `CATALOG`
array in `Code.gs` if the sheet is missing, empty, or fails the header
check — see DECISIONS.md #12.

| Index | Const | Header (he) | Meaning |
|---|---|---|---|
| 0 | `C_CAT` | קטגוריה | Category key |
| 1 | `C_CATNAME` | שם קטגוריה | Category display name |
| 2 | `C_GROUP` | קבוצה | Grouping within the category (e.g. Talmud seder) |
| 3 | `C_BOOK` | ספר | Book name — the selectable unit |
| 4 | `C_SECTION` | חלק | Section name, only set for books that have sections (Rambam) |
| 5 | `C_SECIDX` | מספר חלק | Section's sequence index within its book |
| 6 | `C_OFFSET` | היסט | Chapters preceding this section — see §3 |
| 7 | `C_TITLE` | כותרת Sefaria | Sefaria's own title, for traceability |
| 8 | `C_UNIT` | יחידה | Unit label |
| 9 | `C_POSTYPE` | סוג מיקום | `daf` or `number` |
| 10 | `C_START` | מתחיל ב | First position value |
| 11 | `C_END` | מסתיים ב | Last position value |
| 12 | `C_UNITS` | יחידות | Unit count for this row (book, or this section's chapters) |
| 13 | `C_SOURCE` | מקור | `sefaria` or `manual` |
| 14 | `C_UPDATED` | עודכן | Sync timestamp |
| 15 | `C_ID` | מזהה | UUID |

Unlike the other three sheets, `syncCatalog()` rewrites this sheet
wholesale (`sheet.clear()` then a single bulk write) rather than appending
— it's a full resync from Sefaria plus `CATALOG_MANUAL`, not incremental
user data, so there's nothing to preserve across a sync. `readCatalogSheet`
rejects the sheet outright (falls back to the built-in catalog) if the
header row doesn't match `HEADERS_CATALOG` exactly, to avoid silently
misreading a schema from a different code version (DECISIONS.md #12).

---

## 2. Live-session model (`ScriptProperties`)

`localStorage`/`sessionStorage` don't work inside the Apps Script iframe
(DECISIONS.md #1), and wouldn't sync across devices even if they did. All
in-progress-session state instead lives server-side under one key,
`SESSION_KEY = 'activeSession'`, in `PropertiesService.getScriptProperties()`
— a single global slot, since the app supports one active session at a
time.

**Session shape** (`readSession` / `writeSession` / `clearSessionState`):

```
{
  sessionId, start,            // ISO start time
  planId, plannedMin,          // WeeklyPlan block this session fulfills, if any
  seder,                       // boker / tzohorayim / erev
  running,                     // is a segment currently accumulating?
  currentGoalId,               // which goal the running segment counts toward
  segmentStart,                // ISO start of the current running segment, or null
  totals: { [goalId]: ms },    // committed elapsed time per goal
  phase,                       // 'active' | 'wrapup'
  endedAt,                     // set once, when stopSession() is called
  draft                        // in-progress summary text, saved via saveDraft()
}
```

Time is tracked as a sequence of **segments**, not one running clock,
because a session can switch goals or pause mid-sitting. `commitSegment(s)`
— called by `pauseSession`, `switchGoal`, and `stopSession` before they
change `currentGoalId` or `running` — folds the elapsed time since
`segmentStart` into `totals[currentGoalId]` and clears `segmentStart`.
`sessionView(s)` (the read-side projection returned by every session
function) adds the *currently running* segment's elapsed time on top of
`totals` without mutating it, so polling the session never double-counts
and never needs a write to report accurate elapsed time.

**Lifecycle:** `startSession` → repeatable `pauseSession` / `resumeSession`
/ `switchGoal` → `stopSession` (moves to `phase: 'wrapup'`, freezes
`endedAt`) → `finishSession(entries)`, which writes one `StudyLog` row per
goal touched (via `appendLogEntry`), calls `advanceGoal` for each, marks
the `WeeklyPlan` block `done` if there was one, and clears the session —
or `cancelSession()` to discard. A session under 1 second total is
discarded by `finishSession` itself rather than written.

This is what makes the phone-starts / PC-finishes handoff work: the phone
calls `pauseSession` (or just stops polling — `running` state is what's
persisted, not a live connection), and the PC's next `getActiveSession()`
call reads the same server-side segment history.

---

## 3. Two-level position model (Rambam)

Most catalog books are flat: the book *is* the unit you track a numeric
position against (a Bavli masechet, a Tanach book). The Rambam's Mishneh
Torah is the one case with two levels — see DECISIONS.md #10 for why this
distinction exists and what's excluded from the 83-count.

- **Book** — one of the 14 sefarim (ספר המדע, ספר אהבה, …). This is what
  the user selects and what a `Goal` row points at (`G_BOOKKEY`).
- **Section** — one of the sefer's halachot (הלכות תשובה, …). Sections
  exist only for books that have them; a `book.sections` array is empty
  for every other category.

Each section stores `offset`: the number of chapters in every section that
precedes it within the same book, computed once in `SefariaCatalog.gs` by
`assignOffsets_()` in Sefaria's own (canonical) node order, and persisted
in `Catalog.C_OFFSET`. A position is stored as one running number —
`positionToValue(book, sectionIdx, chapter) = section.offset + chapter` —
so that a difference between two positions is a real chapter count even
when it crosses a halachot boundary, and so `Goals.G_POS` / `StudyLog`
never need to store a section separately from a chapter.

`valueToPosition(book, value)` is the inverse: it scans `book.sections`
from the end for the last section whose `offset < value`, and returns
`{ sectionIdx, section, chapter: value - section.offset }`.
`formatPosition(book, value)` renders the result for display — e.g.
"הלכות תשובה פרק ג׳" — and also handles the two other position types in
the same catalog: `posType: 'daf'` (Bavli, via `formatDafPosition`, daf +
0.5 for amud bet — DECISIONS.md #9) and plain `number` (סימן, פרק with no
sections), so the session/summary UI can call one function regardless of
which kind of book is active.

Bavli daf ranges are derived the same way structurally but independently:
`talmudRange()` scans Sefaria's `chapters` array for the first and last
non-zero entry rather than trusting `chapters.length`, because a tractate
that doesn't start at daf 2 is zero-padded up to its real start
(DECISIONS.md #8, the Tamid case).
