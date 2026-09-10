/**
 * ============================================================================
 *  SefariaCatalog.gs — סנכרון קטלוג הספרים מ-Sefaria
 * ============================================================================
 *
 *  שתי רמות, ובכוונה:
 *    ספר   — היחידה שבוחרים ולומדים. מסכת תענית. ספר המדע.
 *    חלק   — יחידת מיקום בתוך הספר. קיים רק ברמב״ם: הלכות תשובה.
 *
 *  ברוב הקטגוריות הספר הוא גם היחידה, ולכן אין חלקים. ברמב״ם הספר הוא
 *  אחד מי״ד הספרים, וההלכות הן חלקים בתוכו. לכל חלק נשמר "היסט" — מספר
 *  הפרקים שלפניו בספר — וכך (הלכות תשובה, פרק ג׳) הופך למספר יחיד
 *  שאפשר לחסר ולחשב בו התקדמות.
 *
 *  התקנה:
 *   1. + → Script → קרא לקובץ "SefariaCatalog" → הדבק.
 *   2. הרץ syncCatalog(), ואז verifyCatalog().
 *   3. פרוס מחדש (New version).
 *
 *  הרצה חוזרת בטוחה — הלשונית נכתבת מחדש במלואה.
 *  אל תקרא ל-syncCatalog מתוך doGet. זו פעולת תחזוקה, לא זמן ריצה.
 * ============================================================================
 */

const SEF_BASE = 'https://www.sefaria.org';
const SHEET_CATALOG = 'Catalog';

/* --- עמודות לשונית Catalog --- */
const C_CAT = 0, C_CATNAME = 1, C_GROUP = 2, C_BOOK = 3, C_SECTION = 4,
      C_SECIDX = 5, C_OFFSET = 6, C_TITLE = 7, C_UNIT = 8, C_POSTYPE = 9,
      C_START = 10, C_END = 11, C_UNITS = 12, C_SOURCE = 13,
      C_UPDATED = 14, C_ID = 15;
const HEADERS_CATALOG = ['קטגוריה', 'שם קטגוריה', 'קבוצה', 'ספר', 'חלק',
  'מספר חלק', 'היסט', 'כותרת Sefaria', 'יחידה', 'סוג מיקום',
  'מתחיל ב', 'מסתיים ב', 'יחידות', 'מקור', 'עודכן', 'מזהה'];

/** שמות י״ד הספרים. Sefaria מחזירה אותם באנגלית בשדה section. */
const SEFER_HE = {
  'Sefer Madda': 'ספר המדע',
  'Sefer Ahavah': 'ספר אהבה',
  'Sefer Zemanim': 'ספר זמנים',
  'Sefer Nashim': 'ספר נשים',
  'Sefer Kedushah': 'ספר קדושה',
  'Sefer Haflaah': 'ספר הפלאה',
  'Sefer Zeraim': 'ספר זרעים',
  'Sefer Avodah': 'ספר עבודה',
  'Sefer Korbanot': 'ספר קרבנות',
  'Sefer Taharah': 'ספר טהרה',
  'Sefer Nezikim': 'ספר נזיקין',
  'Sefer Kinyan': 'ספר קניין',
  'Sefer Mishpatim': 'ספר משפטים',
  'Sefer Shoftim': 'ספר שופטים'
};

/**
 *  mode 'category' — קריאה אחת שמחזירה רשימה.
 *  mode 'titles'   — שם עברי לכל ספר, שנפתר דרך /api/name ואז /api/shape.
 *  posType 'daf'    — מיקום = דף.עמוד (12.0 / 12.5)
 *  posType 'number' — מיקום = מספר שלם (פרק / סימן)
 *  hasSections      — הצמתים הם חלקים בתוך ספר, לא ספרים בפני עצמם.
 */
