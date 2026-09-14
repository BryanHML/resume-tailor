# Resume Tailor

A local web app that tailors your resume to a job ad using the Claude API, then exports an ATS-safe PDF. Bring your own Anthropic API key. Nothing runs on a server and nothing leaves your machine except the calls to Anthropic.

Built for the Australian market (Melbourne first) and for data roles: Data Analyst, Data Engineer, Data Scientist, Machine Learning Engineer, AI Engineer.

What makes it different: it never invents facts. It selects, reorders and rephrases what is already in your profile, asks you about gaps instead of filling them, and shows a diff with a reason and a source for every change.

## Status

Two things work end to end. **Import your resume** as a PDF and it becomes a structured inventory: every bullet copied word for word, tagged, with the real numbers recorded and anything uncertain raised for you to confirm. **Paste a job ad** and you get a weighted requirements table, the role the ad actually resembles regardless of its title, what your profile already evidences, and up to five gap questions whose answers become new bullets you keep.

Tailoring, the block editor, PDF export and the cover letter are still to come.

Runs about 11 cents to import a resume and 17 cents to analyse an ad, on Claude Opus 5.

**A note on the dev server.** `python -m http.server` serves the whole folder, so a `.env` sitting next to `index.html` is readable at `http://localhost:8080/.env`. Other websites cannot read it, but keep secrets out of the served folder if that bothers you. The app itself never needs `.env`; only the dev harness does.

**Testing your API key is free.** The Test key button on the Profile screen calls the models endpoint, which authenticates without generating anything. No tokens, no charge, and it does not touch your message rate limit. It also greys out any model your key cannot reach.

- `HANDOVER.md` is the build specification and the milestone list.
- `RESEARCH.md` is the research behind it: how applicant tracking systems actually behave in 2026, what recruiters look for, how the commercial tools work and where they fail, Australian resume conventions, and role-specific notes.
- `design/` holds the screen designs.

## Running it

```bash
python -m http.server 8080
```

Then open http://localhost:8080. Opening `index.html` by double-click also works, with one limitation: saving to a workspace folder needs a secure page, so use Export and Import instead.

## Tests

```bash
node test.js
```

Covers the workspace merge, which is the one place a bug could silently destroy your work.

## Where your data lives

- **This browser.** Everything autosaves to local storage as you work.
- **A folder you choose.** Optional, Chrome and Edge. Plain JSON files you can back up, commit or hand-edit. Reconnects with one click next time.
- **`workspace.json`.** Export and import to move between machines, or as the fallback in Firefox and Safari.

Your API key is never written into the workspace or the folder. By default it lives in the tab and is forgotten when you close it. "Remember on this device" opts into keeping it in this browser.
