/* Node harness for V2: stub Apps Script, exercise the tricky logic. */
const fs = require('fs');

let props = {};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    deleteProperty: k => { delete props[k]; }
  }),
  getUserProperties: () => ({ getProperty: () => null, setProperty: () => {} })
};

function pad2(n) { return String(n).padStart(2, '0'); }
global.Utilities = {
  getUuid: () => 'uuid-' + Math.random().toString(36).slice(2, 10),
  formatDate: (d, tz, fmt) => {
    const y = d.getFullYear(), m = pad2(d.getMonth() + 1), day = pad2(d.getDate());
    const hh = pad2(d.getHours()), mm = pad2(d.getMinutes());
    if (fmt === 'yyyy-MM-dd') return `${y}-${m}-${day}`;
    if (fmt === 'HH:mm') return `${hh}:${mm}`;
    return `${y}-${m}-${day} ${hh}:${mm}`;
  },
  parseDate: (str) => {
    const m = str.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date(NaN);
  }
};
global.SpreadsheetApp = { getActiveSpreadsheet: () => null };
global.Logger = { log: () => {} };

let src = fs.readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
eval(src.replace(/^const /gm, 'var '));

/* ---- fake sheet layer -------------------------------------------------- */
let FAKE_GOALS = [];
readGoals = () => FAKE_GOALS;
getGoalById = id => FAKE_GOALS.find(g => g.id === id) || null;

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? '  \u2713 ' : '  \u2717 ') + label +
    (ok ? '' : `   got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`));
  ok ? pass++ : fail++;
}

let NOW = new Date(2026, 8, 8, 20, 0, 0);
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW.getTime()); else super(...a); }
  static now() { return NOW.getTime(); }
};
function advance(min) { NOW = new RealDate(NOW.getTime() + min * 60000); }
function resetClock(h, m) { NOW = new RealDate(2026, 8, 8, h === undefined ? 20 : h, m || 0, 0); }

/* Row widths, checked against the real writers (not just the header
   arrays) — placed before any test group below reassigns goalsSheet /
   logSheet, so these exercise the actual eval'd appendLogEntry / saveGoal. */
console.log('\n--- appended rows match declared header widths ---');
let LOG_ROW = null;
logSheet = () => ({ appendRow: r => { LOG_ROW = r; } });
appendLogEntry({
  date: '2026-09-09', startTime: '20:00', endTime: '21:00', actualMin: 60, plannedMin: 0,
  goalId: 'g1', goalName: 'test', reached: '', units: 0, summary: '',
  planId: 'p1', sessionId: 's1', seder: 'erev'
});
eq('appendLogEntry writes exactly HEADERS_LOG.length fields', LOG_ROW.length, HEADERS_LOG.length);

let GOAL_ROW = null;
goalsSheet = () => ({
  getDataRange: () => ({ getValues: () => [[]] }),
  appendRow: r => { GOAL_ROW = r; },
  getRange: () => ({ getValues: () => [[]], setValues: () => {}, setValue: () => {} })
});
saveGoal({ category: 'bavli', bookKey: 'taanit' });
eq('saveGoal writes exactly HEADERS_GOALS.length fields', GOAL_ROW.length, HEADERS_GOALS.length);

/* ======================================================================== */
console.log('\n--- catalog integrity ---');
const bavli = getCategory('bavli');
eq('bavli has 40 masechtot', bavli.books.length, 40);
eq('daf total = 2711 (documented Vilna count)',
  bavli.books.reduce((s, b) => s + b.total, 0), 2711);
eq('taanit = 30 dapim, not 31', getCatalogBook('bavli', 'taanit').total, 30);
eq('bava batra is the longest', Math.max(...bavli.books.map(b => b.total)), 175);
eq('every bavli book has a verified total',
  bavli.books.filter(b => b.total === null).length, 0);
eq('all catalog book keys unique', (() => {
  const keys = [];
  CATALOG.forEach(c => c.books.forEach(b => keys.push(c.key + '/' + b.key)));
  return keys.length - new Set(keys).size;
})(), 0);
eq('unverified rambam books are null, not guessed',
  getCatalogBook('rambam', 'mada').total, null);
