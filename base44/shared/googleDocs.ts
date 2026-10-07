// בניית מסמך Google Docs מסודר מתסריטי ההדרכה + עבודה מול Drive.
// כל הפעולות מתבצעות בצד השרת בלבד.

const DOCS_API = "https://docs.googleapis.com/v1/documents";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
export const APP_FOLDER_NAME = "תסריטי הדרכה לרכב";

async function googleFetch(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `שגיאת Google (${res.status})`);
  }
  return data;
}

// יוצר (או מאתר) את תיקיית היעד של האפליקציה ב‑Drive.
export async function ensureAppFolder(accessToken, existingFolderId) {
  if (existingFolderId) {
    try {
      const f = await googleFetch(`${DRIVE_API}/${existingFolderId}?fields=id,name,trashed`, accessToken);
      if (!f.trashed) return { id: f.id, name: f.name };
    } catch (_e) {
      // התיקייה אינה נגישה יותר — ניצור חדשה
    }
  }
  const created = await googleFetch(`${DRIVE_API}?fields=id,name`, accessToken, {
    method: "POST",
    body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  return { id: created.id, name: created.name };
}

// בונה רשימת בלוקים (טקסט + סוג פסקה) מהתסריטים שנוצרו.
function buildBlocks(project, job, groups) {
  const vehicle = [project.manufacturer, project.model, project.model_year].filter(Boolean).join(" ");
  const meta = [
    project.trim_level ? `רמת גימור: ${project.trim_level}` : null,
    project.market ? `שוק יעד: ${project.market}` : null,
    project.drivetrain ? `הנעה: ${project.drivetrain}` : null,
    project.seats ? `מושבים: ${project.seats}` : null,
  ].filter(Boolean).join(" · ");

  const blocks = [
    { text: `תסריטי הדרכה — ${vehicle}`, style: "TITLE" },
  ];
  if (meta) blocks.push({ text: meta, style: "SUBTITLE" });
  blocks.push({
    text: `נוצר בתאריך ${new Date().toLocaleDateString("he-IL")} · מודל: ${job.required_model || job.actual_model} · גרסת פרומפט: ${job.prompt_version}`,
    style: "NORMAL_TEXT",
  });

  const scripts = job.scripts || {};
  const all = [];
  if (scripts.general_script) all.push(scripts.general_script);
  for (const s of scripts.focused_scripts || []) all.push(s);

  // תוכן עניינים קריא
  blocks.push({ text: "תוכן המסמך", style: "HEADING_1" });
  all.forEach((s, i) => {
    blocks.push({ text: `${i + 1}. ${s.title}`, style: "NORMAL_TEXT" });
  });

  all.forEach((s, i) => {
    const group = (groups || []).find((g) => g.id === s.group_id);
    blocks.push({ text: `${i + 1}. ${s.title}`, style: "HEADING_1" });
    const info = [
      `אורך משוער: כ‑${s.estimated_duration_minutes} דקות`,
      `${s.word_count} מילים`,
      group && (group.system_ids || []).length > 1 ? "תסריט מאוחד" : null,
    ].filter(Boolean).join(" · ");
    blocks.push({ text: info, style: "NORMAL_TEXT" });

    blocks.push({ text: "טקסט קריינות", style: "HEADING_2" });
    for (const para of String(s.narration || "").split(/\n+/).filter((p) => p.trim())) {
      blocks.push({ text: para.trim(), style: "NORMAL_TEXT" });
    }

    if ((s.source_references || []).length > 0) {
      blocks.push({ text: "מקורות לאימות – לא לקריינות", style: "HEADING_2" });
      for (const ref of s.source_references) {
        blocks.push({ text: `• ${ref}`, style: "NORMAL_TEXT" });
      }
    }
  });

  // נספח פערי תיעוד — מידע שהושמט במכוון מהקריינות, לשקיפות בלבד
  const gaps = job.documentation_gaps || [];
  if (gaps.length > 0) {
    blocks.push({ text: "פערי תיעוד – לא לקריינות", style: "HEADING_1" });
    blocks.push({
      text: "הפרטים הבאים לא נמצאו במקורות שסופקו ולכן הושמטו מטקסט הקריינות. אין לקרוא אותם בסרטון.",
      style: "NORMAL_TEXT",
    });
    for (const gap of gaps) {
      blocks.push({ text: `• ${gap}`, style: "NORMAL_TEXT" });
    }
  }

  return blocks;
}

// יוצר מסמך Google Docs מסודר ומחזיר { documentId, url, title }
export async function createScriptsDocument(accessToken, { project, job, groups, folderId, versionNumber }) {
  const vehicle = [project.manufacturer, project.model, project.model_year].filter(Boolean).join(" ");
  const title = `תסריטי הדרכה — ${vehicle} — גרסה ${versionNumber}`;

  const doc = await googleFetch(DOCS_API, accessToken, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  const documentId = doc.documentId;

  const blocks = buildBlocks(project, job, groups);
  const fullText = blocks.map((b) => b.text).join("\n") + "\n";

  const requests = [{ insertText: { location: { index: 1 }, text: fullText } }];
  let index = 1;
  for (const b of blocks) {
    const start = index;
    const end = index + b.text.length + 1;
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: start, endIndex: end },
        paragraphStyle: {
          namedStyleType: b.style,
          direction: "RIGHT_TO_LEFT",
          alignment: "END",
        },
        fields: "namedStyleType,direction,alignment",
      },
    });
    index = end;
  }

  await googleFetch(`${DOCS_API}/${documentId}:batchUpdate`, accessToken, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });

  if (folderId) {
    await googleFetch(
      `${DRIVE_API}/${documentId}?addParents=${folderId}&fields=id,parents`,
      accessToken,
      { method: "PATCH", body: JSON.stringify({}) }
    );
  }

  return { documentId, url: `https://docs.google.com/document/d/${documentId}/edit`, title };
}