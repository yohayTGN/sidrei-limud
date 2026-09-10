/** @OnlyCurrentDoc */
/**
 * ============================================================================
 *  מנהל סדרי הלימוד — Study Session Manager  |  גרסה 2.1
 *  Backend (Code.gs) — Google Apps Script + Google Sheets
 * ============================================================================
 *
 *  חדש ב-2.1 — היפוך סדר התהליך:
 *   • יעד (סה״כ יחידות) הוא אופציונלי. total = 0 פירושו "ספר בלי יעד":
 *     נספרות יחידות מצטברות, בלי פס התקדמות. אי אפשר יותר להיתקע בכניסה
 *     בגלל שאינך יודע כמה פרקים יש בספר.
 *   • המסלול היומי מונע מהלוח: נכנסים לסדר, הספר כבר משויך, כפתור אחד.
 *   • בחירת ספרים והצבת יעדים עברו לטקס השבועי של מוצ״ש.
 *
 *  חדש ב-2.0:
 *   • קטלוג ספרים מובנה (בבלי / רמב״ם / משנה / הלכה / מחשבה) במקום טקסט חופשי
 *   • מימד "סדר" (בוקר / צהריים / ערב) בתכנון, ביומן, ברישום ובסטטיסטיקה
 *   • מיגרציה אוטומטית מגרסה 1 — עמודות חדשות בסוף, נתונים קיימים נשמרים
 *
 *  שדרוג:
 *   1. החלף את תוכן Code.gs ואת Index.html
 *   2. הרץ migrateToV2() מהעורך (בטוח להרצה חוזרת)
 *   3. Deploy → Manage deployments → ✏️ → Version: NEW VERSION
 *   גרסה 2.1 אינה משנה סכימה — אין עמודות חדשות מעבר ל-2.0.
 *
 *  התקנה מאפס:
 *   1. גיליון → Extensions → Apps Script (סקריפט כבול לגיליון!)
 *   2. הדבק Code.gs, ואז + → HTML בשם "Index" והדבק Index.html
 *   3. ⚙️ Project Settings → Time zone → Asia/Jerusalem  (קריטי ליומן)
 *   4. הרץ setupSpreadsheet() — יוצר לשוניות ופותח את מסך ההרשאות
 *   5. Deploy → New deployment → Web app → Execute as: Me / Only myself
 * ============================================================================
 */


/* ==========================================================================
   1. קונפיגורציה
   ========================================================================== */

const TZ = 'Asia/Jerusalem';
const APP_TITLE = 'מנהל סדרי הלימוד';
const APP_VERSION = '2.3';

/** אם הסקריפט אינו כבול לגיליון, הדבק כאן את ה-ID. */
const SPREADSHEET_ID = '';

const SHEET_GOALS   = 'Goals';
const SHEET_PLAN    = 'WeeklyPlan';
const SHEET_LOG     = 'StudyLog';
const SHEET_ARCHIVE = 'Archive';

/* --- Goals --- 0..9 זהים לגרסה 1; 10..11 חדשים ומתווספים בסוף */
const G_NAME = 0, G_UNIT = 1, G_TOTAL = 2, G_STARTU = 3, G_DONE = 4,
      G_POS = 5, G_COLOR = 6, G_STATUS = 7, G_CREATED = 8, G_ID = 9,
      G_CATEGORY = 10, G_BOOKKEY = 11;
const HEADERS_GOALS = ['שם היעד', 'יחידה', 'סה״כ יחידות', 'יחידת התחלה',
  'יחידות שהושלמו', 'מיקום נוכחי', 'צבע', 'סטטוס', 'נוצר בתאריך', 'מזהה',
  'קטגוריה', 'מפתח בקטלוג'];

/* --- WeeklyPlan --- 10 חדש */
const P_WEEK = 0, P_DATE = 1, P_DOW = 2, P_START = 3, P_DUR = 4,
      P_GOALID = 5, P_GOALNAME = 6, P_EVENTID = 7, P_STATUS = 8, P_ID = 9,
      P_SEDER = 10;
const HEADERS_PLAN = ['תחילת שבוע', 'תאריך', 'יום', 'שעת התחלה', 'משך (דק׳)',
  'מזהה יעד', 'שם היעד', 'מזהה אירוע יומן', 'סטטוס', 'מזהה', 'סדר'];

/* --- StudyLog --- 13 חדש */
const L_DATE = 0, L_START = 1, L_END = 2, L_ACTUAL = 3, L_PLANNED = 4,
      L_GOALID = 5, L_GOALNAME = 6, L_REACHED = 7, L_UNITS = 8,
      L_SUMMARY = 9, L_PLANID = 10, L_SESSIONID = 11, L_ID = 12, L_SEDER = 13;
const HEADERS_LOG = ['תאריך', 'שעת התחלה', 'שעת סיום', 'דקות בפועל',
  'דקות מתוכננות', 'מזהה יעד', 'שם היעד', 'היכן הגעתי', 'יחידות שהושלמו',
  'סיכום', 'מזהה תכנון', 'מזהה מפגש', 'מזהה', 'סדר'];

const HEADERS_ARCHIVE = HEADERS_PLAN.concat(['הועבר לארכיון']);

const DEFAULTS = {
  webAppUrl: '',
  eventPrefix: '',
  defaultDurationMin: 90,
  reminderMin: 10,
  createCalendarEvents: true
};

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const PALETTE = ['#E9B8BC', '#B98A63', '#D8B08C', '#C4868C', '#9A7050', '#D9917E'];
const SESSION_KEY = 'activeSession';


/* ==========================================================================
   2. הסדרים — המימד החדש של גרסה 2
   ========================================================================== */

const SEDERS = [
  { key: 'boker',      name: 'סדר בוקר',   icon: '☀️', defaultStart: '08:30', color: '#D8B08C' },
  { key: 'tzohorayim', name: 'סדר צהריים', icon: '🌤️', defaultStart: '14:30', color: '#B98A63' },
  { key: 'erev',       name: 'סדר ערב',    icon: '🌙', defaultStart: '20:30', color: '#E9B8BC' }
];

function getSeder(key) {
  for (let i = 0; i < SEDERS.length; i++) if (SEDERS[i].key === key) return SEDERS[i];
  return SEDERS[2];
}

/** נגזרת הסדר משעת ההתחלה — לזיהוי אוטומטי ולמילוי רטרואקטיבי במיגרציה. */
function sederFromTime(timeStr) {
  const h = parseInt(String(timeStr || '').split(':')[0], 10);
  if (isNaN(h)) return 'erev';
  if (h >= 4 && h < 12) return 'boker';
  if (h >= 12 && h < 17) return 'tzohorayim';
  return 'erev';
}


/* ==========================================================================
   3. קטלוג הספרים — מחליף את הטקסט החופשי
   --------------------------------------------------------------------------
   total: null פירושו "האפליקציה לא מגיעה עם מספר מאומת" — המשתמש ימלא פעם
   אחת בבחירה. עדיף שדה ריק על פני מספר שגוי שיעוות כל פס התקדמות.

   מספרי הדפים בבבלי הם מספר דפי הלימוד לפי דפוס וילנא — לא מספר הדף האחרון.
   תענית = 30 דפים (ב׳–ל״א). סכום הקטלוג: 2,711 דפים, כמקובל.
   ========================================================================== */

