# Demo_0005 – Vercel Scaffold (v3)

## Deploy
1. Push to GitHub and import the repo in Vercel.
2. Add Env Vars in Vercel → Settings → Environment Variables:
   - OPENAI_API_KEY = <key>
   - OPENAI_MODEL = gpt-4o-mini
   - OPENAI_ORGANIZATION = <org-id> (optional, for account-scoped keys)
   - OPENAI_PROJECT_ID = <project-id> (optional, for project-scoped keys)
3. Visit `/` → redirects to `/INDEX.html` (your Demo_0005).

## Excel-driven refresh
```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install pandas numpy openpyxl
python tools\refresh_index.py Soha-Usage-Price-updated.xlsx public\INDEX.html
```
This recomputes KPIs, Top Users (with Conferences), Recommendations, At‑Risk and exports CSVs to `public/data/`.

## Verify agent endpoints locally
Use the mocked OpenAI harness to exercise both agent handlers without calling the real API:

```bash
node --loader ./tools/ts-loader.mjs tools/test-agent.mjs
```

The script streams fake OpenAI responses through the route logic and asserts that both synchronous and streaming endpoints emit the expected payloads and completion events.
