import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { pingModel } from '../../shared/llm.ts';

// בודק שהמודל שנבחר זמין במסלול המוגדר (Base44 או Anthropic). ללא fallback — אם אינו זמין, היצירה חסומה.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const status = await pingModel(base44);
    return Response.json({
      required_model: status.label,
      model_id: status.model,
      available: status.available,
      provider: status.provider,
      ...(status.error ? { error: status.error } : {})
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
