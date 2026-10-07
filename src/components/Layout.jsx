import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAppUser } from '@/hooks/useAppUser';
import { Settings, FolderKanban, ShieldAlert } from 'lucide-react';

// סמל המותג: "מחוון" עגול עם נורית חיווי — רמז ללוח המחוונים של הרכב
function BrandMark() {
  return (
    <div className="relative w-9 h-9 rounded-xl bg-stone-900 ring-1 ring-white/10 flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" aria-hidden="true">
        <path d="M4.5 15.5a7.5 7.5 0 1 1 15 0" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M12 15.5 15.8 10" stroke="#F2A93A" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="15.5" r="1.6" fill="white" />
      </svg>
    </div>
  );
}

export default function Layout() {
  const { loading, appUser, isAdmin, user } = useAppUser();
  const location = useLocation();

  useEffect(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'he';
  }, []);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-stone-50">
        <div className="w-8 h-8 border-4 border-stone-200 border-t-signal-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!appUser) {
    return (
      <div dir="rtl" className="fixed inset-0 flex items-center justify-center bg-stone-50 p-6">
        <div className="max-w-md text-center surface p-10">
          <ShieldAlert className="w-10 h-10 text-signal-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-stone-900 mb-2">אין הרשאה למערכת</h1>
          <p className="text-stone-500 leading-relaxed">
            אין לך עדיין הרשאה למערכת. פנה למנהל המערכת לצורך פתיחת הרשאה.
          </p>
        </div>
      </div>
    );
  }

  const isActive = (to) => (to === '/' ? location.pathname === '/' || location.pathname.startsWith('/project') : location.pathname.startsWith(to));

  const navItem = (to, label, Icon) => (
    <Link
      to={to}
      className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
        isActive(to) ? 'bg-white/10 text-white' : 'text-stone-300 hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </Link>
  );

  return (
    <div dir="rtl" className="min-h-screen bg-stone-50 font-body">
      <header className="sticky top-0 z-40 bg-stone-900 text-white border-b border-black/20">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 min-w-0">
            <BrandMark />
            <div className="min-w-0">
              <div className="font-heading font-semibold leading-tight truncate">מחולל תסריטי הדרכה לרכב</div>
              <div className="text-[11px] text-stone-400 leading-tight hidden sm:block truncate">
                {appUser.appRole === 'SystemAdmin' ? 'מנהל מערכת' : 'יוצר תסריטים'} · {user?.email}
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            {navItem('/', 'פרויקטים', FolderKanban)}
            {isAdmin && navItem('/admin', 'ניהול', Settings)}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-8">
        <Outlet context={{ appUser, isAdmin }} />
      </main>
    </div>
  );
}
