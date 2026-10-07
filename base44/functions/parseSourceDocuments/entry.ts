import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// מחלץ טקסט ממסמך מקור (כולל OCR ל-PDF סרוק) ושומר מקטעים עם עמודים וכותרות.
// ניתן לניסיון חוזר: מוחק מקטעים קודמים של אותו מסמך לפני שמירה.
export default async function(req) {
  let docId = null;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { document_id } = await req.json();
    if (!document_id) return Response.json({ error: 'חסר מזהה מסמך' }, { status: 400 });
    docId = document_id;

    const doc = await base44.entities.SourceDocument.get(document_id);
    if (!doc) return Response.json({ error: 'המסמך לא נמצא' }, { status: 404 });

    await base44.entities.SourceDocument.update(document_id, { extraction_status: 'processing', error_message: '' });

    let sections = [];
    if (doc.pasted_text) {
      sections = [{ page: null, heading: doc.file_name || 'רשימת מערכות שהודבקה', text: doc.pasted_text }];
    } else if (doc.file_uri) {
      // קישור חתום וזמני בלבד — הקבצים נשארים פרטיים
      const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
        file_uri: doc.file_uri,
        expires_in: 900
      });
      // קבצי טקסט פשוט נקראים ישירות — חילוץ מסמכים אינו תומך בהם
      const ext = String(doc.file_name || '').split('.').pop().toLowerCase();
      if (['txt', 'md', 'text'].includes(ext)) {
        const fileRes = await fetch(signed_url);
        if (!fileRes.ok) {
          await base44.entities.SourceDocument.update(document_id, {
            extraction_status: 'error',
            error_message: 'לא ניתן לקרוא את הקובץ'
          });
          return Response.json({ error: 'לא ניתן לקרוא את הקובץ' }, { status: 422 });
        }
        const raw = await fileRes.text();
        if (!raw.trim()) {
          await base44.entities.SourceDocument.update(document_id, {
            extraction_status: 'error',
            error_message: 'הקובץ ריק'
          });
          return Response.json({ error: 'הקובץ ריק' }, { status: 422 });
        }
        sections = [{ page: null, heading: doc.file_name || 'רשימת מערכות', text: raw }];
      } else {
      const res = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
        file_url: signed_url,
        json_schema: {
          type: 'object',
          properties: {
            language: { type: 'string' },
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  page: { type: ['number', 'null'] },
                  heading: { type: 'string' },
                  text: { type: 'string' }
                }
              }
            }
          }
        }
      });
      if (res.status !== 'success') {
        await base44.entities.SourceDocument.update(document_id, {
          extraction_status: 'error',
          error_message: res.details || 'שגיאה בחילוץ הטקסט'
        });
        return Response.json({ error: res.details || 'שגיאה בחילוץ הטקסט' }, { status: 422 });
      }
      const out = res.output;
      if (Array.isArray(out)) {
        sections = out;
      } else if (out && Array.isArray(out.sections)) {
        sections = out.sections;
        if (out.language) doc.language = out.language;
      }

      // חילוץ חלופי — כשחילוץ המסמך מחזיר תוצאה ריקה (למשל PDF סרוק/גדול)
      if (!sections.some((s) => String(s?.text || '').trim())) {
        const llm = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: 'העתק את כל הטקסט מהמסמך המצורף, מחולק למקטעים לפי כותרות ועמודים. אין להוסיף מידע שאינו במסמך, אין לסכם — העתקה מלאה בלבד.',
          file_urls: [signed_url],
          response_json_schema: {
            type: 'object',
            properties: {
              language: { type: 'string' },
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    page: { type: ['number', 'null'] },
                    heading: { type: 'string' },
                    text: { type: 'string' }
                  }
                }
              }
            }
          }
        });
        if (llm && Array.isArray(llm.sections)) {
          sections = llm.sections;
          if (llm.language) doc.language = llm.language;
        }
      }
      }
    } else {
      return Response.json({ error: 'למסמך אין קובץ או טקסט' }, { status: 400 });
    }

    // מחיקת מקטעים קודמים — מניעת כפילויות בניסיון חוזר
    await base44.entities.ManualSection.deleteMany({ document_id });

    // פיצול טקסטים ארוכים למקטעים
    const records = [];
    let orderIndex = 0;
    for (const s of sections) {
      const text = String(s.text || '');
      if (!text.trim()) continue;
      for (let i = 0; i < text.length; i += 3500) {
        records.push({
          project_id: doc.project_id,
          document_id,
          file_name: doc.file_name || '',
          page: typeof s.page === 'number' ? s.page : null,
          heading: s.heading || '',
          text: text.slice(i, i + 3500),
          order_index: orderIndex++
        });
      }
    }
    const totalChars = records.reduce((a, r) => a + r.text.length, 0);
    if (records.length === 0 || (doc.file_uri && totalChars < 1000)) {
      await base44.entities.SourceDocument.update(document_id, {
        extraction_status: 'error',
        error_message:
          'לא הצלחנו לחלץ טקסט מהקובץ — ייתכן שהקובץ גדול מדי (המערכת תומכת בקבצים עד כ‑10 מגה־בייט) או סרוק כתמונה. פצלו את ספר הנהג לכמה קבצי PDF קטנים והעלו אותם בנפרד.'
      });
      return Response.json({ error: 'לא חולץ טקסט מהקובץ' }, { status: 422 });
    }
    for (let i = 0; i < records.length; i += 100) {
      await base44.entities.ManualSection.bulkCreate(records.slice(i, i + 100));
    }

    const pages = records.map((r) => r.page).filter((p) => p != null);
    await base44.entities.SourceDocument.update(document_id, {
      extraction_status: 'done',
      indexed: true,
      page_count: pages.length ? Math.max(...pages) : null,
      language: doc.language || null
    });

    return Response.json({ ok: true, section_count: records.length });
  } catch (error) {
    // לא להשאיר מסמך תקוע במצב "מעבד"
    try {
      if (docId) {
        const base44b = createClientFromRequest(req);
        await base44b.entities.SourceDocument.update(docId, {
          extraction_status: 'error',
          error_message: error.message
        });
      }
    } catch (_e) { /* ignore */ }
    return Response.json({ error: error.message }, { status: 500 });
  }
}