const CATALOG = [
  {
    key: 'bavli', name: 'תלמוד בבלי', icon: '📖', unit: 'דף', startUnit: 2,
    note: 'מספר דפי הלימוד לפי דפוס וילנא',
    books: [
      { key: 'berachot', name: 'ברכות', total: 63, group: 'זרעים' },

      { key: 'shabbat', name: 'שבת', total: 156, group: 'מועד' },
      { key: 'eruvin', name: 'עירובין', total: 104, group: 'מועד' },
      { key: 'pesachim', name: 'פסחים', total: 120, group: 'מועד' },
      { key: 'shekalim', name: 'שקלים', total: 21, group: 'מועד' },
      { key: 'yoma', name: 'יומא', total: 87, group: 'מועד' },
      { key: 'sukkah', name: 'סוכה', total: 55, group: 'מועד' },
      { key: 'beitzah', name: 'ביצה', total: 39, group: 'מועד' },
      { key: 'rosh_hashanah', name: 'ראש השנה', total: 34, group: 'מועד' },
      { key: 'taanit', name: 'תענית', total: 30, group: 'מועד' },
      { key: 'megillah', name: 'מגילה', total: 31, group: 'מועד' },
      { key: 'moed_katan', name: 'מועד קטן', total: 28, group: 'מועד' },
      { key: 'chagigah', name: 'חגיגה', total: 26, group: 'מועד' },

      { key: 'yevamot', name: 'יבמות', total: 121, group: 'נשים' },
      { key: 'ketubot', name: 'כתובות', total: 111, group: 'נשים' },
      { key: 'nedarim', name: 'נדרים', total: 90, group: 'נשים' },
      { key: 'nazir', name: 'נזיר', total: 65, group: 'נשים' },
      { key: 'sotah', name: 'סוטה', total: 48, group: 'נשים' },
      { key: 'gittin', name: 'גיטין', total: 89, group: 'נשים' },
      { key: 'kiddushin', name: 'קידושין', total: 81, group: 'נשים' },

      { key: 'bava_kamma', name: 'בבא קמא', total: 118, group: 'נזיקין' },
      { key: 'bava_metzia', name: 'בבא מציעא', total: 118, group: 'נזיקין' },
      { key: 'bava_batra', name: 'בבא בתרא', total: 175, group: 'נזיקין' },
      { key: 'sanhedrin', name: 'סנהדרין', total: 112, group: 'נזיקין' },
      { key: 'makkot', name: 'מכות', total: 23, group: 'נזיקין' },
      { key: 'shevuot', name: 'שבועות', total: 48, group: 'נזיקין' },
      { key: 'avodah_zarah', name: 'עבודה זרה', total: 75, group: 'נזיקין' },
      { key: 'horayot', name: 'הוריות', total: 13, group: 'נזיקין' },

      { key: 'zevachim', name: 'זבחים', total: 119, group: 'קדשים' },
      { key: 'menachot', name: 'מנחות', total: 109, group: 'קדשים' },
      { key: 'chullin', name: 'חולין', total: 141, group: 'קדשים' },
      { key: 'bechorot', name: 'בכורות', total: 60, group: 'קדשים' },
      { key: 'arachin', name: 'ערכין', total: 33, group: 'קדשים' },
      { key: 'temurah', name: 'תמורה', total: 33, group: 'קדשים' },
      { key: 'keritot', name: 'כריתות', total: 27, group: 'קדשים' },
      { key: 'meilah', name: 'מעילה', total: 21, group: 'קדשים' },
      { key: 'tamid', name: 'תמיד', total: 8, group: 'קדשים' },
      { key: 'middot', name: 'מידות', total: 4, group: 'קדשים' },
      { key: 'kinnim', name: 'קינים', total: 3, group: 'קדשים' },

      { key: 'niddah', name: 'נידה', total: 72, group: 'טהרות' }
    ]
  },
  {
    key: 'rambam', name: 'רמב״ם — משנה תורה', icon: '📜', unit: 'פרק', startUnit: 1,
    note: 'סה״כ 1,000 פרקים. חלוקת הפרקים לספר בודד — מלא בעצמך',
    books: [
      { key: 'mt_all', name: 'משנה תורה — כל החיבור', total: 1000, group: 'הכול' },
      { key: 'mada', name: 'ספר המדע', total: null, group: 'י״ד הספרים' },
      { key: 'ahava', name: 'ספר אהבה', total: null, group: 'י״ד הספרים' },
      { key: 'zmanim', name: 'ספר זמנים', total: null, group: 'י״ד הספרים' },
      { key: 'nashim', name: 'ספר נשים', total: null, group: 'י״ד הספרים' },
      { key: 'kedusha', name: 'ספר קדושה', total: null, group: 'י״ד הספרים' },
      { key: 'haflaah', name: 'ספר הפלאה', total: null, group: 'י״ד הספרים' },
      { key: 'zeraim', name: 'ספר זרעים', total: null, group: 'י״ד הספרים' },
      { key: 'avodah', name: 'ספר עבודה', total: null, group: 'י״ד הספרים' },
      { key: 'korbanot', name: 'ספר קרבנות', total: null, group: 'י״ד הספרים' },
      { key: 'taharah', name: 'ספר טהרה', total: null, group: 'י״ד הספרים' },
      { key: 'nezikin', name: 'ספר נזיקין', total: null, group: 'י״ד הספרים' },
      { key: 'kinyan', name: 'ספר קניין', total: null, group: 'י״ד הספרים' },
      { key: 'mishpatim', name: 'ספר משפטים', total: null, group: 'י״ד הספרים' },
      { key: 'shoftim', name: 'ספר שופטים', total: null, group: 'י״ד הספרים' }
    ]
  },
  {
    key: 'mishnayot', name: 'משנה', icon: '📕', unit: 'פרק', startUnit: 1,
    note: 'מלא את מספר הפרקים לפי המהדורה שלך',
    books: [
      { key: 'm_zeraim', name: 'סדר זרעים', total: null, group: 'ששה סדרים' },
      { key: 'm_moed', name: 'סדר מועד', total: null, group: 'ששה סדרים' },
      { key: 'm_nashim', name: 'סדר נשים', total: null, group: 'ששה סדרים' },
      { key: 'm_nezikin', name: 'סדר נזיקין', total: null, group: 'ששה סדרים' },
      { key: 'm_kodashim', name: 'סדר קדשים', total: null, group: 'ששה סדרים' },
      { key: 'm_taharot', name: 'סדר טהרות', total: null, group: 'ששה סדרים' },
      { key: 'm_avot', name: 'פרקי אבות', total: 6, group: 'נבחרות' }
    ]
  },
  {
    key: 'halacha', name: 'הלכה', icon: '⚖️', unit: 'סימן', startUnit: 1,
    note: 'מלא את מספר הסימנים לפי המהדורה שלך',
    books: [
      { key: 'sa_oc', name: 'שולחן ערוך — אורח חיים', total: null, group: 'שולחן ערוך' },
      { key: 'sa_yd', name: 'שולחן ערוך — יורה דעה', total: null, group: 'שולחן ערוך' },
      { key: 'sa_eh', name: 'שולחן ערוך — אבן העזר', total: null, group: 'שולחן ערוך' },
      { key: 'sa_cm', name: 'שולחן ערוך — חושן משפט', total: null, group: 'שולחן ערוך' },
      { key: 'mb', name: 'משנה ברורה', total: null, group: 'נושאי כלים' },
      { key: 'kitzur', name: 'קיצור שולחן ערוך', total: null, group: 'נושאי כלים' }
    ]
  },
  {
    key: 'machshava', name: 'מחשבה ומוסר', icon: '💭', unit: 'פרק', startUnit: 1,
    note: 'מלא את מספר הפרקים/שערים לפי המהדורה שלך',
    books: [
      { key: 'mesilat', name: 'מסילת ישרים', total: null, group: 'מוסר' },
      { key: 'chovot', name: 'חובות הלבבות', total: null, group: 'מוסר' },
      { key: 'shaarei_teshuva', name: 'שערי תשובה', total: null, group: 'מוסר' },
      { key: 'orchot', name: 'אורחות צדיקים', total: null, group: 'מוסר' },
      { key: 'nefesh_hachaim', name: 'נפש החיים', total: null, group: 'מחשבה' },
      { key: 'kuzari', name: 'הכוזרי', total: null, group: 'מחשבה' },
      { key: 'tanya', name: 'תניא', total: null, group: 'מחשבה' },
      { key: 'derech_hashem', name: 'דרך ה׳', total: null, group: 'מחשבה' }
    ]
  },
  {
    key: 'tanach', name: 'תנ״ך', icon: '📘', unit: 'פרק', startUnit: 1,
    note: 'מלא את מספר הפרקים',
    books: [
      { key: 'torah', name: 'חומש', total: null, group: 'תנ״ך' },
      { key: 'neviim', name: 'נביאים', total: null, group: 'תנ״ך' },
      { key: 'ketuvim', name: 'כתובים', total: null, group: 'תנ״ך' },
      { key: 'tehillim', name: 'תהילים', total: 150, group: 'תנ״ך' }
    ]
  },
  {
    key: 'custom', name: 'אחר / מותאם אישית', icon: '✏️', unit: 'יחידה', startUnit: 1,
    note: 'הגדר שם, יחידה וכמות בעצמך',
    books: []
  }
];

