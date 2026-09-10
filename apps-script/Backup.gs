/**
 * ============================================================================
 *  Backup.gs — גיבוי אוטומטי של נתוני האפליקציה
 * ============================================================================
 *
 *  למה בכלל, אם לגיליון יש היסטוריית גרסאות:
 *  היסטוריית הגרסאות מגנה מפני עריכה ידנית שגויה. היא מגנה פחות טוב מפני
 *  קוד — syncCatalog עושה clear() ללשונית שלמה, saveWeekPlan מוחק שורות,
 *  ופריסה שגויה יכולה לדרוס. גיבוי בקובץ נפרד הוא עותק שאף סקריפט
 *  שלנו לא נוגע בו.
 *
 *  שני פורמטים בכוונה:
 *    עותק גיליון — לשחזור מיידי. פותחים, וזהו.
 *    קובץ JSON   — נייד. נקרא בלי Google, ומתאים להגירה לכל מסד נתונים.
 *
 *  התקנה:
 *   1. + → Script → קרא לקובץ "Backup" → הדבק.
 *   2. הרץ backupNow() פעם אחת — יבקש הרשאת Drive ויוודא שהכול עובד.
 *   3. הרץ installBackupTrigger() — גיבוי שבועי אוטומטי, ראשון ב-05:00.
 *
 *  שחזור: פתח את listBackups(), קח את הקישור, פתח את העותק,
 *  ו-File → Make a copy כדי להחזיר אותו לתפקיד הגיליון החי.
 * ============================================================================
 */

const BACKUP_FOLDER_NAME = 'גיבויי סדרי הלימוד';
const BACKUP_KEEP = 8;          // כמה גיבויים לשמור. 8 שבועיים ≈ חודשיים.
const BACKUP_PREFIX = 'סדרי-לימוד-גיבוי';


/* ==========================================================================
   1. עזרים טהורים — נבדקים ב-Node
   ========================================================================== */

/** שם קובץ הגיבוי. מיון לקסיקוגרפי = מיון כרונולוגי, בכוונה. */
function backupFileName_(dateStr, kind) {
  return BACKUP_PREFIX + '-' + dateStr + (kind === 'json' ? '.json' : '');
}

/**
 * בוחר אילו גיבויים למחוק. מקבל רשימת {name, date} ומחזיר את מה שמעבר
 * ל-keep האחרונים. מפריד בין עותקי גיליון לבין JSON כדי ששני הסוגים
 * יישמרו במקביל ולא ידחקו זה את זה.
 */
function filesToTrash_(files, keep) {
  keep = keep || BACKUP_KEEP;
  const groups = { sheet: [], json: [] };
  files.forEach(function (f) {
    const isJson = /\.json$/.test(f.name);
    groups[isJson ? 'json' : 'sheet'].push(f);
  });
  let out = [];
  ['sheet', 'json'].forEach(function (k) {
    const sorted = groups[k].slice().sort(function (a, b) {
      return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);   // חדש קודם
    });
    out = out.concat(sorted.slice(keep));
  });
  return out;
}

/** תא גיליון → ערך שאפשר לשים ב-JSON בלי לאבד מידע. */
function cellToJson_(v) {
  if (v instanceof Date) return { __date: v.toISOString() };
  return v;
}


/* ==========================================================================
   2. תיקיית היעד
   ========================================================================== */

/**
 * מחזיר את תיקיית הגיבויים, ויוצר אותה בפעם הראשונה.
 * מזהה התיקייה נשמר, כי חיפוש לפי שם סורק את כל הדרייב ועלול למצוא
 * תיקייה אחרת עם אותו שם.
 */
function backupFolder_() {
  const props = PropertiesService.getUserProperties();
  const saved = props.getProperty('backupFolderId');
  if (saved) {
    try { return DriveApp.getFolderById(saved); }
    catch (e) { props.deleteProperty('backupFolderId'); }   // נמחקה — ניצור חדשה
  }
  const folder = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty('backupFolderId', folder.getId());
  return folder;
}


/* ==========================================================================
   3. הגיבוי
   ========================================================================== */

