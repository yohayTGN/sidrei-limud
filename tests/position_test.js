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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
