import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { ensureAppFolder, createScriptsDocument } from '../../shared/googleDocs.ts';

// יוצר מסמך Google Docs מסודר ממשימת יצירה שעברה את כל הבדיקות.
// כל פעולות Google מתבצעות כאן בצד השרת בלבד — אין חשיפת OAuth token לדפדפן.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { job_id } = await req.json();
    if (!job_id) return Response.json({ error: 'חסר מזהה משימה' }, { status: 400 });

    const job = await base44.entities.GenerationJob.get(job_id);
    if (!job) return Response.json({ error: 'המשימה לא נמצאה' }, { status: 404 });

    // אסור לפרסם מסמך לפני שכל בדיקות הדיוק הסתיימו בהצלחה
    if (job.status !== 'passed' && job.status !== 'doc_created') {
      return Response.json({ error: 'לא ניתן ליצור מסמך — בדיקות האיכות לא עברו בהצלחה' }, { status: 422 });
    }

    // אידמפוטנטיות: מסמך אחד לכל משימה — retry או לחיצה כפולה לא ייצרו מסמך נוסף
    const existingDocs = await base44.entities.OutputDocument.filter({ job_id: job.id }, '-created_date', 1);
    if (existingDocs && existingDocs[0]) {
      const existing = existingDocs[0];
      if (job.status !== 'doc_created') {
        await base44.entities.GenerationJob.update(job.id, { status: 'doc_created' });
      }
      return Response.json({
        doc_url: existing.doc_url,
        google_doc_id: existing.google_doc_id,
        version_number: existing.version_number,
        folder_name: existing.folder_name,
        already_existed: true
      });
    }

    let accessToken;
    try {
      const conn = await base44.asServiceRole.connectors.getConnection('googledocs');
      accessToken = conn.accessToken;
    } catch (_e) {
      return Response.json({ error: 'חשבון Google אינו מחובר', google_connected: false }, { status: 422 });
    }

    const settingsList = await base44.asServiceRole.entities.GoogleSettings.list('-created_date', 1);
    const settings = settingsList && settingsList[0] ? settingsList[0] : null;

    const folder = await ensureAppFolder(accessToken, settings ? settings.folder_id : null);

    const project = await base44.entities.VehicleProject.get(job.project_id);
    const groups = await base44.entities.ScriptGroup.filter({ project_id: job.project_id }, 'order_index', 200);
    const previous = await base44.entities.OutputDocument.filter({ project_id: job.project_id }, '-version_number', 100);
    const versionNumber = Math.max(0, ...(previous || []).map((d) => d.version_number || 0)) + 1;

    const created = await createScriptsDocument(accessToken, {
      project,
      job,
      groups: groups || [],
      folderId: folder.id,
      versionNumber,
    });

    await base44.entities.OutputDocument.create({
      project_id: job.project_id,
      job_id: job.id,
      google_doc_id: created.documentId,
      doc_url: created.url,
      folder_id: folder.id,
      folder_name: folder.name,
      version_number: versionNumber,
      title: created.title,
    });

    await base44.entities.GenerationJob.update(job.id, { status: 'doc_created' });
    await base44.entities.VehicleProject.update(job.project_id, { status: 'published' });

    if (settings) {
      await base44.asServiceRole.entities.GoogleSettings.update(settings.id, {
        connected: true,
        folder_id: folder.id,
        folder_name: folder.name,
      });
    } else {
      await base44.asServiceRole.entities.GoogleSettings.create({
        connected: true,
        folder_id: folder.id,
        folder_name: folder.name,
      });
    }

    return Response.json({ doc_url: created.url, google_doc_id: created.documentId, version_number: versionNumber, folder_name: folder.name });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}