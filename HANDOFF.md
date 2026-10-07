# HANDOFF — מחולל תסריטי הדרכה לרכב (Base44)

## 1. מטרת המערכת
כלי פנימי להפקת תסריטי קריינות בעברית לסרטוני הדרכה על מערכות רכב.
המערכת מקבלת ספר נהג + מפרט/אסמכתת אבזור של דגם מסוים, מזהה אילו מערכות קיימות בדגם,
בונה תוכנית הפקה (תסריט כללי + תסריטים ממוקדים), כותבת את התסריטים עם מודל LLM נעול,
מריצה בדיקות איכות, ולבסוף יוצרת מסמך Google Docs.

עקרון־על: **אין המצאות**. כל אמירה תפעולית בתסריט חייבת להיות מגובה בקטע מספר הנהג.
אין שימוש באינטרנט להשלמת מידע חסר.

## 2. סטאק
- Frontend: React 18 + Vite + Tailwind + shadcn/ui, עברית RTL.
- Backend: Base44 BaaS — entities (JSON schema), backend functions (Deno, `base44/functions/<name>/entry.ts`), shared modules ב-`base44/shared/`.
- LLM: Claude דרך Anthropic API (`base44/shared/llm.ts`), במקום `Core.InvokeLLM`. ברירת מחדל `claude-opus-5-5`, נשלט בסודות (ראו README). אין fallback למודל חלש — אם המפתח חסר או המודל לא זמין, היצירה חסומה.
- Google Docs/Drive: דרך connector `googledocs` (scopes: documents, drive.file, email), בצד השרת בלבד.

## 3. ישויות (base44/entities)
| ישות | תפקיד |
|---|---|
| `VehicleProject` | פרויקט דגם רכב: יצרן, דגם, שנה, שוק, רמת גימור, סטטוס, `current_step` |
| `SourceDocument` | מקור שהועלה: ספר נהג / מפרט / רשימת מערכות / טקסט מודבק; `extraction_status` |
| `ManualSection` | קטעי טקסט מפולחים מספר הנהג (page, heading, text, order_index) — בסיס הראיות |
| `SystemItem` | מערכת בודדת בדגם: שמות ואליאסים, קטגוריה, `availability_status`, `included`, `allow_partial_evidence` |
| `ScriptGroup` | קבוצת תסריט ממוקד (`focused`) או התסריט הכללי (`general`), עם `system_ids` |
| `GenerationJob` | ריצת יצירה: status, prompt_version, scripts, qa_results, validation_issues |
| `OutputDocument` | מסמך Google Docs שנוצר (doc_url, version_number) |
| `PromptVersion` | הפרומפט הנעול; רק גרסה אחת `is_active` |
| `GoogleSettings` | חיבור Google + תיקיית יעד |
| `AppUsers` | הרשאות אפליקציה: `SystemAdmin` / `ScriptCreator` |

RLS: כל ישות פרויקטלית — קריאה/עדכון לבעל הרשומה או ל-admin. `PromptVersion`/`GoogleSettings` — כתיבה ל-admin בלבד.

## 4. אשף 7 השלבים (src/components/wizard)
1. `Step1Details` — פרטי דגם (שנה, שוק, גימור חובה).
2. `Step2Uploads` — העלאת מקורות + פיצול PDF גדולים בצד הלקוח (`src/lib/pdfSplit.js`) → `parseSourceDocuments` (חילוץ טקסט, OCR fallback) → `indexManualContent` (יצירת `ManualSection`).
3. `Step3Systems` — `extractRelevantSystems`: מעבר על המפרט בצ'אנקים, זיהוי מערכות מול קטעי ספר הנהג, פיצול אטומי (`base44/shared/systems.ts`), חסימת כפילויות בדמיון ≥75%.
4. `Step4Checklist` — המשתמש מאשר/מסיר מערכות, מוסיף ידנית, ומסמן `allow_partial_evidence` (ויתור על דרישת הסבר תפעולי פרטני).
5. `Step5Groups` — `suggestScriptGroups`: חלוקה לקבוצות תסריטים ממוקדים + סדר.
6. `Step6Review` — `validateApprovedPlan` (עוטף את `base44/shared/plan.ts`): חוסמים/אזהרות, זמינות המודל, חיבור Google.
7. `Step7Generate` — יצירה בשלבים + בר התקדמות + יצירת המסמך.

