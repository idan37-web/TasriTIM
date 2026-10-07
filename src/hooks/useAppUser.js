import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function useAppUser() {
  const [state, setState] = useState({ loading: true, user: null, appUser: null });

  useEffect(() => {
    (async () => {
      try {
        const user = await base44.auth.me();
        const email = (user.email || '').toLowerCase().trim();
        const records = await base44.entities.AppUsers.filter({ email });
        let appUser = (records || []).find((r) => r.isActive !== false) || null;
        // מנהל Base44 ללא רשומת הרשאה — נוצרת עבורו רשומת מנהל מערכת אוטומטית
        if (!appUser && user.role === 'admin') {
          appUser = await base44.entities.AppUsers.create({
            email,
            fullName: user.full_name || '',
            appRole: 'SystemAdmin',
            isActive: true,
          });
        }
        setState({ loading: false, user, appUser });
      } catch {
        setState({ loading: false, user: null, appUser: null });
      }
    })();
  }, []);

  return {
    ...state,
    isAdmin: state.appUser?.appRole === 'SystemAdmin',
  };
}