function getCategory(key) {
  for (let i = 0; i < CATALOG.length; i++) if (CATALOG[i].key === key) return CATALOG[i];
  return null;
}

function getCatalogBook(categoryKey, bookKey) {
  const cat = getCategory(categoryKey);
  if (!cat) return null;
  for (let i = 0; i < cat.books.length; i++) if (cat.books[i].key === bookKey) return cat.books[i];
  return null;
}

/**
 * הקטלוג שהאפליקציה משתמשת בו.
 * מעדיף את הלשונית Catalog שסונכרנה מ-Sefaria; אם היא חסרה, ריקה, או
 * שקריאה נכשלה — נופל לקטלוג המובנה, שמספריו אומתו ידנית. כלומר
 * האפליקציה עובדת גם בלי Sefaria וגם בלי רשת.
 */
function getCatalog() {
  try {
    if (typeof readCatalogSheet === 'function') {
      const fromSheet = readCatalogSheet();
      if (fromSheet && fromSheet.length) return fromSheet;
    }
  } catch (e) {
    // הלשונית פגומה או שהקובץ SefariaCatalog לא הותקן — ממשיכים למובנה
  }
  return CATALOG;
}


/* ==========================================================================
   4. גישה לגיליון + מיגרציה אוטומטית של כותרות
   ========================================================================== */

function getSS() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('הסקריפט אינו מקושר לגיליון. צור אותו דרך Extensions → Apps Script בתוך הגיליון, או מלא את SPREADSHEET_ID.');
  return ss;
}

/**
 * מחזיר לשונית; יוצר אותה אם חסרה, ומרחיב את שורת הכותרות אם הגיליון נוצר
 * בגרסה 1. ההרחבה היא בסוף בלבד — כל האינדקסים הישנים נשארים תקפים, ולכן
 * שורות ותיקות ממשיכות להיקרא נכון בלי לגעת בהן.
 */
function ensureSheet(name, headers) {
  const ss = getSS();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
         .setFontWeight('bold').setBackground('#241C18').setFontColor('#F5EAE5');
    sheet.setFrozenRows(1);
  } else {
    const width = sheet.getLastColumn();
    if (width < headers.length) {
      const extra = headers.slice(width);
      sheet.getRange(1, width + 1, 1, extra.length)
           .setValues([extra])
           .setFontWeight('bold').setBackground('#241C18').setFontColor('#F5EAE5');
    }
  }
  return sheet;
}

function goalsSheet()   { return ensureSheet(SHEET_GOALS, HEADERS_GOALS); }
function planSheet()    { return ensureSheet(SHEET_PLAN, HEADERS_PLAN); }
function logSheet()     { return ensureSheet(SHEET_LOG, HEADERS_LOG); }
function archiveSheet() { return ensureSheet(SHEET_ARCHIVE, HEADERS_ARCHIVE); }

function setupSpreadsheet() {
  goalsSheet(); planSheet(); logSheet(); archiveSheet();
  let calMsg;
  try { calMsg = 'יומן ברירת מחדל: ' + CalendarApp.getDefaultCalendar().getName(); }
  catch (e) { calMsg = 'אזהרה: אין גישה ליומן — ' + e.message; }
  const msg = 'ההתקנה הושלמה (גרסה ' + APP_VERSION + ').\n' +
              'לשוניות: Goals, WeeklyPlan, StudyLog, Archive\n' + calMsg;
  Logger.log(msg);
  return msg;
}

/**
 * מיגרציה מגרסה 1 → 2. בטוחה להרצה חוזרת: משלימה רק תאים ריקים
 * ואינה נוגעת בנתונים קיימים.
 */
function migrateToV2() {
  const report = [];
  goalsSheet(); planSheet(); logSheet(); archiveSheet();
  report.push('כותרות עודכנו בכל הלשוניות.');

  // WeeklyPlan — השלמת סדר לפי שעת ההתחלה
  const ps = planSheet();
  const pData = ps.getDataRange().getValues();
  let pFixed = 0;
  for (let i = 1; i < pData.length; i++) {
    if (!pData[i][P_ID] || pData[i][P_SEDER]) continue;
    ps.getRange(i + 1, P_SEDER + 1).setValue(sederFromTime(cellToTimeStr(pData[i][P_START])));
    pFixed++;
  }
  report.push('WeeklyPlan: הושלם סדר ל-' + pFixed + ' שורות.');

  // StudyLog — השלמת סדר לפי שעת ההתחלה
  const ls = logSheet();
  const lData = ls.getDataRange().getValues();
  let lFixed = 0;
  for (let i = 1; i < lData.length; i++) {
    if (!lData[i][L_ID] || lData[i][L_SEDER]) continue;
    ls.getRange(i + 1, L_SEDER + 1).setValue(sederFromTime(cellToTimeStr(lData[i][L_START])));
    lFixed++;
  }
  report.push('StudyLog: הושלם סדר ל-' + lFixed + ' שורות.');

  // Goals — סימון יעדים ותיקים כ"מותאם אישית"
  const gs = goalsSheet();
  const gData = gs.getDataRange().getValues();
  let gFixed = 0;
  for (let i = 1; i < gData.length; i++) {
    if (!gData[i][G_ID] || gData[i][G_CATEGORY]) continue;
    gs.getRange(i + 1, G_CATEGORY + 1).setValue('custom');
    gFixed++;
  }
  report.push('Goals: סומנו ' + gFixed + ' יעדים קיימים כ"מותאם אישית".');
  report.push('אפשר לערוך כל יעד ולקשר אותו לקטלוג.');

  const msg = report.join('\n');
  Logger.log(msg);
  return msg;
}

function debugSheets() {
  const ss = getSS();
  Logger.log('גיליון: ' + ss.getName());
  Logger.log('לשוניות: ' + ss.getSheets().map(function (s) { return '"' + s.getName() + '"'; }).join(', '));
  Logger.log('יעדים: ' + readGoals().length);
  Logger.log('בלוקים: ' + readPlanRows().length);
  Logger.log('רשומות: ' + readLog().length);
  Logger.log('מפגש פעיל: ' + JSON.stringify(readSession()));
  Logger.log('כתובת אפליקציה: ' + getWebAppUrl());
}


/* ==========================================================================
   5. עזרים
   ========================================================================== */

function generateId() { return Utilities.getUuid(); }
function round2(n) { return Math.round(n * 100) / 100; }

function toNum(v, fallback) {
  const n = parseFloat(v);
  return isNaN(n) ? (fallback || 0) : n;
}

function cellToDateStr(cell) {
  if (cell instanceof Date) return Utilities.formatDate(cell, TZ, 'yyyy-MM-dd');
  return String(cell || '').trim();
}

function cellToTimeStr(cell) {
  if (cell instanceof Date) return Utilities.formatDate(cell, TZ, 'HH:mm');
  const s = String(cell || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : s;
}

function todayStr() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowTimeStr() { return Utilities.formatDate(new Date(), TZ, 'HH:mm'); }
function fmtDate(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function fmtTime(d) { return Utilities.formatDate(d, TZ, 'HH:mm'); }

function parseDateStr(dateStr) {
  return Utilities.parseDate(dateStr + ' 12:00', TZ, 'yyyy-MM-dd HH:mm');
}

function parseDateTime(dateStr, timeStr) {
  return Utilities.parseDate(dateStr + ' ' + timeStr, TZ, 'yyyy-MM-dd HH:mm');
}

function addDaysStr(dateStr, days) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}

function weekStartOf(dateStr) {
  const d = parseDateStr(dateStr);
  return addDaysStr(dateStr, -d.getDay());
}

function currentWeekStart() { return weekStartOf(todayStr()); }
function dowOf(dateStr) { return parseDateStr(dateStr).getDay(); }

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function findRowById(sheet, idCol, id) {
  if (!id) return -1;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) return i + 1;
  }
  return -1;
}


