/* Tests for SefariaCatalog.gs (hierarchy version) */
const fs = require('fs');
global.SpreadsheetApp = { getActiveSpreadsheet: () => null };
global.Logger = { log: () => {} };
global.Utilities = { getUuid: () => 'id', sleep: () => {}, formatDate: () => 'now' };
global.UrlFetchApp = {};
eval(fs.readFileSync(require('path').join(__dirname, '..', 'apps-script', 'SefariaCatalog.gs'), 'utf8').replace(/^const /gm, 'var '));

let pass = 0, fail = 0;
function eq(l, a, b) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log((ok ? '  \u2713 ' : '  \u2717 ') + l + (ok ? '' : `   got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));
  ok ? pass++ : fail++;
}

console.log('\n--- gematria ---');
eq('12 -> י״ב', numToHebrew(12), 'י״ב');
eq('15 -> ט״ו', numToHebrew(15), 'ט״ו');
eq('16 -> ט״ז', numToHebrew(16), 'ט״ז');
eq('115 -> קט״ו', numToHebrew(115), 'קט״ו');
eq('176 -> קע״ו', numToHebrew(176), 'קע״ו');
eq('697 -> תרצ״ז', numToHebrew(697), 'תרצ״ז');
let rt = [];
for (let n = 1; n <= 999; n++) if (hebrewToNum(numToHebrew(n)) !== n) rt.push(n);
eq('round-trip 1..999', rt.length, 0);

console.log('\n--- daf range (zero-scan) ---');
let ch = new Array(61).fill(9); ch[0] = ch[1] = 0;
let r0 = talmudRange(ch);
eq('Taanit = 30 dapim, 2a..31a', [r0.dapim, r0.startValue, r0.endValue], [30, 2, 31]);
ch = new Array(66).fill(0); for (let i = 49; i <= 65; i++) ch[i] = 9;
r0 = talmudRange(ch);
eq('Tamid = 9 dapim starting 25b', [r0.dapim, r0.startValue], [9, 25.5]);
eq('naive length formula would say 32', Math.ceil((66 - 2) / 2), 32);

console.log('\n--- Rambam: halachot are SECTIONS, sefarim are BOOKS ---');
const rambamSrc = CATALOG_SOURCES.filter(s => s.key === 'rambam')[0];
const maddaNodes = [
  { section: 'Sefer Madda', title: 'MT, Foundations', heTitle: 'משנה תורה, הלכות יסודי התורה', length: 10 },
  { section: 'Sefer Madda', title: 'MT, Dispositions', heTitle: 'משנה תורה, הלכות דעות', length: 7 },
  { section: 'Sefer Madda', title: 'MT, Torah Study', heTitle: 'משנה תורה, הלכות תלמוד תורה', length: 7 },
  { section: 'Sefer Madda', title: 'MT, Foreign Worship', heTitle: 'משנה תורה, הלכות עבודה זרה וחוקות הגויים', length: 12 },
  { section: 'Sefer Madda', title: 'MT, Repentance', heTitle: 'משנה תורה, הלכות תשובה', length: 10 }
];
let entries = maddaNodes.map(n => nodeToEntry_(rambamSrc, n));
assignOffsets_(entries);

eq('book is the sefer, not the halachot', entries[0].book, 'ספר המדע');
eq('section is the halachot, prefix stripped', entries.map(e => e.section),
  ['הלכות יסודי התורה', 'הלכות דעות', 'הלכות תלמוד תורה',
   'הלכות עבודה זרה וחוקות הגויים', 'הלכות תשובה']);
eq('all five belong to one book', new Set(entries.map(e => e.book)).size, 1);
eq('section indices sequential', entries.map(e => e.sectionIdx), [0, 1, 2, 3, 4]);
eq('offsets accumulate chapters', entries.map(e => e.offset), [0, 10, 17, 24, 36]);
eq('Sefer Madda totals 46 chapters', entries.reduce((s, e) => s + e.units, 0), 46);

console.log('\n--- two-level position math ---');
const madda = {
  name: 'ספר המדע', unit: 'פרק', posType: 'number', total: 46,
  sections: entries.map(e => ({ name: e.section, idx: e.sectionIdx, offset: e.offset, chapters: e.units }))
};
eq('Hilchot Teshuvah ch.3 -> running value 39', positionToValue(madda, 4, 3), 39);
eq('...and back again', valueToPosition(madda, 39).chapter, 3);
eq('...to the right section', valueToPosition(madda, 39).section.name, 'הלכות תשובה');
eq('displays as expected', formatPosition(madda, 39), 'הלכות תשובה פרק ג׳');
eq('first chapter of the book', formatPosition(madda, 1), 'הלכות יסודי התורה פרק א׳');
eq('last chapter of the book', formatPosition(madda, 46), 'הלכות תשובה פרק י׳');
eq('boundary: ch.10 of the first halachot', formatPosition(madda, 10), 'הלכות יסודי התורה פרק י׳');
eq('boundary: ch.1 of the second', formatPosition(madda, 11), 'הלכות דעות פרק א׳');

const from = positionToValue(madda, 3, 12);
const to = positionToValue(madda, 4, 3);
eq('crossing a halachot boundary yields a real chapter count', to - from, 3);
eq('round-trip every chapter 1..46', (() => {
  for (let v = 1; v <= 46; v++) {
    const p = valueToPosition(madda, v);
    if (positionToValue(madda, p.sectionIdx, p.chapter) !== v) return v;
  }
  return 0;
})(), 0);

console.log('\n--- books without sections are unaffected ---');
const taanit = { name: 'תענית', unit: 'דף', posType: 'daf', total: 30, sections: [] };
eq('daf position formats normally', formatPosition(taanit, 12.5), 'דף י״ב ע״ב');
eq('no sections -> value passes through', positionToValue(taanit, 0, 12.5), 12.5);
const sa = { name: 'שולחן ערוך אורח חיים', unit: 'סימן', posType: 'number', total: 697, sections: [] };
eq('siman formats with its own unit', formatPosition(sa, 263), 'סימן רס״ג');

console.log('\n--- Bavli entries stay flat, grouped by seder ---');
const bavliSrc = CATALOG_SOURCES.filter(s => s.key === 'bavli')[0];
ch = new Array(61).fill(9); ch[0] = ch[1] = 0;
let e1 = nodeToEntry_(bavliSrc, { section: 'Seder Moed', title: 'Taanit', heTitle: 'תענית', chapters: ch });
eq('masechet is the book', e1.book, 'תענית');
eq('no section', e1.section, '');
eq('seder becomes the display group, in Hebrew', e1.group, 'מועד');
eq('30 dapim from 2 to 31', [e1.start, e1.end, e1.units], [2, 31, 30]);

console.log('\n--- filtering ---');
eq('Bavli keeps only the six sedarim', filterNodes_(bavliSrc, [
  { section: 'Seder Moed', title: 'Taanit' },
  { section: 'Minor Tractates', title: 'Tractate Tzitzit' },
  { section: 'Guides', title: '' },
  { section: 'Tziyyun LeNefesh Chayyah', title: 'Tziyyun on Chullin' }
]).map(n => n.title), ['Taanit']);
eq('Rambam drops intros, Steinsaltz, Kuntres Zikah, Seder HaTefillah',
  filterNodes_(rambamSrc, [
    { section: 'Sefer Madda', title: 'Mishneh Torah, Repentance' },
    { section: 'Introduction', title: 'Mishneh Torah, Positive Mitzvot' },
    { section: 'Steinsaltz', title: '' },
    { section: 'Sefer Nashim', title: 'Kuntres Zikah' },
    { section: 'Sefer Ahavah', title: 'Mishneh Torah, The Order of Prayer' }
  ]).map(n => n.title), ['Mishneh Torah, Repentance']);

console.log('\n--- full Rambam shape from the probe data ---');
const allRambam = [
  ['Sefer Madda', [10, 7, 7, 12, 10]], ['Sefer Ahavah', [4, 15, 10, 3, 11, 3]],
  ['Sefer Zemanim', [30, 8, 3, 8, 9, 8, 4, 19, 5, 4]], ['Sefer Nashim', [25, 13, 8, 3, 4]],
  ['Sefer Kedushah', [22, 17, 14]], ['Sefer Haflaah', [12, 13, 10, 8]],
  ['Sefer Zeraim', [10, 10, 15, 14, 11, 12, 13]],
  ['Sefer Avodah', [8, 10, 9, 7, 19, 10, 19, 5, 8]],
  ['Sefer Korbanot', [10, 3, 8, 15, 5, 4]],
  ['Sefer Taharah', [25, 15, 16, 13, 20, 16, 28, 11]],
  ['Sefer Nezikim', [14, 9, 18, 8, 13]], ['Sefer Kinyan', [30, 12, 14, 10, 9]],
  ['Sefer Mishpatim', [13, 8, 27, 16, 11]], ['Sefer Shoftim', [26, 22, 7, 14, 12]]
];
let all = [];
allRambam.forEach(function (pair) {
  pair[1].forEach(function (L, i) {
    all.push(nodeToEntry_(rambamSrc,
      { section: pair[0], title: 't' + i, heTitle: 'משנה תורה, הלכות x' + i, length: L }));
  });
});
assignOffsets_(all);
eq('14 books', new Set(all.map(x => x.book)).size, 14);
eq('83 sections', all.length, 83);
eq('every book name translated to Hebrew',
  all.filter(x => x.book.indexOf('ספר') !== 0).length, 0);
const perBook = {};
all.forEach(x => { perBook[x.book] = (perBook[x.book] || 0) + x.units; });
eq('Sefer Madda 46 chapters', perBook['ספר המדע'], 46);
eq('Sefer Taharah 144 chapters', perBook['ספר טהרה'], 144);
eq('grand total 1001 (canonical figure is 1000)',
  Object.keys(perBook).reduce((a, k) => a + perBook[k], 0), 1001);
eq('offsets restart at 0 for each book',
  all.filter(x => x.sectionIdx === 0).every(x => x.offset === 0), true);
eq('no offset exceeds its book total',
  all.every(x => x.offset + x.units <= perBook[x.book]), true);

console.log('\n--- row width ---');
eq('sefaria row matches headers', entryToRow_(all[0]).length, HEADERS_CATALOG.length);
eq('manual row matches headers', entryToRow_(manualToEntry_(CATALOG_MANUAL[0])).length, HEADERS_CATALOG.length);
eq('three manual books', CATALOG_MANUAL.map(m => m.book), ['שקלים', 'מידות', 'קינים']);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
