/* Node harness for V3 (numeric position, DECISIONS.md #9). Loads both
   SefariaCatalog.gs and Code.gs into one scope, since migrateToV3 and the
   parser live in SefariaCatalog.gs but operate on Code.gs's sheets. */
const fs = require('fs');
const path = require('path');

global.SpreadsheetApp = { getActiveSpreadsheet: () => null };
global.Logger = { log: () => {} };
global.UrlFetchApp = {};

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
  sleep: () => {},
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

const sefSrc = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'SefariaCatalog.gs'), 'utf8');
eval(sefSrc.replace(/^const /gm, 'var '));
const codeSrc = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
eval(codeSrc.replace(/^const /gm, 'var '));

// שמור הפניה לפני שבדיקות מטה מחליפות את הבינדינג הגלובלי בסטאב.
const REAL_advanceGoal = advanceGoal;

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? '  ✓ ' : '  ✗ ') + label +
    (ok ? '' : `   got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`));
  ok ? pass++ : fail++;
}

/* ---- Sefer Madda fixture, same offsets as catalog_test.js's own fixture -- */
const madda = {
  name: 'ספר המדע', unit: 'פרק', posType: 'number', total: 46,
  sections: [
    { name: 'הלכות יסודי התורה', idx: 0, offset: 0, chapters: 10 },
    { name: 'הלכות דעות', idx: 1, offset: 10, chapters: 7 },
    { name: 'הלכות תלמוד תורה', idx: 2, offset: 17, chapters: 7 },
    { name: 'הלכות עבודה זרה וחוקות הגויים', idx: 3, offset: 24, chapters: 12 },
    { name: 'הלכות תשובה', idx: 4, offset: 36, chapters: 10 }
  ]
};
const taanit = { name: 'תענית', unit: 'דף', posType: 'daf', total: 30, sections: [] };
const sa = { name: 'שולחן ערוך אורח חיים', unit: 'סימן', posType: 'number', total: 697, sections: [] };

console.log('\n--- parsePosition: text -> numeric ---');
eq('דף י״ב ע״ב -> 12.5', parsePosition(taanit, 'דף י״ב ע״ב'), 12.5);
eq('דף י״ב ע״א -> 12', parsePosition(taanit, 'דף י״ב ע״א'), 12);
eq('דף י״ב (no amud) -> 12', parsePosition(taanit, 'דף י״ב'), 12);
eq('פרק ג׳ (no section, no book) -> 3', parsePosition(null, 'פרק ג׳'), 3);
eq('הלכות תשובה פרק ג׳ -> offset(36) + 3 = 39', parsePosition(madda, 'הלכות תשובה פרק ג׳'), 39);
eq('סימן רס״ג -> 263 (generalizes beyond פרק)', parsePosition(sa, 'סימן רס״ג'), 263);
eq('unparseable free text -> null', parsePosition(madda, 'המשכתי מאיפה שעצרתי'), null);
eq('unknown section name -> null, not a guess', parsePosition(madda, 'הלכות לא קיימות פרק א׳'), null);
eq('empty string -> null', parsePosition(madda, ''), null);
eq('null text -> null', parsePosition(madda, null), null);

console.log('\n--- resolveCatalogBook / resolveCatalogBookFrom ---');
const fakeCats = [{ key: 'rambam', books: [madda] }];
eq('finds the sectioned book via the built-in slug -> Hebrew name bridge',
  resolveCatalogBookFrom(fakeCats, 'rambam', 'mada').name, 'ספר המדע');
eq('unknown bookKey -> null', resolveCatalogBookFrom(fakeCats, 'rambam', 'nope'), null);
eq('category not present in the loaded catalog -> null',
  resolveCatalogBookFrom(fakeCats, 'bavli', 'taanit'), null);

/* ---- migrateToV3: fake mutable sheets ------------------------------------ */
function makeFakeSheet(rows) {
  return {
    getDataRange: () => ({ getValues: () => rows }),
    getRange: (r, c) => ({
      getValue: () => rows[r - 1][c - 1],
      setValue: v => { rows[r - 1][c - 1] = v; }
    })
  };
}

console.log('\n--- migrateToV3: converts text positions, never guesses ---');
getCatalog = () => fakeCats;

let GOAL_ROWS = [
  HEADERS_GOALS.slice(),
  // תענית: דף מתפרש בלי תלות בקטלוג בכלל
  ['תענית', 'דף', 30, 2, 24, 'דף י״ב ע״ב', '#fff', 'active', '2026-01-01', 'g1', 'bavli', 'taanit', ''],
  // ספר המדע: פרק עם שם חלק — צריך את הקטלוג לפתור את ההיסט
  ['ספר המדע', 'פרק', 46, 1, 39, 'הלכות תשובה פרק ג׳', '#fff', 'active', '2026-01-01', 'g2', 'rambam', 'mada', ''],
  // מיקום שלא נפרש — אמור להישאר ריק ולהופיע בדוח
  ['שיעור כללי', 'יחידה', 0, 1, 0, 'המשכתי מאיפה שעצרתי', '#fff', 'active', '2026-01-01', 'g3', 'custom', '', ''],
  // מיקום שכבר נרשם מספרית — אמור להישאר בלי שינוי
  ['ישן', 'פרק', 10, 1, 5, 'פרק ה׳', '#fff', 'active', '2026-01-01', 'g4', 'custom', '', 5]
];
goalsSheet = () => makeFakeSheet(GOAL_ROWS);