const CATALOG_SOURCES = [
  {
    key: 'bavli', name: 'תלמוד בבלי', icon: '📖', unit: 'דף', posType: 'daf',
    mode: 'category', path: '/api/shape/Talmud%2FBavli?depth=1',
    keepSections: ['Seder Zeraim', 'Seder Moed', 'Seder Nashim',
                   'Seder Nezikin', 'Seder Kodashim', 'Seder Tahorot'],
    groupHe: { 'Seder Zeraim': 'זרעים', 'Seder Moed': 'מועד', 'Seder Nashim': 'נשים',
               'Seder Nezikin': 'נזיקין', 'Seder Kodashim': 'קדשים',
               'Seder Tahorot': 'טהרות' },
    expect: { books: 37 }
  },
  {
    key: 'mishnayot', name: 'משנה', icon: '📕', unit: 'פרק', posType: 'number',
    mode: 'category', path: '/api/shape/Mishnah?depth=1',
    groupHe: { 'Seder Zeraim': 'זרעים', 'Seder Moed': 'מועד', 'Seder Nashim': 'נשים',
               'Seder Nezikin': 'נזיקין', 'Seder Kodashim': 'קדשים',
               'Seder Tahorot': 'טהרות' },
    stripPrefix: /^משנה\s+/
  },
  {
    key: 'rambam', name: 'רמב״ם — משנה תורה', icon: '📜', unit: 'פרק', posType: 'number',
    mode: 'category', path: '/api/shape/Halakhah%2FMishneh%20Torah?depth=1',
    dropSections: ['Introduction', 'Steinsaltz'],
    // "קונטרס זיקה" אינו מהחיבור. "סדר התפילה" הוא נספח לספר אהבה ואינו
    // אחת מ-83 ההלכות — בלעדיו הספירה יוצאת בדיוק 83.
    dropTitles: ['Kuntres Zikah', 'Mishneh Torah, The Order of Prayer'],
    // הצומת הוא הלכות (חלק), והספר הוא אחד מי״ד — לקוח משדה section
    hasSections: true,
    bookFrom: 'section', bookHeMap: SEFER_HE,
    stripPrefix: /^משנה תורה,\s*/,
    expect: { books: 14, sections: 83 }
  },
  {
    key: 'tanach', name: 'תנ״ך', icon: '📘', unit: 'פרק', posType: 'number',
    mode: 'category', path: '/api/shape/Tanakh?depth=1',
    groupHe: { 'Torah': 'תורה', 'Prophets': 'נביאים', 'Writings': 'כתובים' },
    expect: { books: 39 }
  },
  {
    key: 'halacha', name: 'הלכה', icon: '⚖️', unit: 'סימן', posType: 'number',
    mode: 'titles',
    titles: ['שולחן ערוך אורח חיים', 'שולחן ערוך יורה דעה',
             'שולחן ערוך אבן העזר', 'שולחן ערוך חושן משפט',
             'קיצור שולחן ערוך', 'משנה ברורה']
  },
  {
    key: 'machshava', name: 'מחשבה ומוסר', icon: '💭', unit: 'פרק', posType: 'number',
    mode: 'titles',
    titles: ['מסילת ישרים', 'חובות הלבבות', 'שערי תשובה', 'אורחות צדיקים',
             'נפש החיים', 'הכוזרי', 'דרך ה׳', 'פרקי אבות']
  }
];

/**
 * ספרים ש-Sefaria לא מספקת תחת הקטגוריה שלנו, מסיבות נכונות:
 *  שקלים — אין עליה בבלי; שבש״ס היא ירושלמי.
 *  מידות, קינים — אין עליהן גמרא כלל, רק משנה.
 * שלושתן מודפסות בש״ס ונלמדות בדף היומי, ולכן נשארות ידנית.
 */
const CATALOG_MANUAL = [
  { cat: 'bavli', group: 'מועד', book: 'שקלים', title: 'Jerusalem Talmud Shekalim',
    unit: 'דף', posType: 'daf', start: 2, end: 22, units: 21 },
  { cat: 'bavli', group: 'קדשים', book: 'מידות', title: 'Mishnah Middot',
    unit: 'דף', posType: 'daf', start: 34, end: 37, units: 4 },
  { cat: 'bavli', group: 'קדשים', book: 'קינים', title: 'Mishnah Kinnim',
    unit: 'דף', posType: 'daf', start: 22, end: 24, units: 3 }
];


/* ==========================================================================
   1. גימטריה
   --------------------------------------------------------------------------
   Sefaria מחזירה מחרוזת עברית מוכנה ב-/api/ref, אבל לא נרצה קריאת רשת
   לכל רינדור. ממירים מקומית ומשתמשים ב-Sefaria כאימות בלבד.
   ========================================================================== */