eq('rambam whole-work total is the verified 1000',
  getCatalogBook('rambam', 'mt_all').total, 1000);
eq('missing book returns null', getCatalogBook('bavli', 'nope'), null);
eq('missing category returns null', getCategory('nope'), null);

console.log('\n--- seder derivation from clock time ---');
eq('06:00 -> boker', sederFromTime('06:00'), 'boker');
eq('11:59 -> boker', sederFromTime('11:59'), 'boker');
eq('12:00 -> tzohorayim', sederFromTime('12:00'), 'tzohorayim');
eq('16:59 -> tzohorayim', sederFromTime('16:59'), 'tzohorayim');
eq('17:00 -> erev', sederFromTime('17:00'), 'erev');
eq('23:30 -> erev', sederFromTime('23:30'), 'erev');
eq('02:00 (past midnight) -> erev', sederFromTime('02:00'), 'erev');
eq('garbage -> erev fallback', sederFromTime(''), 'erev');
eq('unknown seder key falls back to erev', getSeder('nonsense').key, 'erev');

console.log('\n--- goal creation from catalog ---');
let WROTE = null;
goalsSheet = () => ({
  getDataRange: () => ({ getValues: () => [[]] }),
  appendRow: r => { WROTE = r; },
  getRange: () => ({ getValues: () => [[]], setValues: () => {}, setValue: () => {} })
});
findRowById = () => -1;

saveGoal({ category: 'bavli', bookKey: 'taanit' });
eq('name auto-filled from catalog', WROTE[G_NAME], 'תענית');
eq('unit auto-filled from category', WROTE[G_UNIT], 'דף');
eq('total auto-filled from book', WROTE[G_TOTAL], 30);
eq('startUnit from category (bavli starts at daf 2)', WROTE[G_STARTU], 2);
eq('category persisted', WROTE[G_CATEGORY], 'bavli');
eq('bookKey persisted', WROTE[G_BOOKKEY], 'taanit');

saveGoal({ category: 'bavli', bookKey: 'taanit', name: 'תענית — עיון', total: 12, unit: 'סוגיה' });
eq('user name overrides catalog', WROTE[G_NAME], 'תענית — עיון');
eq('user total overrides catalog', WROTE[G_TOTAL], 12);
eq('user unit overrides category', WROTE[G_UNIT], 'סוגיה');

saveGoal({ category: 'rambam', bookKey: 'mt_all' });
eq('rambam whole work = 1000 chapters', WROTE[G_TOTAL], 1000);
eq('rambam unit is perek', WROTE[G_UNIT], 'פרק');
eq('rambam starts at 1', WROTE[G_STARTU], 1);

// V2.1: an unverified book is no longer a blocker — it saves with no target.
saveGoal({ category: 'rambam', bookKey: 'mada' });
eq('unverified book saves with no target (was a hard error in V2)', WROTE[G_TOTAL], 0);
saveGoal({ category: 'rambam', bookKey: 'mada', total: 46 });
eq('...and takes a target when the user supplies one', WROTE[G_TOTAL], 46);

try {
  saveGoal({ category: 'custom' });
  eq('a book with no name at all is still rejected', false, true);
} catch (e) { eq('a book with no name at all is still rejected', true, true); }
saveGoal({ category: 'custom', name: 'ספר שלי', unit: 'עמוד', total: 200 });
eq('custom goal accepted with explicit fields',
  [WROTE[G_NAME], WROTE[G_UNIT], WROTE[G_TOTAL]], ['ספר שלי', 'עמוד', 200]);

console.log('\n--- calendar title carries the seder ---');
eq('evening title', buildEventTitle({ seder: 'erev', goalName: 'מסכת תענית' }),
  '\uD83C\uDF19 סדר ערב: מסכת תענית');
eq('morning title', buildEventTitle({ seder: 'boker', goalName: 'ספר המדע' }),
  '\u2600\uFE0F סדר בוקר: ספר המדע');
eq('afternoon title', buildEventTitle({ seder: 'tzohorayim', goalName: 'מסילת ישרים' }),
  '\uD83C\uDF24\uFE0F סדר צהריים: מסילת ישרים');
