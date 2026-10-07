import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { fetchAllSections } from '../../shared/evidence.ts';

// מוודא שקיים אינדקס מקטעים לפרויקט ומחזיר סיכום מצב האינדוקס לכל מסמך.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id } = await req.json();
    if (!project_id) return Response.json({ error: 'חסר מזהה פרויקט' }, { status: 400 });

    const docs = await base44.entities.SourceDocument.filter({ project_id });
    const sections = await fetchAllSections(base44, project_id);

    const summary = [];
    for (const doc of docs || []) {
      const docSections = sections.filter((s) => s.document_id === doc.id);
      const indexed = docSections.length > 0;
      if (doc.indexed !== indexed && doc.extraction_status === 'done') {
        await base44.entities.SourceDocument.update(doc.id, { indexed });
      }
      summary.push({
        document_id: doc.id,
        file_name: doc.file_name,
        doc_type: doc.doc_type,
        extraction_status: doc.extraction_status,
        section_count: docSections.length
      });
    }

    return Response.json({ ok: true, total_sections: sections.length, documents: summary });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}