const HEB_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const HEB_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HEB_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];

/** 12 → י״ב · 15 → ט״ו · 176 → קע״ו */
function numToHebrew(n) {
  n = Math.floor(Number(n));
  if (!(n > 0) || n > 999) return String(n);
  let out = HEB_HUNDREDS[Math.floor(n / 100)];
  const rem = n % 100;
  if (rem === 15) out += 'טו';
  else if (rem === 16) out += 'טז';
  else out += HEB_TENS[Math.floor(rem / 10)] + HEB_ONES[rem % 10];
  if (out.length === 1) return out + '׳';
  return out.slice(0, -1) + '״' + out.slice(-1);
}

function hebrewToNum(s) {
  if (s === null || s === undefined) return 0;
  const vals = { 'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9,
                 'י':10,'כ':20,'ך':20,'ל':30,'מ':40,'ם':40,'נ':50,'ן':50,
                 'ס':60,'ע':70,'פ':80,'ף':80,'צ':90,'ץ':90,
                 'ק':100,'ר':200,'ש':300,'ת':400 };
  let total = 0, found = false;
  const clean = String(s).replace(/["'\u05f3\u05f4\s]/g, '');
  for (let i = 0; i < clean.length; i++) {
    const v = vals[clean.charAt(i)];
    if (v) { total += v; found = true; }
  }
  return found ? total : 0;
}

function formatDafPosition(value) {
  const daf = Math.floor(value);
  const isBet = Math.abs(value - daf - 0.5) < 0.01;
  return 'דף ' + numToHebrew(daf) + ' ע' + (isBet ? '״ב' : '״א');
}


/* ==========================================================================
   2. מיקום דו-שכבתי
   --------------------------------------------------------------------------
   ספר עם חלקים מאחסן מיקום כמספר רץ אחד: היסט החלק ועוד הפרק בתוכו.
   כך (הלכות תשובה, פרק ג׳) הוא מספר יחיד, וההפרש בין שני מיקומים הוא
   מספר הפרקים שנלמדו — גם כשחוצים גבול בין הלכות.
   ========================================================================== */

/** (חלק, פרק) → ערך רץ בתוך הספר. */
function positionToValue(book, sectionIdx, chapter) {
  if (!book || !book.sections || !book.sections.length) return Number(chapter) || 0;
  const sec = book.sections[sectionIdx];
  if (!sec) return Number(chapter) || 0;
  return sec.offset + (Number(chapter) || 0);
}

/** ערך רץ → (חלק, פרק). */
function valueToPosition(book, value) {
  value = Number(value) || 0;
  if (!book || !book.sections || !book.sections.length) {
    return { sectionIdx: -1, section: null, chapter: value };
  }
  for (let i = book.sections.length - 1; i >= 0; i--) {
    const sec = book.sections[i];
    if (value > sec.offset) {
      return { sectionIdx: i, section: sec, chapter: value - sec.offset };
    }
  }
  return { sectionIdx: 0, section: book.sections[0], chapter: value };
}

/** ערך → טקסט לתצוגה. "הלכות תשובה פרק ג׳" / "דף י״ב ע״ב" / "סימן רס״ג". */
function formatPosition(book, value) {
  if (value === null || value === undefined || value === '') return '';
  if (!book) return String(value);
  if (book.posType === 'daf') return formatDafPosition(value);
  if (book.sections && book.sections.length) {
    const p = valueToPosition(book, value);
    if (p.section) return p.section.name + ' פרק ' + numToHebrew(p.chapter);
  }
  return (book.unit || 'פרק') + ' ' + numToHebrew(value);
}


/* ==========================================================================
   3. טווח דפים אמיתי מתוך מערך ה-chapters
   --------------------------------------------------------------------------
   Sefaria מאנדקסת גמרא לפי עמוד ומתחילה מדף א׳ שאינו קיים, ולכן שני
   האיברים הראשונים אפס. מסכת שאינה מתחילה בדף ב׳ מרופדת באפסים עד
   ההתחלה האמיתית — תמיד מתחילה בכ״ה ע״ב. הסתמכות על length לבדו
   נותנת לתמיד 32 דפים במקום 9, בשקט. לכן סורקים את האפסים.
   ========================================================================== */

function talmudRange(chapters) {
  if (!chapters || !chapters.length) return null;
  let first = -1, last = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i] > 0) { if (first === -1) first = i; last = i; }
  }
  if (first === -1) return null;
  const startDaf = Math.floor(first / 2) + 1;
  const endDaf = Math.floor(last / 2) + 1;
  return {
    startDaf: startDaf, startAmud: (first % 2 === 0) ? 'a' : 'b',
    endDaf: endDaf, endAmud: (last % 2 === 0) ? 'a' : 'b',
    startValue: startDaf + (first % 2 === 0 ? 0 : 0.5),
    endValue: endDaf + (last % 2 === 0 ? 0 : 0.5),
    dapim: endDaf - startDaf + 1,
    amudim: last - first + 1
  };
}