## 5. צינור היצירה (base44/functions/generateVehicleScripts)
> עודכן: הצינור כולל כעת גם `action=evidence` (ניתוב ראיות סמנטי לפני כל כתיבה) ו-`action=repair` (סבב תיקון בבקשה נפרדת). פירוט בסעיף 10.

מפוצל לפעולות קצרות כדי לא לחרוג ממגבלת 120 שניות לבקשה. הלקוח קורא להן ברצף:
1. `action=start` — `validatePlan` → בדיקת זמינות המודל → פרומפט פעיל → יצירת `GenerationJob` → החזרת רשימת `tasks` (כללי + כל קבוצה ממוקדת).
2. `action=write` (פעם לכל task) — בניית חבילות ראיות (`buildEvidencePackets`), הרכבת הפרומפט הנעול + JSON נתוני הפרויקט, קריאה ל-LLM עם `SCRIPT_SCHEMA`, מיזוג התוצאה ל-`job.scripts`. ל-Step7 יש retry יחיד לכל task.
3. `action=qa` — `runDeterministicAudit` (`base44/shared/qa.ts`) + בדיקת תוכן ועברית עם ה-LLM. `passed` רק אם אין אף issue.

לאחר מכן `createGoogleDocsDocument` יוצר את המסמך (רק לג'וב `passed`).

## 6. מנגנון הראיות (base44/shared/evidence.ts) — הלב והנקודה הרגישה
- נרמול + canonicalization של עברית (הסרת ו/ה/ב/ל/מ/ש/כ בתחילית, ריבוי `ים/ות/יים`, איחוד `התרעת/התראת`).
- דירוג קטעים: התאמת ביטוי מלא בכותרת (120) > בטקסט (80) > מילות ליבה (18/6). מילות "רעש" (`מערכת`, `בקרת`, `system`...) לא נחשבות.
- קטעי אינדקס ("תוכן העניינים", "נוריות אזהרה") נפסלים ללא התאמת כותרת מדויקת.
- `hasOperationalText` — קטע נחשב "תפעולי" רק אם מכיל מילות פעולה (לחצו/בחרו/תפריט/press/select/menu...).
- `evidence_sufficient = יש קטעים + יש לפחות קטע תפעולי אחד`.
- תקציב: תסריט ממוקד 20,000 תווים למערכת; תסריט כללי ~40,000 מחולק בין המערכות (מינימום 1,500) — צמצום שנעשה כדי לא לחרוג בזמן.
- Cache: `WeakMap` על מערך הקטעים, כדי לא לנרמל את כל ספר הנהג מחדש לכל מערכת.

## 7. שינויים אחרונים
- הוספת `allow_partial_evidence` ל-`SystemItem` + UI ב-Step4 + דילוג על בדיקת הראיות ב-`plan.ts` + הנחיה מתאימה בפרומפט.
- הנחיה גלובלית ב-`write`: **אסור להחזיר narration ריק** — יש לכתוב את המאומת ולציין את החוסר ב-`validation_issues` במקום לסרב.
- בר התקדמות (`GenerationProgress`) ושחרור ידני של משימה תקועה ב-Step7.

## 8. הבעיה המרכזית שנותרה פתוחה
היצירה מסתיימת ב-`failed` גם כשכל התסריטים נכתבו, כי **כל `validation_issue` שהמודל מדווח מפיל את ה-QA**.
בפועל רוב ההערות אינן שגיאות אמת אלא "הסתייגויות" לגיטימיות (למשל: "ספר הנהג לא מפרט את שמות בקרי האקלים, לכן הושמטו הצעדים").
זו התנהגות מכוונת במקור (Zero-hallucination), אבל היא הופכת את המערכת לבלתי שמישה כשספר הנהג סרוק/חלקי.

כיוון תיקון מוצע לכלי חיצוני:
1. להפריד `validation_issues` לשתי רמות: `blocking` (סתירה/המצאה/מערכת לא מאושרת) לעומת `informational` (חוסר תיעוד שהמודל השמיט בהתאם) — ורק `blocking` יפיל את ה-QA.
2. להציג את ה-informational במסמך היעד כנספח "פערי תיעוד" במקום כשגיאה.
3. לשפר את `hasOperationalText` ואת דירוג הקטעים לספרים שבהם ההוראות מופיעות בטבלאות/כיתובי איורים (OCR) ולכן חסרות מילות פעולה.
4. לוודא ש-`can_disable` בישות לא מתנגש עם ספר הנהג (מקור נפוץ ל"סתירה" מדווחת).

## 9. קבצים מרכזיים
```
base44/shared/evidence.ts        בניית חבילות ראיות
base44/shared/plan.ts            אימות תוכנית ההפקה (חוסמים/אזהרות)
base44/shared/qa.ts              בדיקת דיוק דטרמיניסטית
base44/shared/systems.ts         פיצול שמות מערכות לאטומים
base44/shared/googleDocs.ts      הרכבת מסמך Google Docs
base44/functions/generateVehicleScripts/entry.ts   צינור start/write/qa
base44/functions/extractRelevantSystems/entry.ts   זיהוי מערכות
base44/functions/parseSourceDocuments/entry.ts     חילוץ טקסט/OCR
base44/functions/indexManualContent/entry.ts       פילוח לקטעים
src/components/wizard/Step1..Step7                 האשף
src/pages/{Projects,ProjectWizard,Admin}.jsx       דפים
``

## 10. מעבר ל-Claude (אוקטובר 2026)
- **שכבת מודל אחת** — `base44/shared/llm.ts`: `callClaude()` עם פלט מובנה (`output_config.format`), streaming, תקרת זמן לכל קריאה, `fallbacks: "default"` לסירובים, ו-prompt caching על ה-system. כל `InvokeLLM` הוסר.
- **חילוץ מסמכים** — PDF נקרא משכבת הטקסט עמוד-עמוד (`unpdf`), ללא מודל שמסכם. עמוד ריק, סרוק או בעברית הפוכה נשלח ל-Claude כ-PDF של 2 עמודים (OCR כולל טבלאות וכיתובי איורים). צילומי מסך נקראים ב-vision. DOCX/XLSX נשארו ב-`ExtractDataFromUploadedFile`.
- **ניתוב ראיות סמנטי** — `selectEvidenceWithClaude()` ב-`evidence.ts`: Claude קורא אינדקס קומפקטי של כל ספר הנהג ובוחר עד 10 מקטעים לכל מערכת. המקטעים האלה נכנסים ראשונים לחבילת הראיות, במלואם. פותר את בעיית המונחים השונים בין מפרט לספר (סעיף 8.3).
- **כתיבה** — הפרומפט הנעול + כללי הכתיבה נשלחים כ-system (נשמרים ב-cache בין התסריטים), הנתונים ב-`<project_data>`. ניסיון 1 במאמץ `medium`, ניסיונות 2–3 במאמץ `low` (מהיר יותר). שגיאה קבועה (מפתח שגוי) אינה מנוסה שוב.
- **QA** — `runQaPass` / `runRepairPass` ב-`scriptQa.ts`: כל סבב בבקשה נפרדת; הלקוח מריץ qa ← repair ← qa עד 2 סבבים.
- **זיהוי מערכות** — מקטעי מפרט גדולים יותר והקשר ספר נהג רחב יותר; `has_ops_instructions` של Claude עם עמודים נחשב לאימות, ו-`plan.ts` מוריד במקרה כזה חוסם לאזהרה.