eq('unknown seder yields a title, not a crash',
  buildEventTitle({ seder: 'zzz', goalName: 'X' }).indexOf('סדר ערב') > -1, true);

console.log('\n--- session carries the seder ---');
FAKE_GOALS = [
  { id: 'g1', name: 'מסכת תענית', unit: 'דף', total: 30, done: 10, position: 'דף י׳', color: '#E9B8BC' },
  { id: 'g2', name: 'ספר המדע', unit: 'פרק', total: 46, done: 5, position: 'פרק ה׳', color: '#B98A63' }
];
props = {}; resetClock(20, 30);
eq('20:30 start auto-tags as erev', startSession({ goalId: 'g1' }).seder, 'erev');
props = {}; resetClock(8, 45);
eq('08:45 start auto-tags as boker', startSession({ goalId: 'g1' }).seder, 'boker');
props = {}; resetClock(14, 0);
eq('14:00 start auto-tags as tzohorayim', startSession({ goalId: 'g1' }).seder, 'tzohorayim');
props = {}; resetClock(20, 30);
eq('explicit seder overrides the clock',
  startSession({ goalId: 'g1', seder: 'boker' }).seder, 'boker');
eq('seder editable mid-session', setSessionSeder('erev').seder, 'erev');

console.log('\n--- retroactive start uses the ACTUAL start time ---');
props = {}; resetClock(12, 10);          // now 12:10, started 30m ago = 11:40
eq('started 11:40 -> boker, not tzohorayim',
  startSession({ goalId: 'g1', startedAgoMin: 30 }).seder, 'boker');

console.log('\n--- V1 time-accounting regressions ---');
props = {}; resetClock(20, 0);
startSession({ goalId: 'g1', plannedMin: 90, planId: 'p1' });
advance(60); pauseSession(); advance(30); resumeSession(); advance(30);
eq('60m + break30 + 30m = 90 min', Math.round(getActiveSession().totalMs / 60000), 90);

props = {}; resetClock(20, 0);
startSession({ goalId: 'g1', plannedMin: 90 });
advance(50); switchGoal('g2'); advance(25); pauseSession(); advance(15); resumeSession(); advance(10);
let v = getActiveSession();
eq('multi-goal total = 85', Math.round(v.totalMs / 60000), 85);
eq('goal1 = 50', Math.round(v.totals.g1 / 60000), 50);
eq('goal2 = 35', Math.round(v.totals.g2 / 60000), 35);

props = {}; resetClock(20, 0);
startSession({ goalId: 'g1' });
advance(20); pauseSession(); switchGoal('g2'); advance(40);
eq('switching while paused does not restart the clock',
  Math.round(getActiveSession().totalMs / 60000), 20);

console.log('\n--- cross-device handoff ---');
props = {}; resetClock(20, 0);
startSession({ goalId: 'g1' });
advance(45); switchGoal('g2'); advance(20); stopSession();
advance(90);
v = getActiveSession();
eq('phase = wrapup', v.phase, 'wrapup');
eq('elapsed frozen at 65 despite 90m gap', Math.round(v.totalMs / 60000), 65);
eq('seder survives the handoff', v.seder, 'erev');
saveDraft({ g1: { reached: 'דף י״ב ע״א', units: 2, summary: 'טיוטה מהטלפון' } });
eq('draft survives', getActiveSession().draft.g1.units, 2);

console.log('\n--- finishSession writes seder on every row ---');
let WRITTEN = [], ADVANCED = [];
appendLogEntry = e => { WRITTEN.push(e); return 'log' + WRITTEN.length; };
advanceGoal = (id, u, p) => ADVANCED.push({ id, u, p });
updatePlanStatus = () => {};
let res = finishSession([
  { goalId: 'g1', reached: 'דף י״ב ע״א', units: 2, summary: 'תענית' },
  { goalId: 'g2', reached: 'פרק ז׳', units: 2, summary: 'רמב״ם' }
]);
eq('two rows written', WRITTEN.length, 2);
eq('every row tagged with the seder', WRITTEN.map(w => w.seder), ['erev', 'erev']);
eq('shared sessionId', WRITTEN[0].sessionId === WRITTEN[1].sessionId, true);
eq('minutes split 45/20', WRITTEN.map(w => w.actualMin), [45, 20]);
eq('goals advanced', ADVANCED.map(a => a.u), [2, 2]);
eq('total reported', res.totalMin, 65);
eq('session cleared', readSession(), null);

