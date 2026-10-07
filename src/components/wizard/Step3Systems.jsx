import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2, ArrowLeft } from 'lucide-react';

export const AVAILABILITY = {
  verified: { label: 'מאומתת', cls: 'bg-emerald-50 text-emerald-700' },
  not_in_spec: { label: 'לא אושרה לדגם', cls: 'bg-amber-50 text-amber-700' },
  missing_ops: { label: 'חסר מקור תפעולי', cls: 'bg-red-50 text-red-700' },
  manual: { label: 'נוספה ידנית', cls: 'bg-blue-50 text-blue-700' },
};

const CONFIDENCE = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };

export default function Step3Systems({ project, goToStep }) {
  const [systems, setSystems] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);

  const refresh = () =>
    base44.entities.SystemItem.filter({ project_id: project.id }, 'category', 500).then(setSystems);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const runExtraction = async () => {
    setRunning(true);
    setError('');
    setProgress(null);
    try {
      let index = 0;
      // הניתוח מחולק למקטעים כדי לא לחרוג ממגבלת זמן הבקשה
      while (index !== null) {
        // ניסיון חוזר אחד למקטע — חריגת זמן נקודתית לא עוצרת את כל הניתוח
        let res = null;
        let lastErr = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            res = await base44.functions.invoke('extractRelevantSystems', {
              project_id: project.id,
              chunk_index: index,
            });
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (lastErr) throw lastErr;
        if (res.data?.error) {
          setError(res.data.error);
          break;
        }
        setProgress({ current: res.data.chunk_index + 1, total: res.data.total_chunks });
        await refresh();
        index = res.data.next_index;
      }
    } catch (e) {
      setError(
        e.response?.data?.error ||
          'הניתוח של אחד המקטעים חרג ממגבלת הזמן. לחצו "זיהוי מחדש" — התהליך ימשיך מהמקטעים שנותרו.'
      );
    } finally {
      setRunning(false);
      setProgress(null);
      refresh();
    }
  };

  return (
    <div className="space-y-5">
      <div className="surface p-6 md:p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-stone-900 mb-1">זיהוי מערכות רלוונטיות</h2>
            <p className="text-sm text-stone-500 max-w-xl">
              המודל מנתח את המפרט מול ספר הנהג, על בסיס המסמכים שהועלו בלבד: ללא ידע חיצוני וללא הגבלת מספר מערכות.
            </p>
          </div>
          <Button onClick={runExtraction} disabled={running} className="rounded-xl bg-stone-900 hover:bg-stone-700">
            {running ? (
              <>
                <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                {progress ? `מנתח מקטע ${progress.current} מתוך ${progress.total}...` : 'מנתח את המסמכים...'}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 ml-1" /> {systems?.length ? 'זיהוי מחדש' : 'זיהוי מערכות'}
              </>
            )}
          </Button>
        </div>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </div>

      {systems && systems.length > 0 && (
        <div className="surface overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 text-sm font-semibold text-stone-700">
            נמצאו {systems.length} מערכות מועמדות
          </div>
          <div className="divide-y divide-stone-100">
            {systems.map((s) => {
              const av = AVAILABILITY[s.availability_status] || AVAILABILITY.verified;
              return (
                <div key={s.id} className="px-6 py-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-stone-900">{s.name_he}</span>
                      {s.name_commercial && <span className="text-sm text-stone-400" dir="ltr">{s.name_commercial}</span>}
                      <Badge variant="outline" className="text-[11px] rounded-md">{s.category}</Badge>
                      <Badge className={`${av.cls} border-0 text-[11px]`}>{av.label}</Badge>
                    </div>
                    <span className="text-xs text-stone-400">ודאות: {CONFIDENCE[s.confidence] || s.confidence}</span>
                  </div>
                  <div className="text-sm text-stone-500 mt-1.5">{s.why_training}</div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-stone-400 mt-2">
                    <span>ניתנת לכיבוי: {s.can_disable ? 'כן' : 'לא'}</span>
                    <span>הוראות תפעול: {s.has_ops_instructions ? 'נמצאו' : 'לא נמצאו'}</span>
                    {s.source_note && <span>מקור: {s.source_note}</span>}
                    {s.source_pages?.length > 0 && <span>עמודים: {s.source_pages.join(', ')}</span>}
                  </div>
                  {s.mismatch_note && <p className="text-xs text-amber-600 mt-1.5">⚠ {s.mismatch_note}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => goToStep(4)}
          disabled={!systems || systems.length === 0}
          className="rounded-xl bg-stone-900 hover:bg-stone-700"
        >
          המשך לבחירת מערכות <ArrowLeft className="w-4 h-4 mr-1" />
        </Button>
      </div>
    </div>
  );
}