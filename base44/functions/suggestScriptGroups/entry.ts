import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { callClaude } from '../../shared/llm.ts';

// מציע מפת תסריטים (איחודים וסדר) באמצעות Claude.
// אינו נוגע בקבוצות שהמשתמש ערך (user_modified) ואינו נוגע בסרטון הכללי.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id } = await req.json();
    if (!project_id) return Response.json({ error: 'חסר מזהה פרויקט' }, { status: 400 });

    const project = await base44.entities.VehicleProject.get(project_id);
    if (!project) return Response.json({ error: 'הפרויקט לא נמצא' }, { status: 404 });

    const systems = await base44.entities.SystemItem.filter({ project_id, included: true }, 'name_he', 500);
    if (!systems || systems.length === 0) {
      return Response.json({ error: 'לא נבחרו מערכות להכללה' }, { status: 422 });
    }

    const existing = await base44.entities.ScriptGroup.filter({ project_id }, 'order_index', 200);

    // ודא קיום תסריט הסרטון הכללי — יחידה נעולה, ראשונה תמיד
    let general = (existing || []).find((g) => g.script_type === 'general');
    if (!general) {
      general = await base44.entities.ScriptGroup.create({
        project_id,
        title: 'סרטון היכרות כללי',
        system_ids: [],
        order_index: 0,
        script_type: 'general',
        user_modified: false
      });
    }

    // מערכות שכבר משויכות לקבוצות שהמשתמש ערך — לא נוגעים בהן
    const userGroups = (existing || []).filter((g) => g.script_type === 'focused' && g.user_modified && !g.cancelled);
    const lockedIds = new Set(userGroups.flatMap((g) => g.system_ids || []));
    const freeSystems = systems.filter((s) => !lockedIds.has(s.id));

    // מחיקת הצעות אוטומטיות קודמות — ניסיון חוזר בלי כפילויות
    const autoGroups = (existing || []).filter((g) => g.script_type === 'focused' && !g.user_modified);
    for (const g of autoGroups) {
      await base44.entities.ScriptGroup.delete(g.id);
    }

    let suggestions = { groups: [] };
    if (freeSystems.length > 0) {
      const sysList = freeSystems.map((s) => ({
        id: s.id,
        name: s.name_he,
        commercial: s.name_commercial,
        category: s.category,
        why: s.why_training
      }));
      const res = await callClaude({
        effort: 'medium',
        deadlineMs: 100000,
        prompt: `אתה מתכנן מפת תסריטי הדרכה לרכב. לפניך רשימת מערכות שאושרו להכללה.
הצע חלוקה לתסריטים: אחד מערכות באותו תסריט כאשר הן שייכות לאותו מסלול שימוש, מופעלות מאותו מסך או אזור שליטה, משלימות זו את זו, כל אחת לבדה קצרה מדי, צפויה חזרה על אותן הוראות, או שהצגתן יחד ברורה יותר ללקוח.
דוגמאות לאיחוד רצוי: Apple CarPlay עם Android Auto; קיפול מושבי שורה שנייה ושלישית יחד; פתיחה ללא מפתח + נעילה + תא מטען + התנעה; חימום/אוורור/עיסוי מושבים.
השאר מערכות בנפרד כאשר: פעולותיהן שונות מהותית, האיחוד מקשה על הבנת בטיחות, הן מופעלות מאזורים שונים לחלוטין, או שהתסריט המאוחד יהיה מסורבל.
כל מערכת חייבת להופיע בדיוק בקבוצה אחת. תן לכל קבוצה שם תסריט בעברית וסיבת איחוד קצרה כשיש יותר ממערכת אחת, וקבע סדר הגיוני.
merge_reason השאר ריק כשהקבוצה כוללת מערכת אחת בלבד.

<systems>
${JSON.stringify(sysList)}
</systems>`,
        schema: {
          type: 'object',
          properties: {
            groups: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  system_ids: { type: 'array', items: { type: 'string' } },
                  merge_reason: { type: 'string' }
                },
                required: ['title', 'system_ids']
              }
            }
          },
          required: ['groups']
        }
      });
      suggestions = res.data;
    }

    // אימות: כל מערכת חופשית מופיעה פעם אחת בדיוק
    const validIds = new Set(freeSystems.map((s) => s.id));
    const seen = new Set();
    const cleanGroups = [];
    for (const g of suggestions.groups || []) {
      const ids = (g.system_ids || []).filter((id) => validIds.has(id) && !seen.has(id));
      ids.forEach((id) => seen.add(id));
      if (ids.length > 0) cleanGroups.push({ title: g.title, system_ids: ids, merge_reason: g.merge_reason || '' });
    }
    for (const s of freeSystems) {
      if (!seen.has(s.id)) cleanGroups.push({ title: s.name_he, system_ids: [s.id], merge_reason: '' });
    }

    let order = Math.max(0, ...userGroups.map((g) => g.order_index || 0)) + 1;
    const records = cleanGroups.map((g) => ({
      project_id,
      title: g.title,
      system_ids: g.system_ids,
      order_index: order++,
      script_type: 'focused',
      user_modified: false,
      merge_reason: g.merge_reason
    }));
    if (records.length > 0) {
      await base44.entities.ScriptGroup.bulkCreate(records);
    }

    return Response.json({ ok: true, created: records.length, kept_user_groups: userGroups.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}