console.log('\n--- plannedMin still counted once across goals ---');
props = {}; WRITTEN = []; resetClock(20, 0);
startSession({ goalId: 'g1', plannedMin: 90, planId: 'p9' });
advance(40); switchGoal('g2'); advance(30); stopSession();
finishSession([{ goalId: 'g1', units: 1 }, { goalId: 'g2', units: 1 }]);
eq('90 planned appears exactly once', WRITTEN.map(w => w.plannedMin), [90, 0]);

console.log('\n--- stats bucket by seder (incl. back-derived V1 rows) ---');
readLog = () => [
  { date: '2026-09-06', startTime: '08:30', actualMin: 60, goalId: 'g1', seder: sederFromTime('08:30') },
  { date: '2026-09-07', startTime: '21:00', actualMin: 90, goalId: 'g1', seder: sederFromTime('21:00') },
  { date: '2026-09-08', startTime: '14:15', actualMin: 45, goalId: 'g2', seder: sederFromTime('14:15') },
  { date: '2026-08-31', startTime: '20:00', actualMin: 120, goalId: 'g1', seder: 'erev' }
];
readWeekPlan = () => [{ durationMin: 90, seder: 'erev' }, { durationMin: 60, seder: 'boker' }];
resetClock(20, 0);
const st = getStats();
eq('this week = 195 min', st.thisWeekMin, 195);
eq('last week = 120 min', st.lastWeekMin, 120);
eq('trend = +75 min', st.diffMin, 75);
eq('boker = 60', st.bySeder.boker, 60);
eq('tzohorayim = 45', st.bySeder.tzohorayim, 45);
eq('erev = 90', st.bySeder.erev, 90);
eq('seder buckets sum to the week total',
  st.bySeder.boker + st.bySeder.tzohorayim + st.bySeder.erev, st.thisWeekMin);
eq('last week bucketed separately', st.bySederLast.erev, 120);
eq('planned by seder', [st.plannedBySeder.erev, st.plannedBySeder.boker], [90, 60]);
eq('every seder key present even at zero',
  Object.keys(st.bySeder).sort(), ['boker', 'erev', 'tzohorayim']);

console.log('\n--- streak & date math ---');
resetClock(20, 0);
const mk = ds => ds.map(d => ({ date: d, actualMin: 60 }));
eq('3 consecutive days', computeStreak(mk(['2026-09-08', '2026-09-07', '2026-09-06'])), 3);
eq('today idle still counts back from yesterday', computeStreak(mk(['2026-09-07', '2026-09-06'])), 2);
eq('gap breaks it', computeStreak(mk(['2026-09-08', '2026-09-05'])), 1);
eq('weekStartOf Tue -> Sun', weekStartOf('2026-09-08'), '2026-09-06');
eq('addDays across month', addDaysStr('2026-09-30', 1), '2026-10-01');
eq('addDays across year', addDaysStr('2026-01-01', -1), '2025-12-31');

console.log('\n--- migration is append-only (V1 indices unchanged) ---');
const V1_GOALS = ['שם היעד','יחידה','סה״כ יחידות','יחידת התחלה','יחידות שהושלמו',
  'מיקום נוכחי','צבע','סטטוס','נוצר בתאריך','מזהה'];
