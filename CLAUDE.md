# Resume Tailor

Local, zero-backend web app that tailors a resume to a pasted job ad with the Claude API and exports an ATS-safe PDF. Australia (Melbourne) conventions, data roles, entry level first.

## Read first

1. `HANDOVER.md` is the specification. Every decision in it is locked unless the owner reopens it.
2. `RESEARCH.md` is the evidence behind the decisions.
3. `design/*.dc.html` are the visual spec (plain HTML with exact values). The published canvas is linked from HANDOVER.md section 9.

## Rules for this repo

- Static HTML, CSS and JavaScript only. No framework, no bundler, no backend. Served with `python -m http.server 8080`.
- PDF in, PDF out. No DOCX. No URL fetching. Job ads are pasted text.
- The tailor never invents facts or numbers. Every change carries a source. Gaps become questions for the user.
- Load the `claude-api` skill before writing or changing any Claude API call, and verify request shapes against it. Default model `claude-opus-5`.
- Never commit the owner's resume, real job ads, a workspace folder, or an API key. `.gitignore` covers `*.pdf`, `workspace/`, `fixtures/` and `.env`.
- `index.html` loads `styles.css`, `core.js` and `app.js` with a `?v=N` query. Bump N when you change any of them, or Chrome serves a stale copy and you will debug a ghost.
- Ponytail mode applies: smallest working change, stdlib and platform features first, mark deliberate shortcuts with a `// ponytail:` comment.
