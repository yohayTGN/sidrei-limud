/* Node harness for Api.gs. Loads Code.gs, SefariaCatalog.gs, Backup.gs and
   Api.gs into one scope — the specifically-not-reachable functions
   (syncCatalog, installIcon, migrateToV2/V3, backupNow) must actually exist
   for "not on the allowlist" to mean anything, rather than "doesn't exist". */
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

/* Minimal ContentService stub: createTextOutput(text).setMimeType(m) chains
   and returns an object exposing the text and mime for assertions. */
global.ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: (text) => {
    const out = { _text: text, _mime: null };
    out.setMimeType = function (m) { out._mime = m; return out; };
    return out;
  }
};

function loadGs(f) {
  return fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8').replace(/^const /gm, 'var ');
}
// eval'd directly at top level (not inside a function) so the declarations
// land in this module's scope, not a throwaway callback scope.
eval(loadGs('Code.gs'));
eval(loadGs('SefariaCatalog.gs'));
eval(loadGs('Backup.gs'));
eval(loadGs('Api.gs'));

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? '  ✓ ' : '  ✗ ') + label +
    (ok ? '' : `   got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`));
  ok ? pass++ : fail++;
}

function makeEvent(bodyObj) {
  return { postData: { contents: JSON.stringify(bodyObj) } };
}
function makeRawEvent(rawString) {
  return { postData: { contents: rawString } };
}
function callApi(bodyObj) {
  return JSON.parse(doPost(makeEvent(bodyObj))._text);
}

const TOKEN = 'test-secret-token-123';

console.log('\n--- a valid call ---');
props = { apiToken: TOKEN };
let res = callApi({ token: TOKEN, fn: 'getCatalog', args: [] });
eq('ok: true', res.ok, true);
eq('data is the real catalog (not stubbed, not empty)', Array.isArray(res.data) && res.data.length > 0, true);

console.log('\n--- response shape and mime, even on success ---');
const raw = doPost(makeEvent({ token: TOKEN, fn: 'getCatalog', args: [] }));
eq('always JSON content type', raw._mime, 'application/json');

console.log('\n--- wrong token ---');
res = callApi({ token: 'not-the-token', fn: 'getCatalog', args: [] });
eq('rejected', res.ok, false);
eq('error message does not leak the expected token', res.error.indexOf(TOKEN) === -1, true);
eq('error message does not echo the wrong token back either', res.error.indexOf('not-the-token') === -1, true);

console.log('\n--- unset apiToken rejects everything ---');
props = {};   // no apiToken property at all
res = callApi({ token: TOKEN, fn: 'getCatalog', args: [] });
eq('rejected even with what would otherwise be the right-shaped token', res.ok, false);
eq('fails closed, not open', /apiToken/.test(res.error), true);
res = callApi({ token: '', fn: 'getCatalog', args: [] });
eq('rejected with an empty token too', res.ok, false);

console.log('\n--- function not on the allowlist ---');
props = { apiToken: TOKEN };
res = callApi({ token: TOKEN, fn: 'readGoals', args: [] });
eq('rejected by name', res.ok, false);
eq('names the rejected function', res.error.indexOf('readGoals') > -1, true);

console.log('\n--- maintenance/migration functions exist, but are specifically unreachable ---');
eq('syncCatalog exists in this project', typeof syncCatalog, 'function');
eq('syncCatalog is not reachable via the API', callApi({ token: TOKEN, fn: 'syncCatalog', args: [] }).ok, false);
eq('installIcon exists in this project', typeof installIcon, 'function');
eq('installIcon is not reachable via the API', callApi({ token: TOKEN, fn: 'installIcon', args: [] }).ok, false);
eq('migrateToV2 exists in this project', typeof migrateToV2, 'function');
eq('migrateToV2 is not reachable via the API', callApi({ token: TOKEN, fn: 'migrateToV2', args: [] }).ok, false);
eq('migrateToV3 exists in this project', typeof migrateToV3, 'function');
eq('migrateToV3 is not reachable via the API', callApi({ token: TOKEN, fn: 'migrateToV3', args: [] }).ok, false);
eq('backupNow exists in this project', typeof backupNow, 'function');
eq('backupNow is not reachable via the API', callApi({ token: TOKEN, fn: 'backupNow', args: [] }).ok, false);

console.log('\n--- a thrown error comes back as { ok:false }, never uncaught ---');
saveGoal = () => { throw new Error('שגיאה מכוונת לבדיקה'); };
let threw = false;
let errRes;
try {
  errRes = callApi({ token: TOKEN, fn: 'saveGoal', args: [{}] });
} catch (e) { threw = true; }
eq('doPost itself never throws', threw, false);
eq('the thrown error is surfaced as ok:false', errRes.ok, false);
eq('the thrown message is passed through', errRes.error, 'שגיאה מכוונת לבדיקה');

console.log('\n--- args are applied positionally ---');
let SEEN_ARGS = null;
saveWeekPlan = (weekStart, blocks) => { SEEN_ARGS = [weekStart, blocks]; return { status: 'saved' }; };
res = callApi({ token: TOKEN, fn: 'saveWeekPlan', args: ['2026-09-13', [{ a: 1 }]] });
eq('multiple positional args reach the real function in order',
  SEEN_ARGS, ['2026-09-13', [{ a: 1 }]]);
eq('and its return value comes back as data', res.data, { status: 'saved' });

console.log('\n--- missing args defaults to an empty call, not a crash ---');
let calledWithNoArgs = false;
getSyncState = () => { calledWithNoArgs = true; return { session: null }; };
res = callApi({ token: TOKEN, fn: 'getSyncState' });   // no args key at all
eq('missing args key does not throw', res.ok, true);
eq('function was still called', calledWithNoArgs, true);

console.log('\n--- malformed JSON body ---');
res = JSON.parse(doPost(makeRawEvent('{ this is not json'))._text);
eq('rejected cleanly, not thrown', res.ok, false);
res = JSON.parse(doPost(makeRawEvent(''))._text);
eq('empty body rejected cleanly', res.ok, false);
res = JSON.parse(doPost({})._text);
eq('missing postData entirely does not crash doPost', res.ok, false);
res = JSON.parse(doPost(makeRawEvent('"just a string"'))._text);
eq('valid JSON that is not an object is rejected', res.ok, false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