let LOG_ROWS = [HEADERS_LOG.slice()];
logSheet = () => makeFakeSheet(LOG_ROWS);

const out1 = migrateToV3();
eq('Goals: daf text parsed with no catalog dependency', GOAL_ROWS[1][G_POSVAL], 12.5);
eq('Goals: sectioned text resolved through the catalog', GOAL_ROWS[2][G_POSVAL], 39);
eq('Goals: unparseable text left empty, not guessed', GOAL_ROWS[3][G_POSVAL], '');
eq('Goals: unparseable entry is named in the report', out1.indexOf('שיעור כללי') > -1, true);
eq('Goals: an already-numeric position is left alone', GOAL_ROWS[4][G_POSVAL], 5);

const snapshotAfterFirstRun = JSON.stringify(GOAL_ROWS);
const out2 = migrateToV3();
eq('migrateToV3 run twice changes nothing the second time', JSON.stringify(GOAL_ROWS), snapshotAfterFirstRun);
eq('second run converts zero new rows', out2.indexOf('הומרו 0 מיקומים') > -1, true);

/* ---- finishSession: units derived from position, not entered ------------ */
let NOW = new Date(2026, 8, 8, 20, 0, 0);
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW.getTime()); else super(...a); }
  static now() { return NOW.getTime(); }
};
function advance(min) { NOW = new RealDate(NOW.getTime() + min * 60000); }
function resetClock(h, m) { NOW = new RealDate(2026, 8, 8, h === undefined ? 20 : h, m || 0, 0); }

console.log('\n--- units derived across a Rambam halachot boundary ---');
props = {};
let FAKE_GOALS = [{
  id: 'g1', name: 'ספר המדע', unit: 'פרק', startUnit: 1,
  category: 'rambam', bookKey: 'mada',
  // 35 = offset(24) + 11 -> last chapter of "הלכות עבודה זרה וחוקות הגויים"
  posVal: 35
}];
readGoals = () => FAKE_GOALS;
getGoalById = id => FAKE_GOALS.find(g => g.id === id) || null;

let WRITTEN = [], ADVANCED = [];
appendLogEntry = e => { WRITTEN.push(e); return 'log1'; };
advanceGoal = (id, u, p, pv) => { ADVANCED.push({ id, u, p, pv }); };
updatePlanStatus = () => {};

resetClock(20, 0);
startSession({ goalId: 'g1' });
advance(30);
stopSession();
// 39 = offset(36) + 3 -> "הלכות תשובה פרק ג׳", crossing into the next section
finishSession([{ goalId: 'g1', posVal: 39, reached: 'הלכות תשובה פרק ג׳', summary: 'עברתי הלאה' }]);

eq('units = 4 across the halachot boundary (35 -> 39)', ADVANCED[0].u, 4);
eq('advanceGoal receives the new numeric position', ADVANCED[0].pv, 39);
eq('log row carries the derived units, not an entered number', WRITTEN[0].units, 4);
eq('log row carries the numeric reached value', WRITTEN[0].reachedVal, 39);
eq('log row still carries the display text the client sent', WRITTEN[0].reached, 'הלכות תשובה פרק ג׳');

console.log('\n--- units = 0 when position moves backwards (chazara) ---');
props = {};
FAKE_GOALS = [{ id: 'g1', name: 'ספר המדע', unit: 'פרק', startUnit: 1,
  category: 'rambam', bookKey: 'mada', posVal: 39 }];
let ADVANCED2 = [];
advanceGoal = (id, u, p, pv) => { ADVANCED2.push({ id, u, p, pv }); };
appendLogEntry = e => { WRITTEN = [e]; return 'log2'; };

resetClock(20, 0);
startSession({ goalId: 'g1' });
advance(20);
stopSession();
finishSession([{ goalId: 'g1', posVal: 35, reached: 'הלכות עבודה זרה וחוקות הגויים פרק י״א' }]);

eq('units = 0 when the new position is behind the old one', ADVANCED2[0].u, 0);
eq('the (lower) position itself is still recorded', ADVANCED2[0].pv, 35);
eq('log row units are 0, not negative', WRITTEN[0].units, 0);

console.log('\n--- a first-ever position uses ONE UNIT BEFORE startUnit as the baseline ---');
// startUnit is the book's first real unit (e.g. daf 2), not "before you
// started" — using it as-is as oldVal double-counts nothing but ALSO
// silently drops the first unit ever learned. The baseline must be one
// step before startUnit: startUnit - 1 for chapters, startUnit - 0.5 for daf.
props = {};
FAKE_GOALS = [{ id: 'g1', name: 'ספר המדע', unit: 'פרק', startUnit: 1,
  category: 'rambam', bookKey: 'mada', posVal: null }];
