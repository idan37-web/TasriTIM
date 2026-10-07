import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validatePlan } from '../../shared/plan.ts';

// בדיקת תוכנית ההפקה לפני יצירה — מחזיר חוסמים ואזהרות.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id } = await req.json();
    if (!project_id) return Response.json({ error: 'חסר מזהה פרויקט' }, { status: 400 });

    const result = await validatePlan(base44, project_id);

    return Response.json({
      ok: result.blockers.length === 0,
      blockers: result.blockers,
      warnings: result.warnings,
      needs_review_count: result.needsReview || 0,
      google_connected: !!(result.google && result.google.connected),
      google_account: result.google ? result.google.account_email : null,
      google_folder: result.google ? result.google.folder_name : null
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}