'use strict';

// Gate messages. A project in any language other than these gets English.

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
    indexFix: 'בנה את הטבלה מחדש מהכרטיסים. כך היא צריכה להיראות:',

    vanished: (title, file) => `פריט פתוח נעלם: "${title}" נמחק מ-${file}, ושאר הקובץ לא השתנה.`,
    vanishedFix: 'סגירת פריט פתוח משנה את תיאור המצב. כתוב בקובץ את המצב החדש כעובדה, גם כשהפריט נסגר בהחלטה ולא בקוד.',
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
    indexFix: 'Rebuild the table from the cards. It should read:',

    vanished: (title, file) => `Open item vanished: "${title}" was deleted from ${file}, and the rest of the file did not change.`,
    vanishedFix: 'Closing an open item changes the description of the state. Write the new state in the file as a fact, even when the item was closed by a decision and not by code.',
  },
};

function messagesFor(language) {
  return MESSAGES[language] || MESSAGES.en;
}

module.exports = { messagesFor };
