/**
 * ============================================================================
 *  Api.gs — שכבת ה-API: doPost כניסה יחידה, בסגנון JSON-RPC
 * ============================================================================
 *
 *  למה POST, ולמה טוקסט רגיל ולא JSON, בבקשה:
 *  ל-Apps Script אין תמיכה ב-CORS — אין טיפול ב-OPTIONS ואין דרך להגדיר
 *  כותרות תגובה על TextOutput. רק בקשות "simple" עוברות בלי preflight:
 *  GET, או POST עם Content-Type: text/plain. בקשה עם Content-Type:
 *  application/json תפעיל preflight שלעולם לא ייענה. ה-Worker שיקרא ל-API
 *  הזה שולח את גוף הבקשה כ-text/plain (ופענוח ה-JSON קורה כאן, ידנית, על
 *  המחרוזת הגולמית) — ראה DECISIONS.md #15. אל "תתקן" את זה ל-application/json.
 *
 *  הבקשה: POST עם גוף JSON — { token, fn, args }.
 *  התשובה: תמיד HTTP 200 (Apps Script לא מאפשר קוד תגובה אחר מ-TextOutput
 *  בפריסת web app), בגוף JSON —
 *    { ok: true,  data: <הערך שהפונקציה החזירה> }
 *    { ok: false, error: "<הודעה בעברית>" }
 *  שגיאה זרוקה אף פעם לא בורחת כדף שגיאת HTML של Apps Script — doPost
 *  עוטף את הכול ב-try/catch יחיד ומחזיר { ok:false } במקום.
 *
 *  doGet ב-Code.gs לא נוגע כלל — האפליקציה הקיימת ממשיכה לעבוד כרגיל.
 * ============================================================================
 */

const API_TOKEN_PROP = 'apiToken';

/**
 * הרץ פעם אחת מהעורך כדי להגדיר את הטוקן.
 * הטוקן הוא סוד: לעולם אל תשמור אותו בקוד, לעולם אל תעשה לו commit, ולעולם
 * אל תדפיס אותו ל-Logger. אם הוא דלף, הרץ שוב עם ערך חדש — הישן מתבטל.
 */
function setApiToken(token) {
  if (!token) throw new Error('חובה לספק טוקן.');
  PropertiesService.getScriptProperties().setProperty(API_TOKEN_PROP, String(token));
  return { status: 'saved' };
}

/**
 * טבלת הפונקציות שה-API מרשה לקרוא להן, בשם מפורש בלבד. נבנית בתוך פונקציה
 * (לא const עליון) כדי שהפניות חוצות-קבצים (getBootstrap וכו׳) יפתרו רק
 * בזמן קריאה בפועל, אחרי שכל הפרויקט נטען — ראה איך getCatalog() ב-Code.gs
 * עושה את אותו דבר עם typeof לגבי readCatalogSheet.
 *
 * זו הרשימה השלמה. אין דרך לקרוא לפונקציה שאינה כאן — לא syncCatalog,
 * לא installIcon, לא שום מיגרציה, לא backupNow. הרחבה דורשת שורה כאן,
 * מפורשות, לא שינוי בלוגיקת הדיספאץ׳.
 */
function apiDispatchTable_() {
  return {
    getBootstrap: getBootstrap,
    getSyncState: getSyncState,
    getWeekPlanFor: getWeekPlanFor,
    getWeekReview: getWeekReview,
    startSession: startSession,
    pauseSession: pauseSession,
    resumeSession: resumeSession,
    switchGoal: switchGoal,
    setSessionSeder: setSessionSeder,
    stopSession: stopSession,
    saveDraft: saveDraft,
    finishSession: finishSession,
    cancelSession: cancelSession,
    saveGoal: saveGoal,
    deleteGoal: deleteGoal,
    setGoalTarget: setGoalTarget,
    saveWeekPlan: saveWeekPlan,
    deletePlanBlock: deletePlanBlock,
    saveSettings: saveSettings,
    getCatalog: getCatalog
  };
}

/** גוף הבקשה → אובייקט. JSON לא תקין, או שאינו אובייקט, זורק שגיאה ברורה. */
function parseApiRequestBody_(e) {
  const raw = (e && e.postData && e.postData.contents) || '';
  let body;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    throw new Error('גוף הבקשה אינו JSON תקין.');
  }
  if (!body || typeof body !== 'object') throw new Error('גוף הבקשה אינו JSON תקין.');
  return body;
}

/**
 * בדיקת הטוקן. אם apiToken לא הוגדר בכלל — נועל הכול, לא פותח. לעולם לא
 * מדווחת את הערך המצופה או את הערך שהתקבל, כדי שהודעת השגיאה עצמה לא תדלוף.
 */
function checkApiToken_(receivedToken) {
  const expected = PropertiesService.getScriptProperties().getProperty(API_TOKEN_PROP);
  if (!expected) return { ok: false, error: 'apiToken לא הוגדר בשרת. הרץ setApiToken מהעורך.' };
  if (String(receivedToken || '') !== expected) return { ok: false, error: 'אימות נכשל.' };
  return { ok: true };
}

function apiJsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = parseApiRequestBody_(e);

    const tokenCheck = checkApiToken_(body.token);
    if (!tokenCheck.ok) return apiJsonResponse_({ ok: false, error: tokenCheck.error });

    const fnName = String(body.fn || '');
    const table = apiDispatchTable_();
    if (!Object.prototype.hasOwnProperty.call(table, fnName)) {
      return apiJsonResponse_({ ok: false, error: 'פונקציה לא מורשית: ' + fnName });
    }

    const args = Array.isArray(body.args) ? body.args : [];
    const data = table[fnName].apply(null, args);
    return apiJsonResponse_({ ok: true, data: data });
  } catch (err) {
    return apiJsonResponse_({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}