/* ==========================================================================
   4. רשת
   ========================================================================== */

function sefFetch_(path, attempt) {
  const url = SEF_BASE + path;
  attempt = attempt || 1;
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true, followRedirects: true,
      headers: { 'Accept': 'application/json' }
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      // 5xx הוא כשל זמני בצד השרת (ראינו 504 על הכוזרי) — שווה ניסיון שני
      if (code >= 500 && attempt < 3) {
        Utilities.sleep(1500 * attempt);
        return sefFetch_(path, attempt + 1);
      }
      return { ok: false, error: 'HTTP ' + code + (attempt > 1 ? ' אחרי ' + attempt + ' ניסיונות' : '') };
    }
    const json = JSON.parse(res.getContentText());
    if (json && json.error) return { ok: false, error: json.error };
    return { ok: true, data: json };
  } catch (e) {
    if (attempt < 3) { Utilities.sleep(1500 * attempt); return sefFetch_(path, attempt + 1); }
    return { ok: false, error: e.message };
  }
}

/**
 * שם עברי → כותרת Sefaria, בהעדפת התאמה מדויקת.
 * "משנה תורה" מחזיר כהתאמה ראשונה את הלכות אבל, ולכן אסור לקחת עיוור
 * את האיבר הראשון.
 */
function sefResolveTitle_(hebrewName) {
  const r = sefFetch_('/api/name/' + encodeURIComponent(hebrewName));
  if (!r.ok) return null;
  const objs = r.data.completion_objects || [];
  for (let i = 0; i < objs.length; i++) {
    if (objs[i].title === hebrewName && objs[i].key) return objs[i].key;
  }
  for (let i = 0; i < objs.length; i++) {
    if (objs[i].is_primary && objs[i].key) return objs[i].key;
  }
  return objs.length ? (objs[0].key || null) : null;
}


/* ==========================================================================
   5. המרה
   ========================================================================== */

function filterNodes_(src, nodes) {
  return nodes.filter(function (n) {
    if (!n) return false;
    const sec = String(n.section || '');
    const title = String(n.title || '');
    if (src.keepSections && src.keepSections.indexOf(sec) === -1) return false;
    if (src.dropSections && src.dropSections.indexOf(sec) !== -1) return false;
    if (src.dropTitles && src.dropTitles.indexOf(title) !== -1) return false;
    return true;
  });
}

/** צומת Sefaria → רשומת ביניים. ההיסטים מחושבים בשלב נפרד. */
function nodeToEntry_(src, node) {
  let he = String(node.heTitle || '').trim();
  const title = String(node.title || '').trim();
  if (!he && !title) return null;
  if (src.stripPrefix) he = he.replace(src.stripPrefix, '').trim();

  const sectionEn = String(node.section || '');
  let start, end, units;

  if (src.posType === 'daf') {
    const range = talmudRange(node.chapters);
    if (!range) return null;
    start = range.startValue; end = range.endValue; units = range.dapim;
  } else {
    const len = Number(node.length);
    if (!(len > 0)) return null;
    start = 1; end = len; units = len;
  }

  const entry = {
    cat: src.key, catName: src.name, unit: src.unit, posType: src.posType,
    title: title, start: start, end: end, units: units, source: 'sefaria',
    sectionIdx: 0, offset: 0
  };

  if (src.hasSections) {
    // הצומת הוא חלק; הספר נלקח מ-section ומתורגם לעברית
    entry.book = (src.bookHeMap && src.bookHeMap[sectionEn]) || sectionEn;
    entry.section = he;
    entry.group = '';
  } else {
    entry.book = he;
    entry.section = '';
    entry.group = (src.groupHe && src.groupHe[sectionEn]) || sectionEn || '—';
  }
  return entry;
}