eq('V2 goal headers extend V1 in the same order', HEADERS_GOALS.slice(0, 10), V1_GOALS);
eq('goal ID column still index 9', G_ID, 9);
eq('plan ID column still index 9', P_ID, 9);
eq('log ID column still index 12', L_ID, 12);
eq('new goal columns appended after ID', [G_CATEGORY, G_BOOKKEY], [10, 11]);
eq('new plan column appended after ID', P_SEDER, 10);
eq('new log column appended after ID', L_SEDER, 13);
eq('plan row width matches headers', planRowValues({
  weekStart: 'a', date: 'b', dow: 1, startTime: 'c', durationMin: 1,
  goalId: 'd', goalName: 'e', id: 'f', seder: 'erev'
}).length, HEADERS_PLAN.length);
eq('archive row = plan row + 1', planRowValues({ seder: 'erev' }).length + 1, HEADERS_ARCHIVE.length);
// V3 (numeric position, DECISIONS.md #9): appended after ID, same guarantee.
// The literal below is 15, not 14 — this schema change is exactly why it
// grew, per HEADERS_LOG.length itself (checked against the real writer above).
eq('log row width matches headers', HEADERS_LOG.length, 15);
eq('goal ID column still index 9 after V3 addition', G_ID, 9);
eq('plan ID column still index 9 after V3 addition', P_ID, 9);
eq('log ID column still index 12 after V3 addition', L_ID, 12);
eq('V3 goal column appended after existing columns, not inserted', G_POSVAL, 12);
eq('V3 log column appended after existing columns, not inserted', L_REACHEDVAL, 14);

/* ====================== V2.1: target is optional ======================== */
console.log('\n--- a book can exist with no target at all ---');
goalsSheet = () => ({
  getDataRange: () => ({ getValues: () => [[]] }),
  appendRow: r => { WROTE = r; },
  getRange: () => ({ getValues: () => [[]], setValues: () => {}, setValue: () => {} })
});
findRowById = () => -1;

saveGoal({ category: 'machshava', bookKey: 'mesilat' });
eq('unverified book now saves instead of throwing', WROTE[G_NAME], 'מסילת ישרים');
eq('...with total 0 = no target', WROTE[G_TOTAL], 0);
eq('...and keeps its unit', WROTE[G_UNIT], 'פרק');

saveGoal({ category: 'custom', name: 'שיעור כללי' });
eq('a custom book needs only a name', [WROTE[G_NAME], WROTE[G_TOTAL]], ['שיעור כללי', 0]);

saveGoal({ category: 'bavli', bookKey: 'taanit' });
eq('catalog total still auto-fills when known', WROTE[G_TOTAL], 30);
saveGoal({ category: 'bavli', bookKey: 'taanit', total: 0 });
eq('explicit 0 drops the target even for a known book', WROTE[G_TOTAL], 0);
saveGoal({ category: 'bavli', bookKey: 'taanit', total: -5 });
eq('negative total clamps to 0, never negative', WROTE[G_TOTAL], 0);

console.log('\n--- setting a target later (the motzash action) ---');
let TARGET_WRITTEN = null;
function targetSheetWithDone(done) {
  return {
    getRange: () => ({ getValue: () => done, setValue: v => { TARGET_WRITTEN = v; } })
  };
}
goalsSheet = () => targetSheetWithDone(12);
findRowById = () => 2;
eq('sets a target on an existing book', setGoalTarget('g1', 30).total, 30);
eq('written to the sheet', TARGET_WRITTEN, 30);
eq('target of 0 removes the target', setGoalTarget('g1', 0).total, 0);
try {
  setGoalTarget('g1', 5);
  eq('target below what is already learned is rejected', false, true);
} catch (e) {
  eq('target below what is already learned is rejected',
    e.message.indexOf('קטן ממה שכבר נלמד') > -1, true);
}
findRowById = () => -1;
try { setGoalTarget('nope', 10); eq('missing book rejected', false, true); }
catch (e) { eq('missing book rejected', true, true); }

console.log('\n--- motzash planning window ---');
function setDay(day, hour) { NOW = new RealDate(2026, 8, day, hour, 0, 0); }
setDay(12, 18); eq('Shabbat afternoon -> no prompt', isPlanningWindow(), false);
setDay(12, 20); eq('Shabbat 20:00 (before latest tzeit) -> no prompt', isPlanningWindow(), false);
setDay(12, 21); eq('motzash 21:00 -> prompt opens', isPlanningWindow(), true);
setDay(12, 23); eq('motzash 23:00 -> prompt', isPlanningWindow(), true);
setDay(13, 9);  eq('Sunday -> still in the window', isPlanningWindow(), true);
setDay(8, 20);  eq('Tuesday evening -> no prompt', isPlanningWindow(), false);
setDay(11, 22); eq('Friday night -> no prompt', isPlanningWindow(), false);

