import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { pingModel } from '../../shared/llm.ts';

// בודק שהמפתח של Anthropic מוגדר ושהמודל שנבחר זמין. ללא fallback — אם אינו זמין, היצירה חסומה.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const status = await pingModel();
    return Response.json({
      required_model: status.label,
      model_id: status.model,
      available: status.available,
      ...(status.error ? { error: status.error } : {})
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
