'use strict';

// Gate messages, and the one line the plugin writes into a queue by itself.
// A project in any language other than these gets English.

const MESSAGES = {
  he: {
    blocked: 'הקומיט נחסם (trabel-memory).',
    warned: 'אזהרה (trabel-memory): הקומיט עבר, אבל השער מצא בעיות.',
    crashed: (reason) => `trabel-memory: השער לא הצליח לרוץ, והקומיט עובר. (${reason})`,
    more: (n) => `ועוד ${n}.`,
    or: ' או ',

    unowned: (file) => `קוד בלי בעלים: ${file}. אף קובץ מצב אינו אחראי עליו.`,
    unownedFix: 'הוסף את הנתיב ל-owns של קובץ התחום המתאים, או פתח קובץ תחום חדש ב-docs/state.',
    starInGeneral: (file, p) => `כוכבית בקובץ כללי: ${file} מחזיק את הדפוס ${p}.`,
    starInGeneralFix: 'architecture ו-conventions מחזיקים רק נתיבים מפורשים של קבצים. רשום כל קובץ בשמו המלא.',
    swallowAll: (file, p) => `דפוס שבולע הכל: ${file} מחזיק את הדפוס ${p}.`,
    broad: (file, p, n, total, pct) => `דפוס רחב מדי: ${p} ב-${file} תופס ${n} מתוך ${total} קבצי הקוד (${pct}%).`,
    patternFix: 'דפוס כזה בולע קוד חדש, ואז קוד של תחום חדש לא נתפס. צמצם את הדפוס לתחום עצמו, או פצל את התחום.',

    undocumented: (code, owners) => `קוד בלי תיעוד: ${code} השתנה, ו-${owners} לא.`,
    undocumentedFix: 'עדכן את הקובץ, או הוסף להודעת הקומיט שורת Docs-Unchanged: עם הסיבה אם ההתנהגות לא השתנתה.',

    overBudget: (file, n, max) => `חריגה מתקרה: ${file} באורך ${n} שורות, והתקרה ${max}.`,
    rulesOverBudget: (n, max) => `חריגה מתקרה: הכללים בבלוק שב-CLAUDE.md באורך ${n} שורות, והתקרה ${max}.`,
    overBudgetFix: 'קודם קצר: מחק מה שהקוד אומר בעצמו בבירור. אם זה לא מספיק, פצל לשני תחומים. תקרה עולה רק בשינוי מפורש של budget בכרטיס.',

    indexMissing: 'אינדקס חסר: אין ב-CLAUDE.md בלוק של trabel-memory עם טבלת אינדקס.',
    indexMismatch: 'אינדקס לא תואם: טבלת האינדקס שב-CLAUDE.md אינה תואמת לכרטיסים.',
    indexFix: (cmd) => `בנה את הטבלה מחדש מהכרטיסים בהרצה אחת: ${cmd}\nכך היא צריכה להיראות:`,

    vanished: (title, file) => `פריט פתוח נעלם: "${title}" נמחק מ-${file}, ושאר הקובץ לא השתנה.`,
    vanishedFix: 'סגירת פריט פתוח משנה את תיאור המצב. כתוב בקובץ את המצב החדש כעובדה, גם כשהפריט נסגר בהחלטה ולא בקוד.',

    planMissing: (plan) => `התור מצביע על תוכנית שאינה קיימת: ${plan}.`,
    planMissingFix: 'הוסף את קובץ התוכנית לגיט, או תקן את הנתיב שבתור. תור רגיל, בלי תוכנית, נכתב בלי שורת ההפניה.',
    planJump: (from, to) => `סשן דולג: התור עבר מסשן ${from} לסשן ${to}.`,
    planJumpFix: 'התור מתקדם סשן אחד בכל פעם, ורק כשכל המשימות של הסשן בוצעו. כתוב בתור את הסשן הבא בלבד.',
    planBack: (from, to) => `התור חזר אחורה: מסשן ${from} לסשן ${to}.`,
    planBackFix: 'מספר הסשן אינו יורד. החזר את המספר, ומשימה שהתברר שלא הושלמה הוסף למשימות של הסשן הנוכחי או כתוב כפריט פתוח בתחום שלה.',
    planList: 'רשימת הסשנים שנשארו השתנתה.',
    planListFix: 'כשסשן מסתיים, רק השורה העליונה של הרשימה יורדת, ושאר השורות נשארות מילה במילה. אם הרשימה השתנתה בכוונה (סשן נוסף, הוסר או נוסח מחדש), הוסף להודעת הקומיט שורת Decision: עם מה שהוחלט.',
    planListExpected: 'כך היא צריכה להיראות:',
    planListNone: 'לא אמורים להישאר בה סשנים.',
    planEdited: (plan) => `קובץ התוכנית השתנה: ${plan}.`,
    planEditedFix: 'בתוכנית לא משנים מילה בלי בקשה מפורשת של האדם, ואיפה עומדים כתוב רק בתור. אם האדם ביקש את השינוי, הוסף להודעת הקומיט שורת Decision: עם מה שהשתנה ולמה.',
    planDropped: (plan, n, m) => `התוכנית ירדה מהתור לפני שהסתיימה: ${plan}, סשן ${n} מתוך ${m}.`,
    planDroppedFix: 'קובץ התוכנית נמחק, וההפניה אליו יורדת מהתור, רק אחרי הסשן האחרון. אם הוחלט לעצור את התוכנית או להחליף אותה, הוסף להודעת הקומיט שורת Decision: עם הסיבה.',

    queueEmpty: 'התור ריק.',
  },
  en: {
    blocked: 'Commit blocked (trabel-memory).',
    warned: 'Warning (trabel-memory): the commit went through, but the gate found problems.',
    crashed: (reason) => `trabel-memory: the gate could not run, so the commit goes through. (${reason})`,
    more: (n) => `And ${n} more.`,
    or: ' or ',

    unowned: (file) => `Code without an owner: ${file}. No state file is responsible for it.`,
    unownedFix: 'Add the path to the owns list of the right domain file, or open a new domain file in docs/state.',
    starInGeneral: (file, p) => `Star in a general file: ${file} holds the pattern ${p}.`,
    starInGeneralFix: 'architecture and conventions hold only explicit file paths. List each file by its full name.',
    swallowAll: (file, p) => `Pattern that swallows everything: ${file} holds the pattern ${p}.`,
    broad: (file, p, n, total, pct) => `Pattern too broad: ${p} in ${file} matches ${n} of ${total} code files (${pct}%).`,
    patternFix: 'Such a pattern swallows new code, so code of a new domain is never caught. Narrow the pattern to the domain itself, or split the domain.',

    undocumented: (code, owners) => `Code without docs: ${code} changed, and ${owners} did not.`,
    undocumentedFix: 'Update that file, or add a Docs-Unchanged: line with the reason to the commit message if behavior did not change.',

    overBudget: (file, n, max) => `Over the limit: ${file} has ${n} lines, and the limit is ${max}.`,
    rulesOverBudget: (n, max) => `Over the limit: the rules in the CLAUDE.md block have ${n} lines, and the limit is ${max}.`,
    overBudgetFix: 'First shorten: delete what the code already says clearly. If that is not enough, split into two domains. A limit rises only by an explicit change of budget in the card.',

    indexMissing: 'Index missing: CLAUDE.md has no trabel-memory block with an index table.',
    indexMismatch: 'Index out of date: the index table in CLAUDE.md does not match the cards.',
    indexFix: (cmd) => `Rebuild the table from the cards with one run: ${cmd}\nIt should read:`,

    vanished: (title, file) => `Open item vanished: "${title}" was deleted from ${file}, and the rest of the file did not change.`,
    vanishedFix: 'Closing an open item changes the description of the state. Write the new state in the file as a fact, even when the item was closed by a decision and not by code.',

    planMissing: (plan) => `The queue points at a plan that does not exist: ${plan}.`,
    planMissingFix: 'Add the plan file to git, or fix the path in the queue. A plain queue, with no plan, is written without the reference line.',
    planJump: (from, to) => `Session skipped: the queue went from session ${from} to session ${to}.`,
    planJumpFix: 'The queue moves one session at a time, and only when every task of the session is done. Write only the next session in the queue.',
    planBack: (from, to) => `The queue went backwards: from session ${from} to session ${to}.`,
    planBackFix: 'The session number does not go down. Restore it, and add a task that turned out unfinished to the current session, or write it as an open item in its domain.',
    planList: 'The list of sessions left changed.',
    planListFix: 'When a session ends, only the top line of the list drops, and the other lines stay word for word. If the list changed on purpose (a session added, removed or reworded), add a Decision: line to the commit message saying what was decided.',
    planListExpected: 'It should read:',
    planListNone: 'No sessions should be left in it.',
    planEdited: (plan) => `The plan file changed: ${plan}.`,
    planEditedFix: 'Not a word of the plan changes unless the person asked for it, and where the work stands is written only in the queue. If the person asked for the change, add a Decision: line to the commit message saying what changed and why.',
    planDropped: (plan, n, m) => `The plan left the queue before it was finished: ${plan}, session ${n} of ${m}.`,
    planDroppedFix: 'The plan file is deleted, and its reference leaves the queue, only after the last session. If the plan was stopped or replaced on purpose, add a Decision: line to the commit message with the reason.',

    queueEmpty: 'The queue is empty.',
  },
};

function messagesFor(language) {
  return MESSAGES[language] || MESSAGES.en;
}

module.exports = { messagesFor };
