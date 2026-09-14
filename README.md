# Resume Tailor

A local web app that tailors your resume to a job ad using the Claude API, then exports an ATS-safe PDF. Bring your own Anthropic API key. Nothing runs on a server and nothing leaves your machine except the calls to Anthropic.

Built for the Australian market (Melbourne first) and for data roles: Data Analyst, Data Engineer, Data Scientist, Machine Learning Engineer, AI Engineer.

What makes it different: it never invents facts. It selects, reorders and rephrases what is already in your profile, asks you about gaps instead of filling them, and shows a diff with a reason and a source for every change.

## Status

Research and design are complete. Application code has not been written yet.

- `HANDOVER.md` is the build specification.
- `RESEARCH.md` is the research behind it: how applicant tracking systems actually behave in 2026, what recruiters look for, how the commercial tools work and where they fail, Australian resume conventions, and role-specific notes.
- `design/` holds the screen designs.

## Running it (once built)

```bash
python -m http.server 8080
```

Then open http://localhost:8080, paste your API key on the Profile screen, and import your resume as a PDF.