/**
 * מחשב מספר חלק והיסט לכל חלק, לפי סדר ההופעה בתוך כל ספר.
 * הסדר שמגיע מ-Sefaria הוא הסדר הקנוני של ההלכות בספר.
 */
function assignOffsets_(entries) {
  const running = {};
  const counters = {};
  entries.forEach(function (e) {
    if (!e.section) return;
    const k = e.cat + '|' + e.book;
    if (running[k] === undefined) { running[k] = 0; counters[k] = 0; }
    e.sectionIdx = counters[k];
    e.offset = running[k];
    running[k] += e.units;
    counters[k] += 1;
  });
  return entries;
}

function entryToRow_(e) {
  return [e.cat, e.catName, e.group || '', e.book, e.section || '',
          e.sectionIdx, e.offset, e.title, e.unit, e.posType,
          e.start, e.end, e.units, e.source, '', ''];
}

function manualToEntry_(m) {
  return { cat: m.cat, catName: catNameFor_(m.cat), group: m.group, book: m.book,
           section: '', sectionIdx: 0, offset: 0, title: m.title, unit: m.unit,
           posType: m.posType, start: m.start, end: m.end, units: m.units,
           source: 'manual' };
}

function catNameFor_(key) {
  for (let i = 0; i < CATALOG_SOURCES.length; i++) {
    if (CATALOG_SOURCES[i].key === key) return CATALOG_SOURCES[i].name;
  }
  return key;
}

function catalogIconFor_(key) {
  for (let i = 0; i < CATALOG_SOURCES.length; i++) {
    if (CATALOG_SOURCES[i].key === key) return CATALOG_SOURCES[i].icon;
  }
  return '📚';
}


/* ==========================================================================
   6. הסנכרון
   ========================================================================== */

function catalogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_CATALOG);
  if (!sheet) sheet = ss.insertSheet(SHEET_CATALOG);
  return sheet;
}

