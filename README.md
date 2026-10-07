# מחולל תסריטי הדרכה לרכב

**פריסה כאפליקציה חדשה ותפעול שוטף:** ראו [DEPLOY_HE.md](DEPLOY_HE.md).

## הגדרת מודל ה-AI

כל הקריאות למודל עוברות דרך `base44/shared/llm.ts`, באחד משני מסלולים:

**מסלול Base44 (ברירת מחדל, בלי הגדרה):** `Core.InvokeLLM` עם בחירת מודל מפורשת. ברירת המחדל היא `gpt_5_6_sol`, המזהה שכבר עבד באפליקציה. לא נדרש מפתח, והעלות יורדת מקרדיטי האינטגרציה של תוכנית Base44.

**מסלול Anthropic (אופציונלי):** מוסיפים את הסוד `ANTHROPIC_API_KEY` והמערכת עוברת אליו אוטומטית, עם Claude Sonnet 5.5 כברירת מחדל. בתשלום ל-Anthropic.

| סוד | ברירת מחדל | שימוש |
|---|---|---|
| `LLM_PROVIDER` | אוטומטי | `base44` או `anthropic`, כדי לכפות מסלול |
| `BASE44_LLM_MODEL` | `gpt_5_6_sol` | המודל לכל המשימות במסלול Base44 |
| `BASE44_LLM_WRITER_MODEL` | כמו הראשי | מודל לכתיבת התסריטים בלבד |
| `BASE44_LLM_FAST_MODEL` | כמו הראשי | OCR וניתוב ראיות, מתאים למודל זול |
| `CLAUDE_MODEL` / `CLAUDE_WRITER_MODEL` / `CLAUDE_FAST_MODEL` | `claude-sonnet-5-5` | המקבילים במסלול Anthropic |
| `CLAUDE_WRITER_EFFORT` | `medium` | מאמץ הכתיבה במסלול Anthropic |

מזהי המודלים ב-Base44 מופיעים בעמוד Models בתיעוד של Base44. מסך "ניהול" בודק כל מודל שהוגדר ומציג אם הוא זמין, כך שמזהה שגוי מתגלה לפני יצירה.

---

# Base44 Project

Use this repository to run and edit the app locally, then publish changes back through Base44.

Any change pushed to the repo will also be reflected in the Base44 Builder.

## Prerequisites

1. Clone the repository using the project's Git URL.
2. Navigate to the project directory.
3. Install dependencies: `npm install`.
4. Install the Base44 CLI: `npm install -g base44@latest`.

See the [Base44 CLI docs](https://docs.base44.com/developers/references/cli/get-started/overview) if you want to run Base44 commands directly.

## Run Locally

Run the full local development environment from the project root:

```bash
base44 dev
```

`base44 dev` starts the local Base44 development backend and, when this app is configured for it, also starts the frontend dev server for you. Use the frontend URL printed by the command.

For example, when the Base44 project config includes a `serveCommand`, `base44 dev` can launch the frontend too:

```json5
{
  "site": {
    "serveCommand": "npm run dev"
  }
}
```

In a Base44 project this lives in `base44/config.jsonc`.

## Run Only The Frontend

If you only want to work on the frontend against the hosted Base44 backend, run:

```bash
npm run dev
```

Open the local URL printed by Vite.

## Use The Hosted Backend

For frontend-only development, create or update `.env.local` in the project root:

```bash
VITE_BASE44_APP_ID=your_app_id
VITE_BASE44_APP_BASE_URL=https://your-app.base44.app
```

`VITE_BASE44_APP_ID` identifies the Base44 app.

`VITE_BASE44_APP_BASE_URL` tells the Base44 Vite plugin where to send local `/api` requests. Point it at your deployed Base44 app URL when you want the local frontend to use the hosted backend.

When you use `base44 dev`, the command injects the local Base44 values for you, so `.env.local` is mainly needed for frontend-only workflows.

## Publish Your Changes

After pushing your changes to git, open the Base44 dashboard and publish the app:

```bash
base44 dashboard open
```

## Docs & Support

Documentation: [https://docs.base44.com/Integrations/Using-GitHub](https://docs.base44.com/Integrations/Using-GitHub)

Base44 CLI command reference: [https://docs.base44.com/developers/references/cli/commands/introduction](https://docs.base44.com/developers/references/cli/commands/introduction)

Support: [https://app.base44.com/support](https://app.base44.com/support)
