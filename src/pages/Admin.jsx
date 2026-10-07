import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, CheckCircle2, XCircle, Plus, Eye } from 'lucide-react';

export default function Admin() {
  const { isAdmin } = useOutletContext();
  const [prompts, setPrompts] = useState([]);
  const [google, setGoogle] = useState(null);
  const [model, setModel] = useState(null);
  const [users, setUsers] = useState([]);
  const [newPrompt, setNewPrompt] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [viewPrompt, setViewPrompt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('ScriptCreator');
  const [inviting, setInviting] = useState(false);

  const refresh = async () => {
    const [p, g, u] = await Promise.all([
      base44.entities.PromptVersion.list('-version_number', 50),
      base44.entities.GoogleSettings.list('-created_date', 1),
      base44.entities.AppUsers.list('-created_date', 100),
    ]);
    setPrompts(p || []);
    setGoogle(g?.[0] || null);
    setUsers(u || []);
  };

  useEffect(() => {
    base44.functions.invoke('checkGoogleConnection', {}).then(() => refresh()).catch(() => refresh());
    base44.functions.invoke('verifyRequiredModel', {}).then((r) => setModel(r.data)).catch(() => setModel({ available: false }));
  }, []);

  if (!isAdmin) {
    return <div className="text-center py-24 text-stone-500">עמוד זה זמין למנהלי מערכת בלבד.</div>;
  }

  const active = prompts.find((p) => p.is_active);

  const createVersion = async () => {
    if (!newPrompt.trim()) return;
    setSaving(true);
    const me = await base44.auth.me();
    const nextVersion = Math.max(0, ...prompts.map((p) => p.version_number || 0)) + 1;
    // גרסה פעילה אינה נערכת במקום — שינוי יוצר גרסה חדשה
    for (const p of prompts.filter((x) => x.is_active)) {
      await base44.entities.PromptVersion.update(p.id, { is_active: false });
    }
    await base44.entities.PromptVersion.create({
      version_number: nextVersion,
      content: newPrompt,
      is_active: true,
      created_by_email: me.email,
    });
    setSaving(false);
    setPromptOpen(false);
    setNewPrompt('');
    refresh();
  };

  const invite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    const email = inviteEmail.toLowerCase().trim();
    const me = await base44.auth.me();
    try {
      const existing = await base44.entities.AppUsers.filter({ email });
      if (existing?.length) {
        await base44.entities.AppUsers.update(existing[0].id, { appRole: inviteRole, isActive: true });
      } else {
        await base44.entities.AppUsers.create({ email, appRole: inviteRole, isActive: true, invitedBy: me.email });
      }
      await base44.users.inviteUser(email, inviteRole === 'SystemAdmin' ? 'admin' : 'user');
      setInviteEmail('');
      refresh();
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold text-stone-900">ניהול מערכת</h1>

      {/* חיבור Google */}
      <div className="surface p-6">
        <h2 className="font-semibold text-stone-800 mb-3">חיבור Google</h2>
        <div className="flex items-center gap-2 text-sm">
          {google?.connected ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              מחובר · תיקיית יעד ב‑Google Drive: {google.folder_name || 'לא נבחרה'}
            </>
          ) : (
            <>
              <XCircle className="w-4 h-4 text-red-400" />
              חשבון Google אינו מחובר
            </>
          )}
        </div>
        {!google?.connected && (
          <p className="text-xs text-stone-400 mt-2 leading-relaxed">
            כדי ליצור מסמכי Google Docs יש לחבר את חשבון Google לאפליקציה. בקשו זאת בצ'אט הבנייה של Base44.
          </p>
        )}
      </div>

      {/* סטטוס מודל */}
      <div className="surface p-6">
        <h2 className="font-semibold text-stone-800 mb-3">מודל ה‑AI</h2>
        <div className="flex items-center gap-2 text-sm">
          {!model ? (
            <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
          ) : model.available ? (
            <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> {model.required_model || 'המודל'} זמין <span className="text-xs text-stone-400" dir="ltr">({model.model_id})</span></>
          ) : (
            <><XCircle className="w-4 h-4 text-red-400" /> {model.required_model || 'המודל'} אינו זמין, יצירת תסריטים חסומה{model.error ? ` (${model.error})` : ''}</>
          )}
        </div>
        {model && !model.available && (
          <p className="text-xs text-stone-400 mt-2 leading-relaxed">
            יש להגדיר את הסוד <span dir="ltr" className="font-mono">ANTHROPIC_API_KEY</span> בהגדרות האפליקציה ב‑Base44
            (Settings ← Secrets). אפשר לבחור מודל אחר עם הסוד <span dir="ltr" className="font-mono">CLAUDE_MODEL</span>.
          </p>
        )}
      </div>

      {/* גרסאות פרומפט */}
      <div className="surface p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-stone-800">פרומפט המערכת הנעול</h2>
          <Dialog open={promptOpen} onOpenChange={(o) => { setPromptOpen(o); if (o) setNewPrompt(active?.content || ''); }}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-lg"><Plus className="w-4 h-4 ml-1" /> גרסה חדשה</Button>
            </DialogTrigger>
            <DialogContent dir="rtl" className="max-w-2xl">
              <DialogHeader><DialogTitle>יצירת גרסת פרומפט חדשה</DialogTitle></DialogHeader>
              <Textarea value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} className="rounded-xl min-h-[320px] text-xs font-mono" />
              <Button onClick={createVersion} disabled={saving || !newPrompt.trim()} className="rounded-xl bg-stone-900">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'שמירה כגרסה פעילה חדשה'}
              </Button>
            </DialogContent>
          </Dialog>
        </div>
        <div className="space-y-2">
          {prompts.map((p) => (
            <div key={p.id} className="flex items-center justify-between bg-stone-50 rounded-xl px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">גרסה {p.version_number}</span>
                {p.is_active && <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[10px]">פעילה</Badge>}
                <span className="text-xs text-stone-400">{p.created_by_email}</span>
              </div>
              <button onClick={() => setViewPrompt(p)} className="text-stone-400 hover:text-stone-700"><Eye className="w-4 h-4" /></button>
            </div>
          ))}
          {prompts.length === 0 && <p className="text-sm text-stone-400">אין גרסאות פרומפט.</p>}
        </div>
        <Dialog open={!!viewPrompt} onOpenChange={(o) => !o && setViewPrompt(null)}>
          <DialogContent dir="rtl" className="max-w-2xl">
            <DialogHeader><DialogTitle>פרומפט — גרסה {viewPrompt?.version_number}</DialogTitle></DialogHeader>
            <pre className="text-xs whitespace-pre-wrap bg-stone-50 rounded-xl p-4 max-h-[60vh] overflow-auto">{viewPrompt?.content}</pre>
          </DialogContent>
        </Dialog>
      </div>

      {/* משתמשים */}
      <div className="surface p-6">
        <h2 className="font-semibold text-stone-800 mb-3">משתמשים והרשאות</h2>
        <div className="flex gap-2 mb-4 flex-wrap">
          <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="אימייל להזמנה" className="rounded-xl flex-1 min-w-[180px]" dir="ltr" />
          <Select value={inviteRole} onValueChange={setInviteRole}>
            <SelectTrigger className="rounded-xl w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ScriptCreator">יוצר תסריטים</SelectItem>
              <SelectItem value="SystemAdmin">מנהל מערכת</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={invite} disabled={inviting || !inviteEmail.trim()} className="rounded-xl bg-stone-900">
            {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'הזמנה'}
          </Button>
        </div>
        <div className="space-y-1.5">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between bg-stone-50 rounded-xl px-4 py-2.5 text-sm">
              <span dir="ltr">{u.email}</span>
              <Badge variant="outline" className="text-[11px]">
                {u.appRole === 'SystemAdmin' ? 'מנהל מערכת' : 'יוצר תסריטים'}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}