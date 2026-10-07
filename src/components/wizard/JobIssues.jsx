import { XCircle, Info, MessageSquare } from 'lucide-react';

// שלושה אזורים נפרדים: חוסמים (אדום), פערי תיעוד (צהוב), הערות סגנון (אפור).
// הערת סגנון אינה פער תיעוד ואינה מוגדלת את מונה פערי התיעוד.
export default function JobIssues({ blocking = [], gaps = [], styleNotes = [], className = '' }) {
  const uniq = (list) => [...new Set((list || []).filter(Boolean))];
  const blockingList = uniq(blocking);
  const gapList = uniq(gaps);
  const noteList = uniq(styleNotes);
  if (blockingList.length === 0 && gapList.length === 0 && noteList.length === 0) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      {blockingList.length > 0 && (
        <div className="text-sm text-red-600 bg-red-50 rounded-xl p-4">
          <div className="flex items-center gap-2 font-medium mb-1">
            <XCircle className="w-4 h-4" /> שגיאות שחוסמות יצירה ({blockingList.length})
          </div>
          <ul className="pr-5 list-disc space-y-0.5">
            {blockingList.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
      {gapList.length > 0 && (
        <div className="text-sm text-amber-800 bg-amber-50 rounded-xl p-4">
          <div className="flex items-center gap-2 font-medium mb-1">
            <Info className="w-4 h-4" /> פערי תיעוד / מידע שהושמט ({gapList.length})
          </div>
          <p className="text-xs text-amber-700 mb-2">
            פרטים שלא נמצאו במקורות ולכן לא נכתבו בקריינות. אינם חוסמים יצירת מסמך.
          </p>
          <ul className="pr-5 list-disc space-y-0.5">
            {gapList.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
      {noteList.length > 0 && (
        <div className="text-sm text-stone-600 bg-stone-100 rounded-xl p-4">
          <div className="flex items-center gap-2 font-medium mb-1">
            <MessageSquare className="w-4 h-4" /> הערות סגנון לא חוסמות ({noteList.length})
          </div>
          <ul className="pr-5 list-disc space-y-0.5">
            {noteList.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}