console.log('\n--- shabbat guard for the reminder email ---');
setDay(11, 10); eq('Friday morning -> email allowed', isShabbatWindow(), false);
setDay(11, 12); eq('Friday noon -> blocked', isShabbatWindow(), true);
setDay(11, 20); eq('Friday night -> blocked', isShabbatWindow(), true);
setDay(12, 10); eq('Shabbat day -> blocked', isShabbatWindow(), true);
setDay(12, 20); eq('Shabbat 20:00 -> still blocked', isShabbatWindow(), true);
setDay(12, 21); eq('motzash 21:00 -> allowed again', isShabbatWindow(), false);
setDay(8, 20);  eq('midweek -> allowed', isShabbatWindow(), false);
eq('the two windows never overlap', (() => {
  for (let d = 6; d <= 12; d++) for (let h = 0; h < 24; h++) {
    setDay(d, h);
    if (isPlanningWindow() && isShabbatWindow()) return 'overlap on day ' + d + ' hour ' + h;
  }
  return 'none';
})(), 'none');

console.log('\n--- which week gets reviewed vs planned ---');
setDay(12, 21);
eq('on motzash: review the week ending, plan the next',
  planningWeeks(), { review: '2026-09-06', target: '2026-09-13' });
setDay(13, 10);
eq('on Sunday: review last week, plan the week just started',
  planningWeeks(), { review: '2026-09-06', target: '2026-09-13' });
eq('both entry points target the same pair',
  (setDay(12, 22), planningWeeks().target), (setDay(13, 8), planningWeeks().target));

console.log('\n--- week review surfaces target candidates ---');
setDay(12, 21);
FAKE_GOALS = [
  { id:'g1', name:'מסכת תענית', unit:'דף', total:30, done:12, percent:40, hasTarget:true,
    color:'#E9B8BC', categoryIcon:'📖', position:'דף י״ב' },
  { id:'g2', name:'מסילת ישרים', unit:'פרק', total:0, done:4, percent:null, hasTarget:false,
    color:'#B98A63', categoryIcon:'💭', position:'פרק ד׳' }
];
readLog = () => [
  { date:'2026-09-07', actualMin:90, units:2, goalId:'g1', goalName:'מסכת תענית', seder:'erev' },
  { date:'2026-09-09', actualMin:60, units:1, goalId:'g1', goalName:'מסכת תענית', seder:'boker' },
  { date:'2026-09-09', actualMin:30, units:2, goalId:'g2', goalName:'מסילת ישרים', seder:'erev' },
  { date:'2026-08-31', actualMin:120, units:1, goalId:'g1', goalName:'מסכת תענית', seder:'erev' }
];
readWeekPlan = ws => (ws === '2026-09-06' ? [{ durationMin:120, seder:'erev' }] : []);
const rev = getWeekReview();
eq('reviews the correct week', [rev.reviewWeekStart, rev.reviewWeekEnd], ['2026-09-06','2026-09-12']);
eq('total = 180 min', rev.totalMin, 180);
eq('previous week = 120', rev.prevMin, 120);
eq('trend = +60', rev.diffMin, 60);
eq('2 distinct days learned', rev.daysLearned, 2);
eq('books sorted by time spent', rev.books.map(b => b.goalId), ['g1','g2']);
eq('minutes per book', rev.books.map(b => b.minutes), [150, 30]);
eq('units summed per book', rev.books.map(b => b.units), [3, 2]);
eq('sessions counted', rev.books.map(b => b.sessions), [2, 1]);
eq('only the targetless book is offered a target',
  rev.needTarget.map(b => b.goalId), ['g2']);
eq('adherence vs plan', rev.adherence, 150);
eq('next week not planned yet', rev.targetWeekPlanned, 0);
eq('seder split', [rev.bySeder.erev, rev.bySeder.boker], [120, 60]);

console.log('\n--- a book never studied is not nagged about targets ---');
readLog = () => [];
eq('no sessions -> no target candidates', getWeekReview().needTarget.length, 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
