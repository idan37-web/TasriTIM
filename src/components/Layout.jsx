import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAppUser } from '@/hooks/useAppUser';
import { Car, Settings, FolderKanban, ShieldAlert } from 'lucide-react';

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
        <div className="w-8 h-8 border-4 border-stone-200 border-t-stone-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!appUser) {
    return (
      <div dir="rtl" className="fixed inset-0 flex items-center justify-center bg-stone-50 p-6">
        <div className="max-w-md text-center bg-white rounded-2xl border border-stone-200 shadow-sm p-10">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-stone-900 mb-2">אין הרשאה למערכת</h1>
          <p className="text-stone-500 leading-relaxed">
            אין לך עדיין הרשאה למערכת. פנה למנהל המערכת לצורך פתיחת הרשאה.
          </p>
        </div>
      </div>
    );
  }

  const navItem = (to, label, Icon) => (
    <Link
      to={to}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
        location.pathname === to
          ? 'bg-stone-900 text-white'
          : 'text-stone-600 hover:bg-stone-100'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </Link>
  );

  return (
    <div dir="rtl" className="min-h-screen bg-stone-50 font-body">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-stone-900 flex items-center justify-center">
              <Car className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-stone-900 leading-tight">מחולל תסריטי הדרכה לרכב</div>
              <div className="text-[11px] text-stone-400 leading-tight hidden sm:block">
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
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8">
        <Outlet context={{ appUser, isAdmin }} />
      </main>
    </div>
  );
}