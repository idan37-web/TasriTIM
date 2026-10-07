import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Upload, FileText, Trash2, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { splitLargePdf } from '@/lib/pdfSplit';
import UploadProgress from '@/components/wizard/UploadProgress';

const DOC_TYPES = [
  { key: 'driver_manual', label: 'ספר הנהג של הדגם', required: true },
  { key: 'spec', label: 'מפרט הדגם / רשימת מערכות', required: true },
  { key: 'extra_equipment', label: 'מפרט אבזור נוסף', required: false },
  { key: 'multimedia_manual', label: 'ספר מולטימדיה נפרד', required: false },
  { key: 'english_manual', label: 'ספר נהג מקורי באנגלית', required: false },
  { key: 'screenshots', label: 'צילומי מסך של מערכת המולטימדיה', required: false },
];

const STATUS = {
  pending: { label: 'ממתין', icon: Loader2, cls: 'text-stone-400' },
  processing: { label: 'מעבד...', icon: Loader2, cls: 'text-blue-500' },
  done: { label: 'עובד בהצלחה', icon: CheckCircle2, cls: 'text-emerald-600' },
  error: { label: 'שגיאה', icon: AlertCircle, cls: 'text-red-500' },
};

export default function Step2Uploads({ project, goToStep }) {
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [savingPaste, setSavingPaste] = useState(false);
  const inputRefs = useRef({});

  const refresh = () =>
    base44.entities.SourceDocument.filter({ project_id: project.id }, '-created_date', 100).then(setDocs);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // עיבוד מסמך אחד עם ניסיון חוזר אוטומטי (כשלים נקודתיים בחילוץ נפוצים)
  const parseDoc = async (docId) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await base44.entities.SourceDocument.update(docId, { extraction_status: 'processing', error_message: '' });
        // תקרת זמן — כשהעיבוד נתקע, לא משאירים את החלק במצב "מעבד" לנצח
        await Promise.race([
          base44.functions.invoke('parseSourceDocuments', { document_id: docId }),
          new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), 150000)),
        ]);
        refresh();
        return;
      } catch (e) {
        if (attempt === 2) {
          await base44.entities.SourceDocument.update(docId, {
            extraction_status: 'error',
            error_message: 'עיבוד החלק נעצר או נכשל — לחצו "נסו שוב" ליד החלק',
          });
        }
      }
    }
    refresh();
  };

  const handleFile = async (docType, file) => {
    if (!file) return;
    setUploading(docType);
    try {
      // קבצים גדולים מפוצלים אוטומטית לחלקים כדי לאפשר חילוץ טקסט מלא
      const files = await splitLargePdf(file);
      const created = [];
      for (const part of files) {
        // העלאה פרטית בלבד — ספרי הרכב לא הופכים לקבצים ציבוריים
        const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file: part });
        created.push(
          await base44.entities.SourceDocument.create({
            project_id: project.id,
            doc_type: docType,
            file_name: part.name,
            file_uri,
            extraction_status: 'processing',
          })
        );
        refresh();
      }

      // עיבוד החלקים במקביל (3 בכל פעם) — כל חלק סרוק מפעיל כמה קריאות OCR מקבילות בעצמו
      for (let i = 0; i < created.length; i += 3) {
        await Promise.all(created.slice(i, i + 3).map((d) => parseDoc(d.id)));
      }
    } finally {
      setUploading(null);
      refresh();
    }
  };

  const savePasted = async () => {
    if (!pasteText.trim()) return;
    setSavingPaste(true);
    try {
      const doc = await base44.entities.SourceDocument.create({
        project_id: project.id,
        doc_type: 'systems_list_text',
        file_name: 'רשימת מערכות שהודבקה',
        pasted_text: pasteText,
        extraction_status: 'processing',
      });
      await base44.functions.invoke('parseSourceDocuments', { document_id: doc.id });
      setPasteText('');
    } finally {
      setSavingPaste(false);
      refresh();
    }
  };

  const deleteDoc = async (doc) => {
    await base44.entities.SourceDocument.delete(doc.id);
    refresh();
  };

  const hasManual = docs.some((d) => d.doc_type === 'driver_manual' && d.extraction_status === 'done');
  const hasSpec = docs.some(
    (d) => ['spec', 'systems_list_text', 'extra_equipment'].includes(d.doc_type) && d.extraction_status === 'done'
  );

  return (
    <div className="max-w-3xl space-y-5">
      <UploadProgress docs={docs} />
      <div className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8">
        <h2 className="text-lg font-bold text-stone-900 mb-1">העלאת מקורות</h2>
        <p className="text-sm text-stone-500 mb-6">
          נתמכים PDF, DOCX, XLSX, CSV ו‑TXT, כולל PDF סרוק (OCR). כל המסמכים נשמרים כקבצים פרטיים.
        </p>
        <div className="space-y-3">
          {DOC_TYPES.map((dt) => {
            const typeDocs = docs.filter((d) => d.doc_type === dt.key);
            return (
              <div
                key={dt.key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFile(dt.key, e.dataTransfer.files?.[0]);
                }}
                className="border border-stone-200 rounded-xl p-4"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="font-medium text-stone-800 text-sm">
                    {dt.label} {dt.required && <span className="text-red-500">*</span>}
                  </div>
                  <div>
                    <input
                      ref={(el) => (inputRefs.current[dt.key] = el)}
                      type="file"
                      accept=".pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg"
                      className="hidden"
                      onChange={(e) => handleFile(dt.key, e.target.files?.[0])}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      disabled={uploading === dt.key}
                      onClick={() => inputRefs.current[dt.key]?.click()}
                    >
                      {uploading === dt.key ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Upload className="w-4 h-4 ml-1" /> העלאה או גרירה
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                {typeDocs.map((d) => {
                  const st = STATUS[d.extraction_status] || STATUS.pending;
                  const Icon = st.icon;
                  return (
                    <div key={d.id} className="flex items-center justify-between mt-3 bg-stone-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 text-sm text-stone-600 min-w-0">
                        <FileText className="w-4 h-4 text-stone-400 shrink-0" />
                        <span className="truncate">{d.file_name}</span>
                        {d.page_count ? <span className="text-xs text-stone-400">({d.page_count} עמ׳)</span> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`flex items-center gap-1 text-xs ${st.cls}`}>
                          <Icon className={`w-3.5 h-3.5 ${d.extraction_status === 'processing' ? 'animate-spin' : ''}`} />
                          {st.label}
                        </span>
                        {['error', 'processing'].includes(d.extraction_status) && (
                          <button
                            onClick={() => parseDoc(d.id)}
                            className="text-xs text-stone-500 underline hover:text-stone-800"
                          >
                            נסו שוב
                          </button>
                        )}
                        <button onClick={() => deleteDoc(d)} className="text-stone-300 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {typeDocs.some((d) => d.error_message) && (
                  <p className="text-xs text-red-500 mt-2">{typeDocs.find((d) => d.error_message)?.error_message}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8">
        <h3 className="font-bold text-stone-900 mb-2 text-sm">הדבקת רשימת מערכות ידנית</h3>
        <Textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="הדביקו כאן רשימת מערכות של הדגם..."
          className="rounded-xl min-h-[100px]"
        />
        <Button
          onClick={savePasted}
          disabled={!pasteText.trim() || savingPaste}
          variant="outline"
          size="sm"
          className="rounded-lg mt-3"
        >
          {savingPaste ? <Loader2 className="w-4 h-4 animate-spin" /> : 'שמירת הרשימה'}
        </Button>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => goToStep(3)}
          disabled={!hasManual || !hasSpec}
          className="rounded-xl bg-stone-900 hover:bg-stone-700"
        >
          המשך לזיהוי מערכות <ArrowLeft className="w-4 h-4 mr-1" />
        </Button>
      </div>
      {(!hasManual || !hasSpec) && (
        <p className="text-xs text-stone-400 text-left">
          נדרשים ספר נהג ומפרט/רשימת מערכות מעובדים כדי להמשיך.
        </p>
      )}
    </div>
  );
}