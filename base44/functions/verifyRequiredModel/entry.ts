import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { REQUIRED_MODEL, REQUIRED_MODEL_LABEL } from '../../shared/constants.ts';

// בודק זמינות המודל הקשיח gpt-5.6-sol. ללא fallback — אם אינו זמין, היצירה חסומה.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    try {
      const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: 'השב במילה אחת בלבד: תקין',
        model: REQUIRED_MODEL
      });
      const available = typeof res === 'string' && res.length > 0;
      return Response.json({ required_model: REQUIRED_MODEL_LABEL, model_id: REQUIRED_MODEL, available });
    } catch (modelError) {
      return Response.json({
        required_model: REQUIRED_MODEL_LABEL,
        model_id: REQUIRED_MODEL,
        available: false,
        error: modelError.message
      });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}