/** תמונת מצב JSON של כל הלשוניות. */
function buildJsonSnapshot_(ss) {
  const out = {
    app: 'מנהל סדרי הלימוד',
    version: (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '?',
    exportedAt: new Date().toISOString(),
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    sheets: {}
  };
  ss.getSheets().forEach(function (sheet) {
    const values = sheet.getDataRange().getValues();
    if (!values.length) { out.sheets[sheet.getName()] = { headers: [], rows: [] }; return; }
    out.sheets[sheet.getName()] = {
      headers: values[0].map(String),
      rows: values.slice(1).map(function (row) { return row.map(cellToJson_); })
    };
  });
  return out;
}

/**
 * מריץ גיבוי מלא: עותק גיליון + JSON, ואז מסובב ומוחק ישנים.
 * בטוח להרצה חוזרת. מחזיר דוח.
 */
function backupNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('הסקריפט אינו מקושר לגיליון.');

  const tz = (typeof TZ !== 'undefined') ? TZ : 'Asia/Jerusalem';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd-HHmm');
  const folder = backupFolder_();
  const report = [];

  // 1. עותק הגיליון
  const copy = DriveApp.getFileById(ss.getId())
                       .makeCopy(backupFileName_(stamp, 'sheet'), folder);
  report.push('✓ עותק גיליון: ' + copy.getName());

  // 2. תמונת JSON
  const snapshot = buildJsonSnapshot_(ss);
  const jsonFile = folder.createFile(
    backupFileName_(stamp, 'json'),
    JSON.stringify(snapshot, null, 2),
    MimeType.PLAIN_TEXT);
  let rowCount = 0;
  Object.keys(snapshot.sheets).forEach(function (k) {
    rowCount += snapshot.sheets[k].rows.length;
  });
  report.push('✓ JSON: ' + Object.keys(snapshot.sheets).length +
              ' לשוניות, ' + rowCount + ' שורות, ' +
              Math.round(jsonFile.getSize() / 1024) + 'KB');

  // 3. סיבוב
  const existing = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(BACKUP_PREFIX) !== 0) continue;
    existing.push({ name: f.getName(), date: f.getDateCreated().toISOString(), file: f });
  }
  const doomed = filesToTrash_(existing, BACKUP_KEEP);
  doomed.forEach(function (d) { d.file.setTrashed(true); });
  report.push(doomed.length
    ? ('· נמחקו ' + doomed.length + ' גיבויים ישנים (שומרים ' + BACKUP_KEEP + ' מכל סוג)')
    : ('· ' + existing.length + ' גיבויים בתיקייה'));

  report.push('');
  report.push('תיקייה: ' + folder.getUrl());

  const msg = report.join('\n');
  Logger.log(msg);
  return msg;
}

/** מה שהטריגר מפעיל. עוטף כדי שכשל ישלח מייל במקום להיעלם בשקט. */
function weeklyBackup() {
  try {
    backupNow();
  } catch (e) {
    try {
      const email = Session.getActiveUser().getEmail();
      if (email) {
        MailApp.sendEmail(email, 'גיבוי סדרי הלימוד נכשל',
          'הגיבוי השבועי לא הושלם.\n\nשגיאה: ' + e.message +
          '\n\nהרץ backupNow() ידנית מהעורך כדי לראות מה קרה.');
      }
    } catch (e2) { /* אין הרשאת מייל */ }
    throw e;
  }
}


/* ==========================================================================
   4. טריגר
   ========================================================================== */

/**
 * גיבוי שבועי, ראשון ב-05:00. יום ראשון ולא מוצ״ש — הגיבוי תופס את
 * השבוע שנסגר אחרי שכבר תכננת את הבא.
 * בטוח להרצה חוזרת: מוחק טריגרים קודמים של אותה פונקציה.
 */
function installBackupTrigger() {
  removeBackupTrigger();
  ScriptApp.newTrigger('weeklyBackup')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(5)
    .create();
  const msg = 'טריגר הותקן: גיבוי כל יום ראשון ב-05:00.';
  Logger.log(msg);
  return msg;
}

function removeBackupTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyBackup') {
      ScriptApp.deleteTrigger(t); n++;
    }
  });
  if (n) Logger.log('הוסרו ' + n + ' טריגרים קודמים.');
  return n;
}


/* ==========================================================================
   5. מה קיים
   ========================================================================== */

function listBackups() {
  const folder = backupFolder_();
  const rows = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(BACKUP_PREFIX) !== 0) continue;
    rows.push({ name: f.getName(), date: f.getDateCreated(),
                size: f.getSize(), url: f.getUrl() });
  }
  rows.sort(function (a, b) { return b.date - a.date; });

  const tz = (typeof TZ !== 'undefined') ? TZ : 'Asia/Jerusalem';
  const lines = ['תיקייה: ' + folder.getUrl(), ''];
  if (!rows.length) lines.push('אין גיבויים עדיין. הרץ backupNow().');
  rows.forEach(function (r) {
    lines.push(Utilities.formatDate(r.date, tz, 'yyyy-MM-dd HH:mm') + '  ' +
               r.name + '  (' + Math.round(r.size / 1024) + 'KB)');
  });

  const triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'weeklyBackup';
  });
  lines.push('');
  lines.push(triggers.length ? 'טריגר שבועי: פעיל' : 'טריגר שבועי: לא מותקן');

  const msg = lines.join('\n');
  Logger.log(msg);
  return msg;
}
