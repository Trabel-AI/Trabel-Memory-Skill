---
name: הפצה
summary: איך התוסף מגיע למשתמשים - הזהות והקטלוג ב-.claude-plugin, ההתקנה והעדכונים בלי מספר גרסה, ה-README בעברית ובאנגלית, הלוגו, וסוף שורה LF בכל התקנה
owns:
  - .claude-plugin/*
  - README.md
  - README.he.md
  - .gitattributes
---

# הפצה

## פתוח ושבור

אין.

## מה התחום עושה

המאגר נמצא בגיטהאב כ-`Trabel-AI/Trabel-Memory-Skill`, פרטי, והוא גם התוסף וגם הקטלוג שממנו מתקינים אותו. כל קומיט שעולה לענף הראשי בגיטהאב הוא גרסה, ומגיע לכל מי שהתקין.

## מה המשתמש רואה ועושה

- התקנה בשתי פקודות ב-Claude Code:
  ```
  /plugin marketplace add Trabel-AI/Trabel-Memory-Skill
  /plugin install trabel-memory@trabel
  ```
- עדכונים מגיעים לבד. אין מספר גרסה ואין שלב שחרור.
- דרישות: גיט, ו-Node.js 18 ומעלה. כל עוד המאגר פרטי, ההתקנה דורשת חשבון גיטהאב עם גישה אליו, וגיט מחובר לחשבון הזה.
- שם התוסף, שהוא גם הקידומת של הפקודות, הוא `trabel-memory`. הפקודות: `setup`, `save`, `open`, `guide`. גם בקשה במילים מפעילה אותן. `/memory` לבדה היא פקודה מובנית של Claude Code ואינה פנויה.
- ה-README מציג בראשו את הלוגו, ומסביר את הבעיה, מה התוסף מוסיף לפרויקט, העבודה היומיומית, ההתקנה, הפטורים בהודעת הקומיט, השפות, ומצב הבדיקות (נבדק ב-Windows, ההוק של הגיט לא נבדק ב-Mac וב-Linux). `README.md` באנגלית, והוא מה שגיטהאב מציג. `README.he.md` בעברית, מימין לשמאל. יש קישור מאחד לשני.

## נתונים והרשאות

- `.claude-plugin/plugin.json`: שם (`trabel-memory`), תיאור, מחבר (Trabel), קישור למאגר ולדף הבית, ומילות מפתח. בלי `version`.
- `.claude-plugin/marketplace.json`: קטלוג בשם `trabel` עם תוסף אחד, `trabel-memory`, שנמצא בשורש המאגר (`"source": "./"`). בלי `version`.
- התיאור של המאגר בגיטהאב, באנגלית: "Trabel Memory Skill. A Claude Code plugin that gives every project a memory of its current state, so each new conversation starts from it and not from zero."
- הלוגו ב-`brand/`: `Trabel-Memory-Skill-Logo-Light.png` לרקע בהיר ו-`Trabel-Memory-Skill-Logo-Dark.png` לרקע כהה. ה-README משתמש ב-`<picture>`, כך שגיטהאב מציג את הגרסה שמתאימה לרקע של הקורא. לתוסף של Claude Code אין מקום רשמי לאייקון: אין שדה כזה ב-`plugin.json` ולא ב-`marketplace.json` (אומת מול התיעוד הרשמי).
- הפצה לאנשים מחוץ לחברה מחכה לשבועיים-שלושה של שימוש אמיתי, שמהם ידוע מה חוסם לשווא ומה חסר.

## איך זה בנוי

- **בלי `version`, בכוונה.** לפי התיעוד הרשמי, כשיש `version` משתמשים מקבלים עדכון רק כשהמספר עולה, ושיפור שעלה בלי העלאת מספר לא מגיע לאף אחד, בשקט. בלי `version` הגרסה היא מזהה הקומיט. `claude plugin validate` עוברת על המאגר וממליצה להוסיף `version`, וההמלצה נדחית. בדיקה ב-`tests/manifest.test.js` נכשלת אם `version` מופיע ב-`plugin.json` או ברשומת התוסף בקטלוג.
- **מה שעולה לענף הראשי חייב להיות בדוק**, כי אין שלב שחרור נפרד.
- **`.gitattributes`** קובע `* text=auto eol=lf` ו-`*.png binary`. ההתקנה עוברת דרך גיט אצל כל משתמש, וכך כל קובץ של התוסף יוצא עם סוף שורה LF בלי קשר להגדרות הגיט של המחשב. הסיבה: [conventions.md](conventions.md), המלכודת של CRLF.
- בהתקנה מנתיב מקומי התוסף נטען במקומו, והנתיב שלו קבוע.
- אומת מול התיעוד הרשמי (plugins, plugins-reference, plugin-marketplaces): מבנה התוסף, ההתקנה והעדכונים, השפעת `version` על עדכונים, ומבנה הקטלוג.

## מלכודות

- **הוספת `version` עוצרת את כל העדכונים בשקט** עד שהמספר עולה. הבדיקה ב-`tests/manifest.test.js` חוסמת את זה.
- **שני ה-README מתארים את אותו דבר.** שינוי באחד נכתב גם בשני.