function syncCatalog() {
  const report = [];
  let entries = [];
  const stamp = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd HH:mm');

  CATALOG_SOURCES.forEach(function (src) {
    const mine = [];
    let skipped = 0;

    if (src.mode === 'category') {
      const r = sefFetch_(src.path);
      if (!r.ok) { report.push('✗ ' + src.name + ' — ' + r.error); return; }
      const nodes = filterNodes_(src, Array.isArray(r.data) ? r.data : [r.data]);
      nodes.forEach(function (n) {
        const e = nodeToEntry_(src, n);
        if (e) mine.push(e); else skipped++;
      });
      assignOffsets_(mine);
    } else {
      // מצב titles — מדווחים לכל ספר בנפרד, כדי שכישלון יהיה בעל שם
      src.titles.forEach(function (heName) {
        Utilities.sleep(250);
        const key = sefResolveTitle_(heName);
        if (!key) { report.push('  ✗ ' + heName + ' — לא נמצא ב-Sefaria'); return; }
        const r = sefFetch_('/api/shape/' + encodeURIComponent(key));
        if (!r.ok) { report.push('  ✗ ' + heName + ' — ' + r.error); return; }

        const nodes = Array.isArray(r.data) ? r.data : [r.data];
        const got = [];
        nodes.forEach(function (n) {
          const e = nodeToEntry_(src, n);
          if (e) got.push(e);
        });

        if (!got.length) {
          // בדרך כלל "טקסט מורכב": הספר בנוי משערים עם מבנה מקונן,
          // ולכן אין שדה length ברמה העליונה
          report.push('  ✗ ' + heName + ' — ' + key + ': ' + nodes.length +
                      ' צמתים, אף אחד בלי אורך (טקסט מורכב)');
          skipped++;
          return;
        }
        if (got.length > 1) {
          report.push('  · ' + heName + ' — פוצל ל-' + got.length + ' חלקים');
        }
        got.forEach(function (e) { mine.push(e); });
      });
    }

    const books = {};
    mine.forEach(function (e) { books[e.book] = true; });
    const bookCount = Object.keys(books).length;

    let line = (mine.length ? '✓ ' : '✗ ') + src.name + ': ' + bookCount + ' ספרים';
    if (src.hasSections) line += ' · ' + mine.length + ' חלקים';
    if (skipped) line += ' (' + skipped + ' דולגו — בלי נתוני אורך)';
    if (src.expect) {
      if (src.expect.books) line += bookCount === src.expect.books
        ? ' ✓' : ' ⚠ צפוי ' + src.expect.books + ' ספרים';
      if (src.expect.sections) line += mine.length === src.expect.sections
        ? ' ✓' : ' ⚠ צפוי ' + src.expect.sections + ' חלקים';
    }
    report.push(line);
    entries = entries.concat(mine);
    Utilities.sleep(250);
  });

  CATALOG_MANUAL.forEach(function (m) { entries.push(manualToEntry_(m)); });
  report.push('+ ' + CATALOG_MANUAL.length + ' ספרים ידניים (שקלים, מידות, קינים)');

  if (!entries.length) {
    throw new Error('הסנכרון לא החזיר אף ספר. הקטלוג הקיים לא נגע.');
  }

  const rows = entries.map(entryToRow_);
  rows.forEach(function (r) { r[C_UPDATED] = stamp; r[C_ID] = Utilities.getUuid(); });

  // כתיבה אחת. appendRow בלולאה על מאות שורות יחרוג ממכסת הזמן.
  const sheet = catalogSheet();
  sheet.clear();
  sheet.getRange(1, 1, 1, HEADERS_CATALOG.length).setValues([HEADERS_CATALOG])
       .setFontWeight('bold').setBackground('#241C18').setFontColor('#F5EAE5');
  sheet.getRange(2, 1, rows.length, HEADERS_CATALOG.length).setValues(rows);
  sheet.setFrozenRows(1);

  report.push('');
  report.push('נכתבו ' + rows.length + ' שורות ללשונית ' + SHEET_CATALOG + '.');
  report.push('כעת פרוס מחדש (New version).');

  const msg = report.join('\n');
  Logger.log(msg);
  return msg;
}

/** קורא את הקטלוג מהגיליון בפורמט שהאפליקציה מצפה לו. */
function readCatalogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_CATALOG);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const data = sheet.getDataRange().getValues();

  // שמירה על התאמת סכימה. אם הלשונית נכתבה בגרסה אחרת של הקובץ הזה,
  // קריאה לפי האינדקסים הנוכחיים תשלוף עמודות שגויות בלי לזרוק שגיאה —
  // וזה בדיוק סוג הכשל שמייצר "ללא יעד מובנה" וספרים כפולים. עדיף
  // ליפול לקטלוג המובנה מאשר להציג נתונים מעורבבים.
  const header = data[0] || [];
  if (header.length !== HEADERS_CATALOG.length ||
      String(header[C_BOOK]) !== HEADERS_CATALOG[C_BOOK] ||
      String(header[C_UNITS]) !== HEADERS_CATALOG[C_UNITS]) {
    Logger.log('לשונית Catalog בסכימה אחרת (' + header.length + ' עמודות במקום ' +
               HEADERS_CATALOG.length + '). מתעלם ממנה ונופל לקטלוג המובנה. ' +
               'הרץ syncCatalog ופרוס מחדש.');
    return null;
  }

  const cats = {}, catOrder = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const catKey = String(r[C_CAT] || '');
    const bookName = String(r[C_BOOK] || '');
    if (!catKey || !bookName) continue;

    if (!cats[catKey]) {
      cats[catKey] = {
        key: catKey, name: String(r[C_CATNAME] || catKey),
        icon: catalogIconFor_(catKey), unit: String(r[C_UNIT] || 'יחידה'),
        posType: String(r[C_POSTYPE] || 'number'), startUnit: 1,
        note: '', books: [], _byName: {}
      };
      catOrder.push(catKey);
    }
    const cat = cats[catKey];

    if (!cat._byName[bookName]) {
      cat._byName[bookName] = {
        key: bookName, name: bookName, group: String(r[C_GROUP] || '—'),
        unit: String(r[C_UNIT] || 'יחידה'), posType: String(r[C_POSTYPE] || 'number'),
        sefariaTitle: String(r[C_TITLE] || ''), source: String(r[C_SOURCE] || ''),
        startValue: Number(r[C_START]) || 1, endValue: Number(r[C_END]) || 0,
        total: 0, sections: []
      };
      cat.books.push(cat._byName[bookName]);
    }
    const book = cat._byName[bookName];
    const units = Number(r[C_UNITS]) || 0;
    const sectionName = String(r[C_SECTION] || '');

    if (sectionName) {
      book.sections.push({
        name: sectionName, idx: Number(r[C_SECIDX]) || 0,
        offset: Number(r[C_OFFSET]) || 0, chapters: units,
        sefariaTitle: String(r[C_TITLE] || '')
      });
      book.total += units;             // סה״כ הספר = סכום חלקיו
      book.endValue = book.total;
    } else {
      book.total = units;
    }
  }

  if (!catOrder.length) return null;
  const out = catOrder.map(function (k) {
    const c = cats[k];
    c.books.forEach(function (b) {
      b.sections.sort(function (x, y) { return x.idx - y.idx; });
    });
    delete c._byName;
    return c;
  });
  out.push({ key: 'custom', name: 'אחר / מותאם אישית', icon: '✏️',
             unit: 'יחידה', posType: 'number', startUnit: 1,
             note: 'הגדר שם, יחידה וכמות בעצמך', books: [] });
  return out;
}

