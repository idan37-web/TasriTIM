import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { ensureAppFolder } from '../../shared/googleDocs.ts';

// בודק את חיבור Google, מוודא קיום תיקיית יעד ומעדכן את הגדרות המערכת.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const settingsList = await base44.asServiceRole.entities.GoogleSettings.list('-created_date', 1);
    const settings = settingsList && settingsList[0] ? settingsList[0] : null;

    let accessToken;
    try {
      const conn = await base44.asServiceRole.connectors.getConnection('googledocs');
      accessToken = conn.accessToken;
    } catch (_e) {
      if (settings) await base44.asServiceRole.entities.GoogleSettings.update(settings.id, { connected: false });
      return Response.json({ connected: false });
    }

    const folder = await ensureAppFolder(accessToken, settings ? settings.folder_id : null);
    const payload = { connected: true, folder_id: folder.id, folder_name: folder.name };
    if (settings) await base44.asServiceRole.entities.GoogleSettings.update(settings.id, payload);
    else await base44.asServiceRole.entities.GoogleSettings.create(payload);

    return Response.json({ ...payload, account_email: settings ? settings.account_email : null });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}