/* ==========================================================================
   6. שכבת גישה לנתונים (DAO)
   ========================================================================== */

/* ---------- Goals ---------- */

function readGoals() {
  const sheet = goalsSheet();
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[G_NAME] && !r[G_ID]) continue;
    const total = toNum(r[G_TOTAL], 0);
    const done = toNum(r[G_DONE], 0);
    const categoryKey = String(r[G_CATEGORY] || 'custom');
    const cat = getCategory(categoryKey);
    out.push({
      name: String(r[G_NAME] || ''),
      unit: String(r[G_UNIT] || 'יחידה'),
      total: total,
      startUnit: toNum(r[G_STARTU], 1),
      done: done,
      position: String(r[G_POS] || ''),
      color: String(r[G_COLOR] || PALETTE[0]),
      status: String(r[G_STATUS] || 'active'),
      created: cellToDateStr(r[G_CREATED]),
      id: String(r[G_ID] || ''),
      category: categoryKey,
      categoryName: cat ? cat.name : 'מותאם אישית',
      categoryIcon: cat ? cat.icon : '✏️',
      bookKey: String(r[G_BOOKKEY] || ''),
      // total = 0 → ספר בלי יעד. נספרות יחידות מצטברות, אין פס התקדמות.
      hasTarget: total > 0,
      percent: total > 0 ? Math.min(100, round2((done / total) * 100)) : null
    });
  }
  return out;
}

function getGoalById(id) {
  const all = readGoals();
  for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

/**
 * יוצר/מעדכן ספר. אם נבחר ספר מהקטלוג, ברירות המחדל נלקחות ממנו —
 * אבל כל ערך שהמשתמש שלח במפורש גובר עליהן.
 *
 * שים לב: total אינו חובה. ספר בלי יעד נשמר עם total = 0 ופשוט צובר
 * יחידות. זה מה שמאפשר להתחיל ללמוד ספר בלי לדעת כמה פרקים יש בו.
 */
function saveGoal(data) {
  const categoryKey = String(data.category || 'custom');
  const bookKey = String(data.bookKey || '');
  const cat = getCategory(categoryKey);
  const book = getCatalogBook(categoryKey, bookKey);

  let name = String(data.name || '').trim();
  if (!name && book) name = book.name;
  if (!name) throw new Error('חובה לבחור ספר או למלא שם.');

  const unit = String(data.unit || (cat ? cat.unit : '') || 'יחידה').trim();

  // יעד אופציונלי. אם המשתמש שלח ערך במפורש — הוא קובע (ונחתך ל-0 כלפי מטה).
  // רק אם לא שלח כלום, נופלים לברירת המחדל מהקטלוג. 0 = ספר בלי יעד.
  const totalProvided = (data.total !== undefined && data.total !== null && data.total !== '');
  let total;
  if (totalProvided) {
    total = Math.max(0, toNum(data.total, 0));
  } else {
    total = (book && book.total) ? book.total : 0;
  }

  const startUnit = (data.startUnit !== undefined && data.startUnit !== '')
    ? toNum(data.startUnit, 1)
    : (cat ? (cat.startUnit || 1) : 1);

  const sheet = goalsSheet();
  const row = [
    name, unit, total, startUnit,
    Math.max(0, toNum(data.done, 0)),
    String(data.position || '').trim(),
    String(data.color || PALETTE[0]),
    String(data.status || 'active'),
    todayStr(), '',
    categoryKey, bookKey
  ];

  if (data.id) {
    const rowNum = findRowById(sheet, G_ID, data.id);
    if (rowNum === -1) throw new Error('היעד לא נמצא (ייתכן שנמחק).');
    const existing = sheet.getRange(rowNum, 1, 1, HEADERS_GOALS.length).getValues()[0];
    row[G_CREATED] = existing[G_CREATED] || todayStr();
    row[G_ID] = data.id;
    // אל תדרוס התקדמות שנצברה במפגשים אם הלקוח לא שלח אותה
    if (data.done === undefined || data.done === null || data.done === '') row[G_DONE] = toNum(existing[G_DONE], 0);
    if (data.position === undefined || data.position === null) row[G_POS] = existing[G_POS];
    sheet.getRange(rowNum, 1, 1, HEADERS_GOALS.length).setValues([row]);
    return { status: 'updated', id: data.id };
  }

  const id = generateId();
  row[G_ID] = id;
  sheet.appendRow(row);
  return { status: 'created', id: id };
}

function deleteGoal(id) {
  const sheet = goalsSheet();
  const rowNum = findRowById(sheet, G_ID, id);
  if (rowNum === -1) throw new Error('היעד לא נמצא.');
  sheet.deleteRow(rowNum);
  return { status: 'deleted' };
}

/**
 * מציב או מסיר יעד לספר קיים — הפעולה של מוצ״ש.
 * total = 0 מסיר את היעד והספר חוזר לספירה מצטברת בלבד.
 */
function setGoalTarget(goalId, total) {
  const sheet = goalsSheet();
  const rowNum = findRowById(sheet, G_ID, goalId);
  if (rowNum === -1) throw new Error('הספר לא נמצא.');
  const t = Math.max(0, toNum(total, 0));
  const done = toNum(sheet.getRange(rowNum, G_DONE + 1).getValue(), 0);
  if (t > 0 && t < done) {
    throw new Error('היעד (' + t + ') קטן ממה שכבר נלמד (' + done + ').');
  }
  sheet.getRange(rowNum, G_TOTAL + 1).setValue(t);
  return { status: 'saved', total: t };
}

function advanceGoal(goalId, unitsDone, positionText) {
  if (!goalId) return;
  const sheet = goalsSheet();
  const rowNum = findRowById(sheet, G_ID, goalId);
  if (rowNum === -1) return;
  const units = toNum(unitsDone, 0);
  if (units > 0) {
    const cur = toNum(sheet.getRange(rowNum, G_DONE + 1).getValue(), 0);
    sheet.getRange(rowNum, G_DONE + 1).setValue(round2(cur + units));
  }
  if (positionText) sheet.getRange(rowNum, G_POS + 1).setValue(positionText);
}

/* ---------- WeeklyPlan ---------- */

function readPlanRows() {
  const sheet = planSheet();
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[P_ID]) continue;
    const startTime = cellToTimeStr(r[P_START]);
    const sd = getSeder(String(r[P_SEDER] || '') || sederFromTime(startTime));
    out.push({
      weekStart: cellToDateStr(r[P_WEEK]),
      date: cellToDateStr(r[P_DATE]),
      dow: toNum(r[P_DOW], 0),
      startTime: startTime,
      durationMin: toNum(r[P_DUR], 0),
      goalId: String(r[P_GOALID] || ''),
      goalName: String(r[P_GOALNAME] || ''),
      eventId: String(r[P_EVENTID] || ''),
      status: String(r[P_STATUS] || 'planned'),
      id: String(r[P_ID] || ''),
      seder: sd.key,
      sederName: sd.name,
      sederIcon: sd.icon
    });
  }
  return out;
}

function readWeekPlan(weekStart) {
  return readPlanRows()
    .filter(function (p) { return p.weekStart === weekStart; })
    .sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.startTime < b.startTime ? -1 : 1;
    });
}

function planRowValues(block) {
  return [
    block.weekStart, block.date, block.dow, block.startTime, block.durationMin,
    block.goalId, block.goalName, block.eventId || '', block.status || 'planned',
    block.id, block.seder || 'erev'
  ];
}

function appendPlanBlock(block) {
  planSheet().appendRow(planRowValues(block));
  return block.id;
}

function updatePlanEventId(id, eventId) {
  const sheet = planSheet();
  const rowNum = findRowById(sheet, P_ID, id);
  if (rowNum !== -1) sheet.getRange(rowNum, P_EVENTID + 1).setValue(eventId || '');
}

function updatePlanStatus(id, status) {
  const sheet = planSheet();
  const rowNum = findRowById(sheet, P_ID, id);
  if (rowNum !== -1) sheet.getRange(rowNum, P_STATUS + 1).setValue(status);
}

