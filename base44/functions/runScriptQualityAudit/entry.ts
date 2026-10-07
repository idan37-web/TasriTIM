import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { runFullScriptQa } from '../../shared/scriptQa.ts';

// מריץ מחדש את ה-QA המלא (דטרמיניסטי + Language/Content) על משימה קיימת.
// אותו helper משותף שמריץ את ה-QA בצינור היצירה — אין הגדרה שנייה ל-"passed",
// ולכן לא ניתן לסמן משימה כ-passed על סמך הבדיקה הדטרמיניסטית בלבד.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { job_id } = body;
    if (!job_id) return Response.json({ error: 'חסר מזהה משימה' }, { status: 400 });

    // ביקורת חוזרת אינה מתקנת כברירת מחדל; ניתן לבקש תיקון במפורש
    const maxRepairRounds = body.repair === true ? undefined : 0;
    const result = await runFullScriptQa(base44, job_id, { maxRepairRounds });
    if (result.error) return Response.json({ error: result.error }, { status: result.status || 422 });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}