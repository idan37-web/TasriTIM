import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { buildEvidencePackets } from '../../shared/evidence.ts';

// בונה חבילות ראיות לכל מערכת כלולה ומחזיר סיכום זמינות ראיות.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id } = await req.json();
    if (!project_id) return Response.json({ error: 'חסר מזהה פרויקט' }, { status: 400 });

    const systems = await base44.entities.SystemItem.filter({ project_id, included: true }, 'name_he', 500);
    const packets = await buildEvidencePackets(base44, project_id, systems || []);

    const summary = packets.map((p) => ({
      system_id: p.system_id,
      system_name: p.system_name,
      excerpt_count: p.excerpt_count,
      matched_terms: p.matched_terms,
      required_component_terms: p.required_component_terms,
      unmatched_component_terms: p.unmatched_component_terms,
      operational_match_count: p.operational_match_count,
      evidence_sufficient: p.evidence_sufficient
    }));

    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}