function archivePlanBlock(block) {
  archiveSheet().appendRow(planRowValues(block).concat([todayStr() + ' ' + nowTimeStr()]));
  const sheet = planSheet();
  const rowNum = findRowById(sheet, P_ID, block.id);
  if (rowNum !== -1) sheet.deleteRow(rowNum);
}

/* ---------- StudyLog ---------- */

function readLog() {
  const sheet = logSheet();
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[L_ID]) continue;
    const startTime = cellToTimeStr(r[L_START]);
    const sederKey = String(r[L_SEDER] || '') || sederFromTime(startTime);
    out.push({
      date: cellToDateStr(r[L_DATE]),
      startTime: startTime,
      endTime: cellToTimeStr(r[L_END]),
      actualMin: toNum(r[L_ACTUAL], 0),
      plannedMin: toNum(r[L_PLANNED], 0),
      goalId: String(r[L_GOALID] || ''),
      goalName: String(r[L_GOALNAME] || ''),
      reached: String(r[L_REACHED] || ''),
      units: toNum(r[L_UNITS], 0),
      summary: String(r[L_SUMMARY] || ''),
      planId: String(r[L_PLANID] || ''),
      sessionId: String(r[L_SESSIONID] || ''),
      id: String(r[L_ID] || ''),
      seder: sederKey,
      sederIcon: getSeder(sederKey).icon
    });
  }
  return out;
}

function appendLogEntry(e) {
  const id = generateId();
  // כל העמודות תמיד — פער אחד מזיז כל שדה שאחריו
  logSheet().appendRow([
    e.date, e.startTime, e.endTime, e.actualMin, e.plannedMin,
    e.goalId, e.goalName, e.reached, e.units, e.summary,
    e.planId || '--', e.sessionId, id, e.seder || 'erev'
  ]);
  return id;
}

function deleteLogEntry(id) {
  const sheet = logSheet();
  const rowNum = findRowById(sheet, L_ID, id);
  if (rowNum === -1) throw new Error('הרשומה לא נמצאה.');
  sheet.deleteRow(rowNum);
  return { status: 'deleted' };
}


/* ==========================================================================
   7. הגדרות
   ========================================================================== */

function getSettings() {
  const raw = PropertiesService.getUserProperties().getProperty('settings');
  let saved = {};
  if (raw) { try { saved = JSON.parse(raw); } catch (e) { saved = {}; } }
  return {
    webAppUrl: saved.webAppUrl || DEFAULTS.webAppUrl,
    eventPrefix: saved.eventPrefix || DEFAULTS.eventPrefix,
    defaultDurationMin: (toNum(saved.defaultDurationMin, 0) > 0) ? toNum(saved.defaultDurationMin) : DEFAULTS.defaultDurationMin,
    reminderMin: (toNum(saved.reminderMin, -1) >= 0) ? toNum(saved.reminderMin, DEFAULTS.reminderMin) : DEFAULTS.reminderMin,
    createCalendarEvents: saved.createCalendarEvents !== false
  };
}

function saveSettings(data) {
  const existing = getSettings();
  const clean = {
    webAppUrl: String(data.webAppUrl !== undefined ? data.webAppUrl : (existing.webAppUrl || '')).trim(),
    eventPrefix: String(data.eventPrefix !== undefined ? data.eventPrefix : existing.eventPrefix).trim(),
    defaultDurationMin: (toNum(data.defaultDurationMin, 0) > 0) ? toNum(data.defaultDurationMin) : existing.defaultDurationMin,
    reminderMin: Math.max(0, toNum(data.reminderMin, existing.reminderMin)),
    createCalendarEvents: (data.createCalendarEvents !== undefined)
      ? (data.createCalendarEvents !== false) : existing.createCalendarEvents
  };
  if (clean.webAppUrl && !/^https:\/\//.test(clean.webAppUrl)) {
    throw new Error('כתובת האפליקציה חייבת להתחיל ב-https://');
  }
  PropertiesService.getUserProperties().setProperty('settings', JSON.stringify(clean));
  return { status: 'saved', settings: getSettings() };
}

