import { SPEC_DOC_TYPES } from "./constants.ts";
import { buildEvidencePackets } from "./evidence.ts";

// בדיקת תוכנית ההפקה — מחזירה חוסמים ואזהרות. משמשת גם את מסך הבדיקה וגם את היצירה עצמה.
export async function validatePlan(base44, projectId) {
  const blockers = [];
  const warnings = [];

  const project = await base44.entities.VehicleProject.get(projectId);
  if (!project) {
    return { blockers: ["הפרויקט לא נמצא"], warnings, project: null };
  }
  if (!project.model_year || !project.market || !project.trim_level) {
    blockers.push("חסרים שדות חובה בפרטי הדגם: שנת דגם, שוק יעד או רמת גימור");
  }

  const docs = await base44.entities.SourceDocument.filter({ project_id: projectId });
  const manual = (docs || []).find(
    (d) => d.doc_type === "driver_manual" && d.extraction_status === "done"
  );
  if (!manual) blockers.push("חסר ספר נהג מעובד");
  const spec = (docs || []).find(
    (d) => SPEC_DOC_TYPES.includes(d.doc_type) && d.extraction_status === "done"
  );
  if (!spec) blockers.push("חסרה רשימת מערכות או אסמכתת אבזור מעובדת");

  const systems = await base44.entities.SystemItem.filter({ project_id: projectId }, "name_he", 500);
  const included = (systems || []).filter((s) => s.included);
  if (included.length === 0) blockers.push("לא נבחרה אף מערכת להכללה בתסריטים");
  for (const s of included) {
    // המשתמש אישר במפורש לכתוב על המערכת גם ללא הסבר תפעולי פרטני
    if (s.allow_partial_evidence) {
      warnings.push(`המערכת "${s.name_he}" נכתבת ללא הסבר תפעולי פרטני, לפי אישור המשתמש`);
      continue;
    }
    if (s.availability_status === "missing_ops") {
      blockers.push(`למערכת "${s.name_he}" חסר מקור תפעולי — יש להעלות מקור נוסף או להסירה`);
    }
    if (s.availability_status === "not_in_spec") {
      blockers.push(`המערכת "${s.name_he}" מופיעה בספר אך לא אושרה לדגם — יש להכריע לפני יצירה`);
    }
  }

  const evidenceCandidates = included.filter((s) =>
    !s.allow_partial_evidence &&
    s.availability_status !== "missing_ops" && s.availability_status !== "not_in_spec"
  );
  const evidencePackets = manual && evidenceCandidates.length > 0
    ? await buildEvidencePackets(base44, projectId, evidenceCandidates)
    : [];
  for (const packet of evidencePackets.filter((p) => !p.evidence_sufficient)) {
    const missing = packet.unmatched_component_terms || [];
    // Claude זיהה הוראות תפעול בעמודים מסוימים, גם אם המונחים בספר שונים — ניתוב הראיות הסמנטי יאתר אותם בכתיבה
    const system = included.find((s) => s.id === packet.system_id);
    if (system && system.has_ops_instructions && (system.source_pages || []).length > 0) {
      warnings.push(`למערכת "${packet.system_name}" לא נמצאה התאמת מונחים בספר הנהג; המקור יאותר בניתוב הסמנטי בעמודים ${system.source_pages.join(', ')}`);
      continue;
    }
    blockers.push(missing.length > 0
      ? `למערכת "${packet.system_name}" חסר מקור תפעולי עבור: ${missing.join(', ')}`
      : `למערכת "${packet.system_name}" לא נמצא מקור תפעולי ייעודי בספר הנהג`);
  }

  const groups = await base44.entities.ScriptGroup.filter({ project_id: projectId }, "order_index", 200);
  const includedIds = new Set(included.map((s) => s.id));
  for (const group of (groups || []).filter((g) => g.script_type === "focused" && !g.cancelled)) {
    if (!(group.system_ids || []).some((id) => includedIds.has(id))) {
      blockers.push(`לקבוצת התסריט "${group.title}" אין מערכת מאושרת עם מקור תפעולי`);
    }
  }

  // חיבור Google ותיקיית יעד
  const settingsList = await base44.entities.GoogleSettings.list("-created_date", 1);
  const google = settingsList && settingsList[0] ? settingsList[0] : null;
  if (!google || !google.connected) blockers.push("חשבון Google אינו מחובר");

  const needsReview = (systems || []).filter((s) => s.mismatch_note && s.included).length;
  if (needsReview > 0) warnings.push(`${needsReview} מערכות כלולות עם הערת אי־התאמה`);

  return { blockers, warnings, project, docs: docs || [], systems: systems || [], groups: groups || [], google, needsReview };
}