let ADVANCED3 = [];
advanceGoal = (id, u, p, pv) => { ADVANCED3.push({ id, u, p, pv }); };
appendLogEntry = e => 'log3';
resetClock(20, 0);
startSession({ goalId: 'g1' });
advance(15);
stopSession();
// first session ends at chapter 3 -> chapters 1, 2, 3 were actually learned.
finishSession([{ goalId: 'g1', posVal: 3, reached: 'הלכות יסודי התורה פרק ג׳' }]);
eq('first session, chapters: units = what was actually learned (1,2,3 = 3)', ADVANCED3[0].u, 3);

props = {};
FAKE_GOALS = [{ id: 'g1', name: 'תענית', unit: 'דף', startUnit: 2,
  category: 'bavli', bookKey: 'taanit', posVal: null }];
let ADVANCED3b = [];
advanceGoal = (id, u, p, pv) => { ADVANCED3b.push({ id, u, p, pv }); };
appendLogEntry = e => 'log3b';
resetClock(20, 0);
startSession({ goalId: 'g1' });
advance(15);
stopSession();
// first session ends at 12b -> 2a..12b were actually learned = 11 dapim.
finishSession([{ goalId: 'g1', posVal: 12.5, reached: 'דף י״ב ע״ב' }]);
eq('first session, daf: units = what was actually learned (2a..12b = 11)', ADVANCED3b[0].u, 11);

console.log('\n--- a custom goal with unit דף is still a daf baseline, not a chapter one ---');
// category alone ('bavli') is not what makes something daf-shaped — a
// custom goal (no posBook, category 'custom') tracked in דף must still get
// the 0.5 step, or its first session under-counts by half a daf.
props = {};
FAKE_GOALS = [{ id: 'g1', name: 'עיון עצמאי בבבלי', unit: 'דף', startUnit: 2,
  category: 'custom', bookKey: '', posVal: null }];
let ADVANCED3d = [];
advanceGoal = (id, u, p, pv) => { ADVANCED3d.push({ id, u, p, pv }); };
appendLogEntry = e => 'log3d';
resetClock(20, 0);
startSession({ goalId: 'g1' });
advance(15);
stopSession();
// first session ends at 12b -> same 2a..12b range as the bavli case = 11.
finishSession([{ goalId: 'g1', posVal: 12.5, reached: 'דף י״ב ע״ב' }]);
eq('custom + unit דף: baseline is still daf-shaped (2a..12b = 11, not 10.5)', ADVANCED3d[0].u, 11);

console.log('\n--- a goal with an existing posVal is unaffected by the first-session baseline ---');
props = {};
FAKE_GOALS = [{ id: 'g1', name: 'ספר המדע', unit: 'פרק', startUnit: 1,
  category: 'rambam', bookKey: 'mada', posVal: 12.5 }];
let ADVANCED3c = [];
advanceGoal = (id, u, p, pv) => { ADVANCED3c.push({ id, u, p, pv }); };
appendLogEntry = e => 'log3c';
resetClock(20, 0);
startSession({ goalId: 'g1' });
advance(15);
stopSession();
finishSession([{ goalId: 'g1', posVal: 20 }]);
eq('a real prior posVal is used as-is, not the startUnit baseline (12.5 -> 20 = 7.5)', ADVANCED3c[0].u, 7.5);

console.log('\n--- legacy callers with no posVal are unaffected (old wrap-up form) ---');
props = {};
FAKE_GOALS = [{ id: 'g1', name: 'x', unit: 'דף', startUnit: 2, posVal: 12, category: 'bavli', bookKey: 'taanit' }];
let ADVANCED4 = [];
advanceGoal = (id, u, p, pv) => { ADVANCED4.push({ id, u, p, pv }); };
appendLogEntry = e => { WRITTEN = [e]; return 'log4'; };
resetClock(20, 0);
startSession({ goalId: 'g1' });
advance(10);
stopSession();
finishSession([{ goalId: 'g1', reached: 'דף י״ד', units: 2 }]);
eq('no posVal sent -> units taken from the entry as before', ADVANCED4[0].u, 2);
eq('no posVal sent -> advanceGoal is not given a 4th argument', ADVANCED4[0].pv, undefined);
eq('the goal\'s numeric position is left untouched', WRITTEN[0].reachedVal, '');

console.log('\n--- advanceGoal never touches G_DONE when units are 0 ---');
let DONE_TOUCHED = false;
goalsSheet = () => ({
  getRange: (r, c) => ({
    getValue: () => 10,
    setValue: () => { if (c === G_DONE + 1) DONE_TOUCHED = true; }
  })
});
findRowById = () => 2;
REAL_advanceGoal('g1', 0, '', 39);
eq('G_DONE cell is never written when units = 0', DONE_TOUCHED, false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