/** בדיקה אחרי סנכרון. הרץ וקרא את הלוג. */
function verifyCatalog() {
  const cat = readCatalogSheet();
  if (!cat) { Logger.log('הלשונית ריקה. הרץ syncCatalog.'); return 'ריק'; }
  const lines = [];

  cat.forEach(function (c) {
    if (!c.books.length) return;
    let sum = 0, sections = 0;
    c.books.forEach(function (b) { sum += b.total; sections += b.sections.length; });
    lines.push(c.icon + ' ' + c.name + ': ' + c.books.length + ' ספרים' +
               (sections ? ' · ' + sections + ' חלקים' : '') +
               ' · סה״כ ' + sum + ' ' + c.unit);
  });

  lines.push('');
  lines.push('בדיקות שפיות:');

  const bavli = cat.filter(function (c) { return c.key === 'bavli'; })[0];
  if (bavli) {
    const find = function (n) {
      return bavli.books.filter(function (b) { return b.name === n; })[0];
    };
    const taanit = find('תענית'), tamid = find('תמיד');
    if (taanit) lines.push('  תענית: ' + taanit.total + ' דפים (צפוי 30)');
    if (tamid) lines.push('  תמיד: ' + tamid.total + ' דפים, מתחילה ב' +
                          formatDafPosition(tamid.startValue) + ' (צפוי 9, כ״ה ע״ב)');
  }

  const rambam = cat.filter(function (c) { return c.key === 'rambam'; })[0];
  if (rambam) {
    lines.push('  רמב״ם: ' + rambam.books.length + ' ספרים (צפוי 14)');
    const madda = rambam.books.filter(function (b) { return b.name === 'ספר המדע'; })[0];
    if (madda) {
      lines.push('  ספר המדע: ' + madda.total + ' פרקים ב-' +
                 madda.sections.length + ' הלכות (צפוי 46 ב-5)');
      madda.sections.forEach(function (s) {
        lines.push('    · ' + s.name + ' — ' + s.chapters + ' פרקים, היסט ' + s.offset);
      });
      // הדגמת המיקום הדו-שכבתי
      const teshuva = madda.sections.filter(function (s) {
        return s.name.indexOf('תשובה') > -1; })[0];
      if (teshuva) {
        const v = positionToValue(madda, teshuva.idx, 3);
        lines.push('  מיקום לדוגמה: ' + formatPosition(madda, v) +
                   ' → ערך ' + v + ' מתוך ' + madda.total);
      }
    }
  }

  const msg = lines.join('\n');
  Logger.log(msg);
  return msg;
}
