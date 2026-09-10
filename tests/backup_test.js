/* Tests for Backup.gs pure logic */
const fs = require('fs');
global.PropertiesService = { getUserProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) };
global.DriveApp = {}; global.SpreadsheetApp = {}; global.ScriptApp = {};
global.Logger = { log: () => {} }; global.MimeType = {}; global.Session = {}; global.MailApp = {};
global.Utilities = { formatDate: () => '2026-09-13-0500' };
eval(fs.readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Backup.gs'), 'utf8').replace(/^const /gm, 'var '));

let pass = 0, fail = 0;
function eq(l, a, b) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log((ok ? '  \u2713 ' : '  \u2717 ') + l + (ok ? '' : `   got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));
  ok ? pass++ : fail++;
}

console.log('\n--- file naming ---');
eq('sheet copy has no extension', backupFileName_('2026-09-13-0500', 'sheet'),
  'סדרי-לימוד-גיבוי-2026-09-13-0500');
eq('json copy gets .json', backupFileName_('2026-09-13-0500', 'json'),
  'סדרי-לימוד-גיבוי-2026-09-13-0500.json');
eq('names sort lexicographically = chronologically',
  ['2026-01-05-0500','2026-09-13-0500','2026-02-01-0500'].map(d => backupFileName_(d,'sheet')).sort(),
  ['2026-01-05-0500','2026-02-01-0500','2026-09-13-0500'].map(d => backupFileName_(d,'sheet')));

console.log('\n--- rotation ---');
function mk(n, kind) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(2026, 0, 1 + i * 7).toISOString();
    out.push({ name: backupFileName_('d' + i, kind), date: d });
  }
  return out;
}
eq('under the limit -> nothing deleted', filesToTrash_(mk(5, 'sheet'), 8).length, 0);
eq('exactly at the limit -> nothing deleted', filesToTrash_(mk(8, 'sheet'), 8).length, 0);
eq('over the limit -> oldest deleted', filesToTrash_(mk(11, 'sheet'), 8).length, 3);
let doomed = filesToTrash_(mk(11, 'sheet'), 8).map(f => f.name);
eq('the three OLDEST go, not the newest',
  doomed, ['סדרי-לימוד-גיבוי-d2', 'סדרי-לימוד-גיבוי-d1', 'סדרי-לימוד-גיבוי-d0']);

console.log('\n--- the two formats rotate independently ---');
const mixed = mk(10, 'sheet').concat(mk(10, 'json'));
doomed = filesToTrash_(mixed, 8);
eq('20 files, keep 8 of each -> 4 deleted', doomed.length, 4);
eq('two of each kind deleted',
  [doomed.filter(f => /\.json$/.test(f.name)).length,
   doomed.filter(f => !/\.json$/.test(f.name)).length], [2, 2]);
eq('a flood of one kind never evicts the other',
  filesToTrash_(mk(30, 'json').concat(mk(3, 'sheet')), 8)
    .filter(f => !/\.json$/.test(f.name)).length, 0);
eq('empty folder is fine', filesToTrash_([], 8), []);

console.log('\n--- JSON cell encoding ---');
eq('plain string passes through', cellToJson_('דף י״ב'), 'דף י״ב');
eq('number passes through', cellToJson_(30), 30);
eq('empty passes through', cellToJson_(''), '');
eq('Date is tagged, not stringified into ambiguity',
  cellToJson_(new Date(Date.UTC(2026, 8, 8, 17, 30))),
  { __date: '2026-09-08T17:30:00.000Z' });
eq('a tagged date survives JSON round-trip',
  JSON.parse(JSON.stringify(cellToJson_(new Date(Date.UTC(2026, 8, 8))))).__date,
  '2026-09-08T00:00:00.000Z');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