function getWebAppUrl() {
  const s = getSettings();
  if (s.webAppUrl) return s.webAppUrl;
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

function getSheetUrl() {
  try { return getSS().getUrl(); } catch (e) { return ''; }
}


/* ==========================================================================
   8. מצב מפגש חי (ScriptProperties)
   --------------------------------------------------------------------------
   localStorage חסום ב-iframe של Apps Script, וממילא לא היה מסנכרן בין
   הטלפון למחשב. המצב יושב בשרת: הטלפון עוצר → המחשב ממשיך.
   ========================================================================== */

function readSession() {
  const raw = PropertiesService.getScriptProperties().getProperty(SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function writeSession(s) {
  PropertiesService.getScriptProperties().setProperty(SESSION_KEY, JSON.stringify(s));
  return s;
}

function clearSessionState() {
  PropertiesService.getScriptProperties().deleteProperty(SESSION_KEY);
}

function commitSegment(s) {
  if (s.running && s.segmentStart && s.currentGoalId) {
    const ms = new Date().getTime() - new Date(s.segmentStart).getTime();
    if (ms > 0) s.totals[s.currentGoalId] = (s.totals[s.currentGoalId] || 0) + ms;
  }
  s.segmentStart = null;
  return s;
}

function sessionView(s) {
  if (!s) return null;
  const totals = {};
  Object.keys(s.totals || {}).forEach(function (k) { totals[k] = s.totals[k]; });
  if (s.running && s.segmentStart && s.currentGoalId) {
    const ms = new Date().getTime() - new Date(s.segmentStart).getTime();
    totals[s.currentGoalId] = (totals[s.currentGoalId] || 0) + Math.max(0, ms);
  }
  let totalMs = 0;
  Object.keys(totals).forEach(function (k) { totalMs += totals[k]; });

  const byId = {};
  readGoals().forEach(function (g) { byId[g.id] = g; });

  const breakdown = Object.keys(totals).map(function (gid) {
    const g = byId[gid] || {};
    return {
      goalId: gid,
      goalName: g.name || '(יעד שנמחק)',
      unit: g.unit || 'יחידה',
      color: g.color || PALETTE[0],
      ms: totals[gid],
      position: g.position || ''
    };
  }).sort(function (a, b) { return b.ms - a.ms; });

  const sd = getSeder(s.seder);

  return {
    sessionId: s.sessionId,
    start: s.start,
    startTimeStr: fmtTime(new Date(s.start)),
    planId: s.planId || '',
    plannedMin: toNum(s.plannedMin, 0),
    running: !!s.running,
    phase: s.phase || 'active',
    currentGoalId: s.currentGoalId || '',
    seder: sd.key,
    sederName: sd.name,
    sederIcon: sd.icon,
    totals: totals,
    totalMs: totalMs,
    breakdown: breakdown,
    endedAt: s.endedAt || null,
    draft: s.draft || {},
    serverNow: new Date().toISOString()
  };
}

function getActiveSession() { return sessionView(readSession()); }

function startSession(opts) {
  opts = opts || {};
  if (readSession()) throw new Error('כבר קיים מפגש פעיל. סיים אותו לפני שתתחיל חדש.');
  const goalId = String(opts.goalId || '');
  if (!goalId) throw new Error('בחר יעד לימוד להתחלה.');
  if (!getGoalById(goalId)) throw new Error('היעד שנבחר לא נמצא.');

  const back = Math.max(0, Math.min(600, toNum(opts.startedAgoMin, 0)));
  const start = new Date(new Date().getTime() - back * 60000);

  // סדר: מה שנשלח, אחרת נגזר משעת ההתחלה בפועל
  const seder = opts.seder ? getSeder(opts.seder).key : sederFromTime(fmtTime(start));

  const s = {
    sessionId: generateId(),
    start: start.toISOString(),
    planId: String(opts.planId || ''),
    plannedMin: toNum(opts.plannedMin, 0),
    seder: seder,
    running: true,
    currentGoalId: goalId,
    segmentStart: start.toISOString(),
    totals: {},
    phase: 'active',
    endedAt: null,
    draft: {}
  };
  writeSession(s);
  return sessionView(s);
}

function pauseSession() {
  const s = readSession();
  if (!s) throw new Error('אין מפגש פעיל.');
  if (!s.running) return sessionView(s);
  commitSegment(s);
  s.running = false;
  writeSession(s);
  return sessionView(s);
}

function resumeSession() {
  const s = readSession();
  if (!s) throw new Error('אין מפגש פעיל.');
  if (s.phase === 'wrapup') throw new Error('המפגש כבר הסתיים. השלם את הסיכום.');
  if (s.running) return sessionView(s);
  s.segmentStart = new Date().toISOString();
  s.running = true;
  writeSession(s);
  return sessionView(s);
}

function switchGoal(goalId) {
  const s = readSession();
  if (!s) throw new Error('אין מפגש פעיל.');
  if (!goalId) throw new Error('בחר יעד.');
  if (!getGoalById(goalId)) throw new Error('היעד שנבחר לא נמצא.');
  if (s.currentGoalId === goalId) return sessionView(s);

  const wasRunning = s.running;
  commitSegment(s);
  s.currentGoalId = goalId;
  if (wasRunning) { s.segmentStart = new Date().toISOString(); s.running = true; }
  else { s.running = false; }
  writeSession(s);
  return sessionView(s);
}

/** שינוי הסדר של מפגש פעיל (למשל התחיל בצהריים וגלש לערב). */
function setSessionSeder(sederKey) {
  const s = readSession();
  if (!s) throw new Error('אין מפגש פעיל.');
  s.seder = getSeder(sederKey).key;
  writeSession(s);
  return sessionView(s);
}

function stopSession() {
  const s = readSession();
  if (!s) throw new Error('אין מפגש פעיל.');
  commitSegment(s);
  s.running = false;
  s.phase = 'wrapup';
  s.endedAt = s.endedAt || new Date().toISOString();
  writeSession(s);
  return sessionView(s);
}

function saveDraft(draft) {
  const s = readSession();
  if (!s) throw new Error('אין מפגש פעיל.');
  s.draft = draft || {};
  writeSession(s);
  return { status: 'saved', at: fmtTime(new Date()) };
}

/** סיום: שורה ב-StudyLog לכל יעד שנלמד, קידום היעדים, סימון הבלוק, ניקוי. */
function finishSession(entries) {
  const s = readSession();
  if (!s) throw new Error('אין מפגש פעיל.');
  const view = sessionView(s);
  if (view.totalMs < 1000) {
    clearSessionState();
    return { status: 'discarded', message: 'המפגש היה קצר מדי ולא נשמר.' };
  }

  const byGoal = {};
  (entries || []).forEach(function (e) { byGoal[String(e.goalId)] = e; });

  const dateStr = fmtDate(new Date(s.start));
  const startStr = fmtTime(new Date(s.start));
  const endStr = fmtTime(s.endedAt ? new Date(s.endedAt) : new Date());
  const written = [];
  let first = true;

  view.breakdown.forEach(function (b) {
    const e = byGoal[b.goalId] || {};
    const minutes = Math.round(b.ms / 60000);
    if (minutes < 1 && !e.reached && !e.summary) return;
    const id = appendLogEntry({
      date: dateStr,
      startTime: startStr,
      endTime: endStr,
      actualMin: minutes,
      plannedMin: first ? toNum(s.plannedMin, 0) : 0,  // לא לספור פעמיים
      goalId: b.goalId,
      goalName: b.goalName,
      reached: String(e.reached || ''),
      units: Math.max(0, toNum(e.units, 0)),
      summary: String(e.summary || ''),
      planId: s.planId,
      sessionId: s.sessionId,
      seder: s.seder
    });
    advanceGoal(b.goalId, e.units, e.reached);
    written.push(id);
    first = false;
  });

  if (s.planId) {
    try { updatePlanStatus(s.planId, 'done'); } catch (err) { /* לא קריטי */ }
  }

  clearSessionState();
  return { status: 'saved', rows: written.length, totalMin: Math.round(view.totalMs / 60000) };
}

function cancelSession() {
  if (!readSession()) throw new Error('אין מפגש פעיל.');
  clearSessionState();
  return { status: 'cancelled' };
}


/* ==========================================================================
   9. יומן Google — כותרת האירוע כוללת את הסדר
   ========================================================================== */

function buildEventTitle(block) {
  const sd = getSeder(block.seder);
  return sd.icon + ' ' + sd.name + ': ' + block.goalName;
}

function buildEventDescription(block, goal) {
  const url = getWebAppUrl();
  const sd = getSeder(block.seder);
  const lines = [];
  lines.push(sd.icon + ' ' + sd.name);
  lines.push('יעד: ' + block.goalName);
  if (goal && goal.categoryName) lines.push('מקור: ' + goal.categoryName);
  if (goal && goal.position) lines.push('מיקום אחרון: ' + goal.position);
  if (goal && goal.total > 0) {
    lines.push('התקדמות: ' + goal.done + ' מתוך ' + goal.total + ' ' + goal.unit + ' (' + goal.percent + '%)');
  }
  lines.push('');
  lines.push(url ? ('▶ פתח את האפליקציה: ' + url)
                 : '⚠ כתובת האפליקציה לא הוגדרה — פתח את ההגדרות באפליקציה.');
  lines.push('');
  lines.push('נוצר אוטומטית ע״י ' + APP_TITLE + ' v' + APP_VERSION);
  return lines.join('\n');
}

function createCalendarEvent(block) {
  const settings = getSettings();
  const cal = CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error('לא נמצא יומן ברירת מחדל.');

  const start = parseDateTime(block.date, block.startTime);
  if (!start || isNaN(start.getTime())) throw new Error('תאריך או שעה לא תקינים בבלוק.');
  const end = new Date(start.getTime() + toNum(block.durationMin, 60) * 60000);
  const goal = getGoalById(block.goalId);

  const event = cal.createEvent(buildEventTitle(block), start, end, {
    description: buildEventDescription(block, goal)
  });
  if (settings.reminderMin > 0) {
    try { event.addPopupReminder(settings.reminderMin); } catch (e) { /* לא קריטי */ }
  }
  return event.getId();
}

function deleteCalendarEvent(eventId) {
  if (!eventId) return;
  try {
    const ev = CalendarApp.getDefaultCalendar().getEventById(eventId);
    if (ev) ev.deleteEvent();
  } catch (e) { /* כבר נמחק ידנית */ }
}

function syncWeekToCalendar(weekStart) {
  const settings = getSettings();
  if (!settings.createCalendarEvents) {
    return { created: 0, failed: 0, skipped: 0, errors: [], message: 'יצירת אירועי יומן מכובה בהגדרות.' };
  }
  const blocks = readWeekPlan(weekStart);
  let created = 0, failed = 0, skipped = 0;
  const errors = [];

  blocks.forEach(function (b) {
    if (b.eventId) { skipped++; return; }
    try {
      updatePlanEventId(b.id, createCalendarEvent(b));
      created++;
    } catch (e) {
      failed++;
      errors.push(b.date + ' ' + b.startTime + ': ' + e.message);
    }
  });

  return {
    created: created, failed: failed, skipped: skipped, errors: errors,
    message: failed > 0 ? ('נוצרו ' + created + ' אירועים, ' + failed + ' נכשלו.')
                        : ('נוצרו ' + created + ' אירועי יומן.')
  };
}

/** שומר שבוע שלם: מארכב את הקיים (ומוחק אירועים), כותב חדש, מסנכרן ליומן. */
function saveWeekPlan(weekStart, blocks) {
  if (!weekStart) throw new Error('חסר תאריך תחילת שבוע.');
  blocks = blocks || [];

  const goalById = {};
  readGoals().forEach(function (g) { goalById[g.id] = g; });

  // אימות מלא לפני שמוחקים משהו
  const prepared = blocks.map(function (b) {
    const goal = goalById[String(b.goalId)];
    if (!goal) throw new Error('אחד הבלוקים מפנה ליעד שאינו קיים.');
    const date = String(b.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('תאריך לא תקין: ' + date);
    const startTime = String(b.startTime || '').trim();
    if (!/^\d{1,2}:\d{2}$/.test(startTime)) throw new Error('שעה לא תקינה: ' + startTime);
    const dur = toNum(b.durationMin, 0);
    if (dur < 5 || dur > 720) throw new Error('משך הבלוק חייב להיות בין 5 ל-720 דקות.');
    const parts = startTime.split(':');
    const normTime = ('0' + parts[0]).slice(-2) + ':' + parts[1];
    return {
      weekStart: weekStart,
      date: date,
      dow: dowOf(date),
      startTime: normTime,
      durationMin: dur,
      goalId: goal.id,
      goalName: goal.name,
      eventId: '',
      status: 'planned',
      id: generateId(),
      seder: b.seder ? getSeder(b.seder).key : sederFromTime(normTime)
    };
  });

  readWeekPlan(weekStart).forEach(function (b) {
    deleteCalendarEvent(b.eventId);
    archivePlanBlock(b);
  });

  prepared.forEach(appendPlanBlock);

  let calendar;
  try {
    calendar = syncWeekToCalendar(weekStart);
  } catch (e) {
    calendar = { created: 0, failed: prepared.length, skipped: 0,
                 message: 'שגיאת יומן: ' + e.message, errors: [e.message] };
  }

  return { status: 'saved', blocks: prepared.length, calendar: calendar, plan: readWeekPlan(weekStart) };
}

function deletePlanBlock(id) {
  let target = null;
  readPlanRows().forEach(function (b) { if (b.id === id) target = b; });
  if (!target) throw new Error('הבלוק לא נמצא.');
  deleteCalendarEvent(target.eventId);
  archivePlanBlock(target);
  return { status: 'deleted' };
}


/* ==========================================================================
   10. אנליטיקה
   ========================================================================== */

function minutesInRange(log, fromStr, toStr) {
  let total = 0;
  log.forEach(function (e) { if (e.date >= fromStr && e.date <= toStr) total += e.actualMin; });
  return total;
}

function computeStreak(log) {
  const days = {};
  log.forEach(function (e) { if (e.date) days[e.date] = true; });
  let streak = 0;
  let cursor = todayStr();
  if (!days[cursor]) cursor = addDaysStr(cursor, -1);
  while (days[cursor]) { streak++; cursor = addDaysStr(cursor, -1); }
  return streak;
}

/* ---------- טקס מוצ״ש: מתי, ועל איזה שבוע ---------- */

/**
 * חלון התכנון השבועי. 21:00 במוצ״ש הוא גבול שמרני: צאת הכוכבים המאוחרת
 * ביותר בישראל היא סביב 20:30 בשיא הקיץ, כך שהבאנר לעולם לא יופיע בשבת.
 * זה לא חישוב זמנים אמיתי — ראה הערה ב-isShabbatWindow.
 */
function isPlanningWindow() {
  const dow = dowOf(todayStr());
  const hour = parseInt(nowTimeStr().split(':')[0], 10);
  if (dow === 6) return hour >= 21;   // מוצ״ש
  if (dow === 0) return true;         // יום ראשון — עדיין בזמן לתכנן
  return false;
}

/**
 * חלון שמרני של שבת, לחסימת מיילים אוטומטיים. מכסה מצהרי שישי עד
 * 21:00 במוצ״ש — רחב בכוונה, כי עדיף להשהות תזכורת מאשר לשלוח אותה בשבת.
 */
function isShabbatWindow() {
  const dow = dowOf(todayStr());
  const hour = parseInt(nowTimeStr().split(':')[0], 10);
  if (dow === 5 && hour >= 12) return true;
  if (dow === 6 && hour < 21) return true;
  return false;
}

/** איזה שבוע מסכמים ואיזה מתכננים, תלוי אם זה מוצ״ש או יום ראשון. */
function planningWeeks() {
  const cw = currentWeekStart();
  if (dowOf(todayStr()) === 0) {
    return { review: addDaysStr(cw, -7), target: cw };
  }
  return { review: cw, target: addDaysStr(cw, 7) };
}

/**
 * סיכום השבוע שהסתיים — הצד המסתכל־אחורה של מוצ״ש.
 * כאן גם מתגלים הספרים שראויים ליעד: כאלה שנלמדו בפועל ואין להם יעד.
 */
function getWeekReview() {
  const weeks = planningWeeks();
  const from = weeks.review;
  const to = addDaysStr(from, 6);
  const prevFrom = addDaysStr(from, -7);
  const prevTo = addDaysStr(from, -1);

  const log = readLog();
  const goals = readGoals();
  const goalById = {};
  goals.forEach(function (g) { goalById[g.id] = g; });

  const totalMin = minutesInRange(log, from, to);
  const prevMin = minutesInRange(log, prevFrom, prevTo);

  const bySeder = {};
  SEDERS.forEach(function (s) { bySeder[s.key] = 0; });
  const byBook = {};
  const days = {};

  log.forEach(function (e) {
    if (e.date < from || e.date > to) return;
    bySeder[e.seder] = (bySeder[e.seder] || 0) + e.actualMin;
    days[e.date] = true;
    if (!byBook[e.goalId]) {
      const g = goalById[e.goalId] || {};
      byBook[e.goalId] = {
        goalId: e.goalId,
        name: e.goalName,
        unit: g.unit || 'יחידה',
        color: g.color || PALETTE[0],
        icon: g.categoryIcon || '📖',
        minutes: 0, units: 0, sessions: 0,
        hasTarget: !!g.hasTarget,
        total: g.total || 0,
        done: g.done || 0,
        percent: g.percent,
        lastPosition: g.position || ''
      };
    }
    byBook[e.goalId].minutes += e.actualMin;
    byBook[e.goalId].units += e.units;
    byBook[e.goalId].sessions += 1;
  });

  const books = Object.keys(byBook).map(function (k) { return byBook[k]; })
    .sort(function (a, b) { return b.minutes - a.minutes; });

  const plannedMin = readWeekPlan(from)
    .reduce(function (s, b) { return s + b.durationMin; }, 0);

  return {
    reviewWeekStart: from,
    reviewWeekEnd: to,
    targetWeekStart: weeks.target,
    totalMin: totalMin,
    prevMin: prevMin,
    diffMin: totalMin - prevMin,
    plannedMin: plannedMin,
    adherence: plannedMin > 0 ? round2((totalMin / plannedMin) * 100) : null,
    daysLearned: Object.keys(days).length,
    bySeder: bySeder,
    books: books,
    // מועמדים ליעד: נלמדו בפועל השבוע ועדיין בלי יעד
    needTarget: books.filter(function (b) { return !b.hasTarget; }),
    targetWeekPlanned: readWeekPlan(weeks.target).length
  };
}

function getStats() {
  const log = readLog();
  const goals = readGoals();

  const thisWeekStart = currentWeekStart();
  const thisWeekEnd = addDaysStr(thisWeekStart, 6);
  const lastWeekStart = addDaysStr(thisWeekStart, -7);
  const lastWeekEnd = addDaysStr(thisWeekStart, -1);

  const thisWeekMin = minutesInRange(log, thisWeekStart, thisWeekEnd);
  const lastWeekMin = minutesInRange(log, lastWeekStart, lastWeekEnd);
  const diffMin = thisWeekMin - lastWeekMin;
  const pctChange = lastWeekMin > 0 ? round2((diffMin / lastWeekMin) * 100) : null;

  const daily = [];
  for (let i = 0; i < 7; i++) {
    const d = addDaysStr(thisWeekStart, i);
    daily.push({ date: d, dayName: DAY_NAMES[i], minutes: minutesInRange(log, d, d) });
  }

  const byGoal = {};
  const bySeder = {};
  const bySederLast = {};
  SEDERS.forEach(function (s) { bySeder[s.key] = 0; bySederLast[s.key] = 0; });

  log.forEach(function (e) {
    if (e.date >= thisWeekStart && e.date <= thisWeekEnd) {
      byGoal[e.goalId] = (byGoal[e.goalId] || 0) + e.actualMin;
      bySeder[e.seder] = (bySeder[e.seder] || 0) + e.actualMin;
    } else if (e.date >= lastWeekStart && e.date <= lastWeekEnd) {
      bySederLast[e.seder] = (bySederLast[e.seder] || 0) + e.actualMin;
    }
  });

  const weekPlan = readWeekPlan(thisWeekStart);
  const plannedThisWeek = weekPlan.reduce(function (sum, b) { return sum + b.durationMin; }, 0);
  const plannedBySeder = {};
  SEDERS.forEach(function (s) { plannedBySeder[s.key] = 0; });
  weekPlan.forEach(function (b) { plannedBySeder[b.seder] = (plannedBySeder[b.seder] || 0) + b.durationMin; });

  const recent = log.slice().sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.startTime < b.startTime ? 1 : -1;
  }).slice(0, 12);

  return {
    thisWeekMin: thisWeekMin,
    lastWeekMin: lastWeekMin,
    diffMin: diffMin,
    pctChange: pctChange,
    plannedThisWeek: plannedThisWeek,
    adherence: plannedThisWeek > 0 ? round2((thisWeekMin / plannedThisWeek) * 100) : null,
    daily: daily,
    byGoal: byGoal,
    bySeder: bySeder,
    bySederLast: bySederLast,
    plannedBySeder: plannedBySeder,
    streak: computeStreak(log),
    totalSessions: log.length,
    totalMin: log.reduce(function (s, e) { return s + e.actualMin; }, 0),
    goals: goals,
    recent: recent,
    weekStart: thisWeekStart
  };
}


/* ==========================================================================
   11. API ללקוח
   ========================================================================== */

function findCurrentBlock() {
  const today = todayStr();
  const blocks = readWeekPlan(currentWeekStart())
    .filter(function (b) { return b.date === today && b.status !== 'done'; });
  if (!blocks.length) return null;

  const now = new Date();
  const GRACE_BEFORE = 30 * 60000;
  const GRACE_AFTER = 60 * 60000;

  let best = null;
  blocks.forEach(function (b) {
    const start = parseDateTime(b.date, b.startTime);
    if (!start || isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + b.durationMin * 60000);
    const inWindow = now.getTime() >= start.getTime() - GRACE_BEFORE &&
                     now.getTime() <= end.getTime() + GRACE_AFTER;
    const item = {
      block: b,
      inWindow: inWindow,
      startsInMin: Math.round((start.getTime() - now.getTime()) / 60000)
    };
    if (!best) { best = item; return; }
    if (item.inWindow && !best.inWindow) { best = item; return; }
    if (item.inWindow === best.inWindow &&
        Math.abs(item.startsInMin) < Math.abs(best.startsInMin)) best = item;
  });
  return best;
}

function getBootstrap() {
  const goals = readGoals();
  const weekStart = currentWeekStart();
  const plan = readWeekPlan(weekStart);
  const today = todayStr();
  const weeks = planningWeeks();
  const inPlanningWindow = isPlanningWindow();

  return {
    planning: {
      inWindow: inPlanningWindow,
      reviewWeekStart: weeks.review,
      targetWeekStart: weeks.target,
      targetWeekPlanned: readWeekPlan(weeks.target).length,
      // הבאנר מופיע רק אם זה מוצ״ש/ראשון והשבוע הבא עדיין ריק
      showPrompt: inPlanningWindow && readWeekPlan(weeks.target).length === 0
    },
    booksWithoutTarget: goals.filter(function (g) { return !g.hasTarget; }).length,
    ok: true,
    version: APP_VERSION,
    today: today,
    todayDayName: DAY_NAMES[dowOf(today)],
    nowTime: nowTimeStr(),
    currentSeder: sederFromTime(nowTimeStr()),
    weekStart: weekStart,
    nextWeekStart: addDaysStr(weekStart, 7),
    goals: goals,
    plan: plan,
    todayPlan: plan.filter(function (b) { return b.date === today; }),
    current: findCurrentBlock(),
    session: getActiveSession(),
    stats: getStats(),
    settings: getSettings(),
    catalog: getCatalog(),
    seders: SEDERS,
    webAppUrl: getWebAppUrl(),
    sheetUrl: getSheetUrl(),
    iconUrl: getIconUrl(),
    palette: PALETTE,
    dayNames: DAY_NAMES,
    serverNow: new Date().toISOString()
  };
}

function getSyncState() {
  return { session: getActiveSession(), serverNow: new Date().toISOString() };
}

function getWeekPlanFor(weekStart) {
  return { weekStart: weekStart, plan: readWeekPlan(weekStart), dayNames: DAY_NAMES };
}


/* ==========================================================================
   12. תזכורת למפגש שנשכח פתוח (טריגר זמן, אופציונלי)
       Triggers → Add trigger → checkForgottenSession → Time-driven → כל שעה
   ========================================================================== */

function checkForgottenSession() {
  const s = readSession();
  if (!s) return;
  // לא שולחים מייל בשבת. הטריגר ירוץ שוב במוצ״ש והתזכורת תישלח אז.
  if (isShabbatWindow()) return;
  const hrs = (new Date().getTime() - new Date(s.start).getTime()) / 3600000;
  if (hrs <= 6) return;
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) return;
    MailApp.sendEmail(email, 'מפגש לימוד פתוח כבר ' + Math.round(hrs) + ' שעות',
      'שכחת לסגור מפגש לימוד. פתח את האפליקציה כדי לסיים ולסכם:\n' + getWebAppUrl());
  } catch (e) { /* אין הרשאת מייל */ }
}




