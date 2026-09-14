# Resume Tailor

A local web app that tailors your resume to a job ad using the Claude API, then exports an ATS-safe PDF. Bring your own Anthropic API key. Nothing runs on a server and nothing leaves your machine except the calls to Anthropic.

Built for the Australian market (Melbourne first) and for data roles: Data Analyst, Data Engineer, Data Scientist, Machine Learning Engineer, AI Engineer.

What makes it different: it never invents facts. It selects, reorders and rephrases what is already in your profile, asks you about gaps instead of filling them, and shows a diff with a reason and a source for every change.

## Status

The app shell is built. The three screens, the settings panel and all three persistence layers work. Nothing calls the Claude API yet: importing a resume, analysing an ad, tailoring and the cover letter are the next steps.

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