/* ==========================================================================
   14. אייקון האפליקציה
   --------------------------------------------------------------------------
   מגבלה שחשוב להכיר: Apps Script מגיש את Index.html בתוך iframe מקונן
   (userCodeAppPanel). דפדפנים קוראים manifest ו-apple-touch-icon אך ורק
   מהמסמך העליון — שהוא עמוד העטיפה של Google, לא ה-HTML שלנו. לכן תגיות
   אייקון בתוך Index.html לבדן לא ישפיעו על "הוסף למסך הבית".

   הנקודה היחידה שדרכה אפשר להשפיע על המסמך העליון היא setFaviconUrl(),
   והיא דורשת כתובת אמיתית של תמונה. לכן installIcon() מעלה את ה-PNG
   לדרייב, משתף אותו בקישור, ושומר את הכתובת — ו-doGet מגיש אותה.

   הרץ installIcon() פעם אחת מהעורך, ואז פרוס מחדש (New version).
   ========================================================================== */

const ICON_FILE_NAME = 'study-manager-icon.png';

/** PNG 512×512 בפלטת האפליקציה (מוקה כהה, ורוד רך, קרמל). */
const ICON_PNG_B64 =
  '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';

function getIconUrl() {
  return PropertiesService.getUserProperties().getProperty('iconUrl') || '';
}

/**
 * מעלה את האייקון לדרייב, משתף אותו לצפייה בקישור, ושומר את הכתובת.
 * בטוח להרצה חוזרת — מוחק את הקובץ הקודם לפני שהוא יוצר חדש.
 * דורש הרשאת Drive, ולכן יפתח מסך אישור בהרצה הראשונה.
 */
function installIcon() {
  const props = PropertiesService.getUserProperties();

  const oldId = props.getProperty('iconFileId');
  if (oldId) {
    try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { /* כבר נמחק */ }
  }

  const blob = Utilities.newBlob(
    Utilities.base64Decode(ICON_PNG_B64), 'image/png', ICON_FILE_NAME);
  const file = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const id = file.getId();
  const url = 'https://lh3.googleusercontent.com/d/' + id;
  props.setProperty('iconFileId', id);
  props.setProperty('iconUrl', url);

  const msg = 'האייקון הותקן.\n' + url +
    '\n\nעכשיו: Deploy → Manage deployments → ✏️ → Version: New version.';
  Logger.log(msg);
  return { status: 'installed', url: url, message: msg };
}

/** מסיר את האייקון וחוזר לברירת המחדל של Google. */
function removeIcon() {
  const props = PropertiesService.getUserProperties();
  const id = props.getProperty('iconFileId');
  if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }
  props.deleteProperty('iconFileId');
  props.deleteProperty('iconUrl');
  return { status: 'removed' };
}


/* ==========================================================================
   15. doGet
   ========================================================================== */

function doGet() {
  const out = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  // האייקון של המסמך העליון — הדרך היחידה להשפיע על מה שנשמר למסך הבית
  const icon = getIconUrl();
  if (icon) {
    try { out.setFaviconUrl(icon); } catch (e) { /* כתובת לא תקינה — מתעלמים */ }
  }
  return out;
}
