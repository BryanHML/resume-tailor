# Resume Tailor: build handover

Status on 2026-09-14: research and design are complete. Milestone 1 (the skeleton) is built and verified; see section 12 for what that covers and what is next. This document is the specification. Read it fully, then `RESEARCH.md` for the evidence behind each decision, then the design files in `design/`. Do not re-open decisions marked locked unless the owner asks.

The owner is Bryan. He is building this for his own job search at entry/junior level in Melbourne, Australia, targeting data roles. It should also work for anyone with an Anthropic API key who runs it locally.

---

## 1. What it is

A local, zero-backend web app. The user pastes a job ad, and the app tailors their resume to it using the Claude API, then exports an ATS-safe PDF. A separate feature writes a cover letter. Everything runs in the browser from static files served by a one-line local file server. The user's own API key is used. Nothing leaves the machine except the calls to Anthropic.

What makes it different from Jobscan, Teal, Rezi and the rest: it never invents facts. It selects, reorders and rephrases what is already in the user's profile, asks the user about gaps instead of filling them, and shows a diff with a reason and a source for every change. Every commercial tool tested in 2026 fabricates metrics. This one is built so it cannot.

**Non-goals:** multi-user, cloud sync, accounts, DOCX output, fetching ads from URLs, job tracking, LinkedIn tooling, autofill, scale.

---

## 2. Locked decisions

Product
- Target roles: Data Engineer, Data Scientist, AI Engineer, Machine Learning Engineer, Data Analyst. Handled via five role profile data files (section 8).
- Target market: Australia, Melbourne first. Australian English, A4, DD/MM/YYYY and MM/YYYY dates, +61 phone format, no photo, no date of birth, no marital status.
- Career stage is a profile setting (student / graduate / junior / mid / senior). Default junior. It drives section order, summary style and page target.
- Page target is a setting. Default 1 page. Two pages is the Australian norm for mid-level, three for senior or government.
- Work-rights line in the header is a toggle, off by default. Referees line ("Referees available on request") is a toggle, on by default.
- Cover letter is a separate feature: own screen, own record, own PDF. It may start from a saved job (reusing that job's analysis and accepted resume) or from a freshly pasted ad.
- Tailor may suggest a headline change (for example "Data Scientist" to "Machine Learning Engineer") when the ad's shape supports it and the profile evidences it. Always shown as a flagged change, never silent.
- Projects section is kept simple. One portfolio or GitHub link in the header, no per-project links.

Input and output
- Resume input: PDF upload, sent to Claude as a document block, or pasted text. No DOCX parsing.
- Job ad input: pasted text only. No URL fetching.
- Output: PDF only, via the browser's print-to-PDF with print CSS. No DOCX.

Architecture
- Zero backend. Static HTML, CSS and JavaScript. No framework, no bundler, no build step.
- Served with `python -m http.server 8080` (documented path). Double-clicking `index.html` is a fallback and must keep working, which means classic scripts or an inline module strategy that does not break on `file://`.
- Claude API called directly from the browser with the user's key.
- Persistence: localStorage autosave, optional workspace folder via the File System Access API, and export/import of a workspace JSON file.
- Default model `claude-opus-5`, with a model picker (Sonnet 5, Haiku 4.5) and an effort picker.

Working style
- Ponytail mode is active on this machine: the laziest solution that works. Stdlib and platform features before libraries. No abstractions for one use. Deletion over addition. Mark deliberate shortcuts with a `// ponytail:` comment naming the ceiling and the upgrade path.
- Never simplify away: input validation at trust boundaries, the truthfulness guard, accessibility basics (44px targets, focus states, labels), error handling that prevents data loss.

---

## 3. Architecture

```
resume_enhancer/
  index.html          the app shell and all screens
  app.js              state, rendering, Claude calls, checks, persistence
  styles.css          tokens and layout (or inline in index.html if small)
  print.css           the exported document only (A4, Arial, single column)
  roles/
    data-analyst.json
    data-engineer.json
    data-scientist.json
    ml-engineer.json
    ai-engineer.json
  prompts/            plain text system prompts, loaded at runtime
  design/             the visual spec (.dc.html artboards) and canvas.json
  RESEARCH.md         evidence
  HANDOVER.md         this file
```

Keep it to a handful of files. Split `app.js` only when a section passes a few hundred lines and has a clean seam (for example `checks.js` for the deterministic lint, `claude.js` for the API layer).

Libraries: none required. Optional, from a CDN by script tag:
- `pdf.js` for the parse preview (reading text back out of the exported PDF in reading order).
- `@anthropic-ai/sdk` via an ESM CDN import with `dangerouslyAllowBrowser: true` if it loads cleanly from `localhost`; it handles streaming, retries and the browser CORS header. Otherwise raw `fetch` to `https://api.anthropic.com/v1/messages` with the header `anthropic-dangerous-direct-browser-access: true`. Pick one, do not mix.

Fonts: IBM Plex Sans and IBM Plex Mono from Google Fonts for the UI. The exported document uses Arial only.

---

## 4. Data model

One `workspace` object. Every persistence layer stores the same shape.

```js
workspace = {
  schemaVersion: 1,
  settings: {
    model: "claude-opus-5",          // or claude-sonnet-5, claude-haiku-4-5
    effort: "high",                   // low | medium | high
    rememberKey: false,               // key itself is never in this object
    careerStage: "junior",
    pageTarget: 1,
    workRightsLine: false,
    workRightsText: "",               // e.g. "Australian citizen"
    refereesLine: true,
    spelling: "en-AU",
    lastOpenJobId: null
  },
  profile: {
    version: 3,
    source: { type: "pdf", filename: "resume.pdf", importedAt: "2026-09-14" },
    basics: { name, city, state, phone, email, linkedin, portfolio },
    summary: "",                      // the user's base summary
    sections: [                       // ordered
      { id, kind: "skills" | "projects" | "education" | "experience" | "certifications" | "other",
        title, items: [
          { id, heading, subheading, dates: { start: "MM/YYYY", end: "MM/YYYY" | "Present" },
            bullets: [ bulletId, ... ] }
        ] }
    ],
    bullets: {                        // the inventory, keyed by id
      "b12": {
        id: "b12",
        text: "Analysed 40,000 customer records in SQL and Python ...",
        tags: ["sql", "python", "business-impact"],
        roles: ["DA", "DS"],          // which role profiles this supports
        numbers: [ { value: "40,000", what: "customer records", source: "resume" } ],
        source: { type: "resume" | "gap", jobId: null, date: "14/09/2026" },
        retired: false
      }
    },
    parseReview: [ { field: "phone", note: "read as 04xx xxx xxx", resolved: false } ]
  },
  jobs: [
    {
      id, title, company, location, adText, pastedAt,
      role: "DA",                     // detected or user override
      shape: "analyst-shaped; also asks for Snowflake, common in DE ads",
      analysis: {
        requirements: [
          { id: "r1", name: "SQL", category: "hard-skill" | "tool" | "cert" | "soft-skill" | "title" | "years",
            weight: 10, required: true, adCount: 4, aliases: ["SQL", "T-SQL", "structured query language"],
            status: "evidenced" | "partial" | "missing", evidence: ["b12", "b03"] }
        ],
        predicted: ["Excel", "Tableau"],
        coverageBefore: 0.61
      },
      gaps: [ { id: "q1", requirementId: "r5", question: "...", answer: "", skipped: false, bulletId: null } ],
      tailored: {
        version: 3,
        headline: "Junior Data Analyst",
        summary: "...",
        sections: [ ... same shape as profile.sections, referencing bullet ids or inline text ... ],
        changes: [
          { id: "c3", target: { sectionId, itemId, bulletId } | "summary" | "headline" | "skills-order",
            kind: "rewrite" | "reorder" | "hide" | "add-from-inventory" | "summary" | "headline",
            original: "...", suggested: "...", why: "...",
            sources: [ { type: "profile", bulletId: "b12" }, { type: "gap", gapId: "q3" } ],
            numbersCheck: { ok: true, unmatched: [] },
            decision: "pending" | "accepted" | "rejected" | "edited", editedText: null }
        ]
      },
      coverageAfter: 0.68,
      status: "new" | "analysed" | "tailoring" | "exported",
      createdAt, updatedAt
    }
  ],
  coverLetters: [
    { id, jobId: "j1" | null, adText: null, notes: "", addressee: "Hiring Manager",
      paragraphs: [ { id, text, covers: ["r1", "r2"], sources: [ ... ] } ],
      checks: [ { name, pass: true, note } ], wordCount: 236, createdAt, updatedAt }
  ]
}
```

Rules
- Bullet ids are stable for the life of the profile. Tailored versions reference them, so a re-tailor can tell what was accepted.
- Gap answers become bullets with `source.type = "gap"` and `source.jobId` set, then get tagged like any other.
- Hiding a block in a tailored version never touches the profile.
- Undo/redo is in memory only, as snapshots of the tailored object.
- The API key lives in memory and `sessionStorage`. With `rememberKey` it also goes to `localStorage` under its own key. It never enters `workspace` or any file on disk.

---

## 5. Claude API contract

Before writing any API code, load the `claude-api` skill in Claude Code and verify every request shape against it. The skill is authoritative over anything remembered. Points that matter here, correct as of 2026-09-14:

- Model ids: `claude-opus-5` (default), `claude-sonnet-5`, `claude-haiku-4-5`. No date suffixes.
- Thinking: omit the `thinking` parameter or pass `{ type: "adaptive" }`. Never `budget_tokens`. Depth via `output_config: { effort: "low" | "medium" | "high" }`.
- Structured output: `output_config: { format: { ... JSON schema ... } }`. Do not use the deprecated `output_format`. Every call below returns JSON validated against a schema.
- PDF input: a `document` content block, `source: { type: "base64", media_type: "application/pdf", data }`, placed before the text block. No newlines in the base64.
- Streaming: use it for the tailor call and the cover letter call. `max_tokens` around 16000 non-streaming, larger when streaming.
- Refusals: check `stop_reason === "refusal"` before reading content and show a plain message. Consider the server-side fallbacks parameter the skill describes for Opus 5.
- Errors: 429 and overloaded get a retry with backoff (the SDK does this). 400s are shown to the user with the message. Never retry a 400.
- Browser: header `anthropic-dangerous-direct-browser-access: true` (the SDK sets it when `dangerouslyAllowBrowser` is true). Verify on first build that calls succeed from `http://localhost:8080` and from `file://`.
- Prompt caching: skipped in v1. A one-page profile plus rules sits near the minimum cacheable prefix for Opus. Add when measured.

### The calls

Every call gets the same base system prompt (section 6) plus the role profile for the detected role.

1. **Profile bootstrap** (once, and on re-import). Input: the PDF document block or pasted text, career stage. Output: the `profile` object with bullets extracted verbatim, tags, roles, numbers on record with what they measure, dates normalised to MM/YYYY, phone to +61 form, spelling to en-AU, and `parseReview` entries for anything uncertain. Rule: never paraphrase bullets at this stage. Extract, do not improve.

2. **Job analysis** (per job). Input: ad text, profile, role profiles (all five, so it can detect shape). Output: `role`, `shape`, `analysis.requirements` with weights 1 to 10, required vs preferred, category, ad count, aliases, status and evidence bullet ids, `predicted`, and `gaps` (at most 5 questions, ordered by requirement weight, only for missing or partial requirements). Coverage before tailoring is then computed in JavaScript (section 7), not by the model.

3. **Tailor** (per job, streamed). Input: profile, job analysis, gap answers, the current tailored version and every decision so far, settings (career stage, page target, headline change allowed). Output: the `tailored` object with a complete `changes` list. Rules in section 6. Accepted changes must be preserved verbatim. A re-run proposes only new changes against the current version.

4. **Trim to fit** (on demand). Input: current tailored version, the overflow amount in characters, requirement weights. Output: a `changes` list that shortens or hides the lowest-relevance bullets to a character budget. Same rules.

5. **Cover letter** (per letter, streamed). Input: profile, the chosen job's analysis and accepted resume (or a fresh ad with a lightweight analysis), user notes, settings. Output: `paragraphs` with `covers` and `sources`, plus addressee. Rules: 250 to 400 words, one A4 page, first person, direct, four short paragraphs, company facts only from the ad and the notes, gaps handled honestly, no new facts.

6. **Judge** (optional, cheap model). Input: tailored text and profile. Output: for each bullet, the source bullet ids that support it, and any claim with no support. Runs in the background after a tailor; unsupported claims get a red flag in the editor.

Cost per job at Opus 5 pricing is a few cents. Show token usage from the response in the metrics strip if it is free to do so.

---

## 6. Prompt rules

The base system prompt, kept as a plain text file in `prompts/`, must say at minimum:

- Truth first. Select, reorder and rephrase what is in the profile. Never add a fact, a skill, a tool, an employer, a date or a number that is not in the profile or a gap answer. If evidence is missing, leave it missing; the app asks the user.
- Every rewritten bullet carries `sources`. A bullet with no source is a defect.
- Mirror the ad's vocabulary where the profile supports it. Use the ad's spelling. Include an acronym and its expansion once where the ad uses either.
- Australian English. No US spellings unless the ad itself uses them.
- Bullets follow "accomplished X, measured by Y, by doing Z" where the profile has Y. Strong verb first. One to two lines. Never invent Y.
- Never use: spearheaded, leveraged, pivotal, intricate, showcasing, synergy, delve, realm, robust, orchestrated, passionate, results-driven, dynamic, seamlessly. No em-dashes anywhere in the document.
- Ordering follows the F-pattern: the most relevant bullets first within each item, the most relevant skills first, the summary mirrors the target title and the top three requirements.
- Section order by career stage. Junior: header, summary, key skills, projects, education, experience, certifications. Projects above experience when experience is thin. Mid and senior: header, summary, key skills, experience, projects, education, certifications.
- Cut what does not serve this ad. Prefer hiding a block to padding another.
- Aim for keyword coverage in the 75 to 80 percent band. Do not chase 100.
- Keep the user's voice. Do not make every bullet the same shape.
- Preserve accepted decisions verbatim.

Role profiles add: the taxonomy and aliases, signature metrics and the question to ask when a bullet lacks one, red flags, Melbourne weighting.

---

## 7. Deterministic checks (JavaScript, no model)

Keyword coverage
- For each requirement, search the tailored document text for any alias, case-insensitive, word-boundary, treating en-AU and US spellings as equal. Count occurrences for the "cv" column.
- Coverage = sum of weights of requirements found / sum of all weights. Show against the 75 to 80 band. Status (evidenced / partial / missing) comes from the model's evidence mapping, not from this count. Two signals, shown separately.

Parse safety (all must pass; they are structural and mostly true by construction)
1. Single column layout.
2. No tables.
3. No text boxes or floats.
4. No images or icons.
5. Contact details in the body, not a page header or footer.
6. Standard section headings only (Summary, Key Skills, Projects, Education, Experience, Certifications).
7. Standard bullet glyphs.
8. Arial, body 10.5 to 11pt, headings 12 to 14pt.
9. A4 page size.
10. Dates consistent MM/YYYY.
11. Page count within the target.
12. Exported PDF is text-based and extracts in reading order (verified with pdf.js after export).

Content lint (badges on blocks, list in the inspector)
- No metric: a bullet with no digit and no number word.
- Weak verb: starts with "responsible for", "worked on", "helped", "assisted with", "involved in", "duties included", "tasked with".
- AI-tell: any word from the list in section 6, or three or more em-dashes on the page.
- en-AU: a US spelling from the pairs list (optimize/optimise, analyze/analyse, organization/organisation, color/colour, center/centre, modeling/modelling, labeled/labelled, program stays program, license/licence as a noun, catalog/catalogue, behavior/behaviour, utilize/utilise, visualization/visualisation, summarize/summarise, prioritize/prioritise, specialize/specialise, recognize/recognise, minimize/minimise, maximize/maximise, standardize/standardise, favorite/favourite, defense/defence, practice/practise as a verb) unless the ad uses the US form.
- Too long: a bullet over two rendered lines at export width.

Numbers check
- Every number in the tailored output (digits, percentages, currency, multipliers) must appear in the profile's bullets or numbers on record, or in a gap answer. Anything unmatched is a red flag on that change.

Page fit
- Render the document at A4 width (794px at 96dpi) with the print stylesheet, measure content height against the printable height (1123px less margins). Show percent of page used and draw the page-break line. Overflow enables Trim to fit.

Cover letter checks
- No new facts (every paragraph's claims map to sources), company facts only from the ad and notes, en-AU, no AI-tell words and no em-dashes, fits one A4 page, word count within 250 to 400.

---

## 8. Role profiles

One JSON file per role. Shape:

```js
{
  id: "DA", name: "Data Analyst",
  titleAliases: ["Data Analyst", "Junior Data Analyst", "BI Analyst", "Product Analyst", "Reporting Analyst", "Insights Analyst"],
  taxonomy: {
    "core":        [ { name: "SQL", aliases: ["SQL", "T-SQL", "PostgreSQL", "MySQL"] }, ... ],
    "bi-tools":    [ { name: "Power BI", aliases: ["Power BI", "PowerBI"] }, { name: "Tableau", aliases: [] }, { name: "Looker", aliases: [] } ],
    "languages":   [ { name: "Python (pandas)", aliases: ["Python", "pandas"] }, { name: "R", aliases: [] } ],
    ...
  },
  signatureMetrics: [
    { name: "adoption", question: "Who used the dashboard or report, and how many people or teams?" },
    { name: "decision", question: "What decision or action changed because of the analysis?" },
    { name: "effect", question: "What was the revenue, cost or time effect, even roughly?" },
    { name: "speed", question: "How much faster did a query, report or process get?" }
  ],
  redFlags: [
    { pattern: "worked on dashboards", note: "Say who used it and what changed." },
    { pattern: "theoretical data science framing", note: "Analyst ads want SQL, a named BI tool and a business outcome on page one." }
  ],
  sectionPriority: { junior: ["projects", "education", "experience"], mid: ["experience", "projects", "education"] },
  melbourneWeighting: { "Power BI": 1.2, "Azure": 1.2, "Snowflake": 1.1, "Databricks": 1.1 }
}
```

Content for the five roles is in `RESEARCH.md` section 7 (screening focus, signature metrics, red flags) and section 8 (Melbourne weighting: Databricks, Power BI, Azure and Snowflake weigh more than US guides suggest; Hadoop-to-cloud migration experience is a positive framing here, not a legacy red flag). Validate the taxonomies against the real Melbourne ads the owner supplies before treating them as final.

Shape detection: the analysis call receives all five profiles and reports which one the ad actually resembles, regardless of its title. A "Data Scientist" ad that asks for Kubernetes and model serving is MLE-shaped.

---

## 9. Screens

The visual spec is the design canvas (https://claude.ai/code/artifact/9b4556f3-f8dc-4096-af2c-dffc0eea9b28) and the artboards in `design/`. Page one holds the four screens in flow order; page two holds the three original directions for reference. Build from the `.dc.html` files: they are plain HTML with inline styles and contain the exact values.

Chosen system: direction B's structure with direction A's palette.

Tokens
- Workspace background `#f4efe7`, panels `#fbf8f3`, document page `#ffffff`.
- Ink `#201b16`, muted `#6e655a`, border `#e4dccf`, row divider `#efe9df`, nav track `#efe9df`.
- Accent `#b4552c`, accent tint `#fbeee6`, accent dark text `#8f4222`, keyword highlight `#f6d9c9`.
- Green `#3e7a50` / tint `#e6f0e8` / text `#2f6140`. Amber `#b0791a` / tint `#fbf0d9` / text `#8a5f12`. Red `#a63c2f` / tint `#fde7e3` / text `#8f3022`.
- UI font IBM Plex Sans 13px base; IBM Plex Mono for numbers, ids, labels and column headers. Radii 4px, 6px on the nav track. Controls 44px tall. Chrome 52px.

Shared skeleton, every screen
- Chrome: wordmark with a small accent square, segmented nav (Profile / Jobs / Cover letters), mono model and effort readout, saved-at indicator.
- Metrics strip: one wide title cell (1.6fr) plus three or four metric cells (1fr each), each with an uppercase label, a mono number, a subtext and a 4px bar.
- Body: three panels. Left context, centre document, right inspector. Widths 400 / fluid / 380 on Tailor and Profile, 300 / fluid / 460 on Job, 360 / fluid / 380 on Cover letter.

Profile & setup (`design/Profile.dc.html`)
- Left: API key field with show and a remember checkbox, model select, effort segmented control, career stage segmented control, a settings list (page target, spelling, work-rights toggle, referees toggle), workspace folder row with connected state, and links for change folder, export, import.
- Centre: the bullet inventory rendered as blocks with tags. Import banner when parse review has open items. Add bullet and Re-import PDF buttons.
- Right: the selected bullet (text, numbers on record with their source, tags with add), Save and Retire buttons, and the parse review list.

Job workspace (`design/Job.dc.html`)
- Left: saved jobs list with status chips and coverage, New job button.
- Centre: title and company fields, the pasted ad with matched requirement terms highlighted, word count and detected spelling, role select with the shape note, Re-analyse.
- Right: requirements table (requirement, wt, ad, cv, status), predicted skills, gap questions with an answer box each (an answered one shows the answer; an open one shows the placeholder "Type an answer, or skip. Nothing is added unless you say it here."), Tailor resume and Skip open gaps.

Tailor (`design/Main.dc.html`)
- Strip: keyword coverage vs band, parse safety, content flags, page fit.
- Left: requirements table, gap questions still open.
- Centre: version line and Re-tailor / Export PDF; the document page with every block selectable, matched terms highlighted, badges for flags, the selected block outlined in accent, a dashed page-break line with percent used.
- Right: the selected change as a red/green diff, why, sources, numbers check, Accept / Reject / Edit with A / R / E shortcuts, prev and next, and the lint list.

Cover letter (`design/CoverLetter.dc.html`)
- Left: Saved job / Paste an ad toggle, job select, notes box, a settings list (addressee, tone, length), Regenerate and Export PDF.
- Centre: the letter page with each paragraph a block; badges such as "gap · honest" and "short".
- Right: the selected paragraph's coverage chips and sources, Edit and Rewrite with a note, and the checks list.

Block editor behaviour (Tailor, Profile and Cover letter share it)
- Click selects a block; the inspector binds to it. Enter or double-click edits inline. Escape cancels.
- Per block: edit, AI-rewrite with an optional one-line instruction, accept or revert, move up or down, hide from this version, insert an unused bullet from the inventory.
- Keyboard: A accept, R reject, E edit, J/K or arrows to move between changes.
- Undo and redo across the tailored object.

---

## 10. Persistence

- `localStorage["resume-tailor.workspace.v1"]` holds the whole workspace, written on every change with a 500ms debounce. Restore on load.
- Workspace folder: `showDirectoryPicker()` once; store the handle in IndexedDB (handles do not serialise into localStorage). On the next load, if a handle exists, show "Reopen workspace" and call `requestPermission()` on click. Write `settings.json` (never the key), `profile.json`, `jobs/<id>.json`, `letters/<id>.json`. Read them back on reconnect; per record, the newer `updatedAt` wins.
- Export downloads `workspace.json`; import reads one. This is the Firefox and Safari path and the move-between-machines path.
- The API key: memory plus `sessionStorage`; `localStorage["resume-tailor.key"]` only when remember is on. Never in the workspace, never in the folder.
- On launch, show a card for `settings.lastOpenJobId` with its status and pending change count, plus the jobs list.

---

## 11. PDF export

- `print.css` targets the document only: `@page { size: A4; margin: 0 }` with the margins applied as padding inside the page element, which suppresses the browser's header and footer text. Arial, body 10.5 to 11pt, headings uppercase 10 to 11pt with a bottom rule, single column, standard bullets, contact line in the body under the name.
- The on-screen preview uses the same markup and the same stylesheet at A4 width, so the preview is the export.
- Export button calls `window.print()` on a print-only view. The user chooses Save as PDF; Chrome remembers the destination.
- After export, offer "Check the PDF": the user re-selects the saved file, pdf.js extracts text, and the app shows it in reading order with the parse-safety check 12 marked pass or fail.
- Cover letter export uses the same mechanism with a letter template.

---

## 12. Build order and definition of done

1. ~~**Skeleton.**~~ **Done.** `index.html`, `styles.css`, `core.js`, `app.js`, `test.js`. Chrome, nav and three screens in the tokens above; settings panel, key handling and all three persistence layers work. Verified: settings survive a reload, import merges without destroying existing records, the key never enters the workspace, panel widths and 44px control heights match the design. Two spec refinements made while building: `settingsUpdatedAt` at the workspace level and `updatedAt` on the profile, both needed so the folder merge can pick a winner per record. Not verified by automation: the folder picker is an operating-system dialog, so choosing a folder and reconnecting needs one manual pass.
2. **Profile bootstrap.** PDF or text in, profile out, parse review, inventory rendered as blocks with tags. Done when the owner's real resume imports cleanly and every uncertain field is surfaced.
3. **Job workspace.** Paste, analyse, role and shape, requirements table, predicted skills, gap questions with answers becoming bullets. Done when the five role fixtures analyse sensibly and coverage-before is computed locally.
4. **Tailor.** Streamed tailor call, block editor, diff inspector, decisions, lint, numbers check, page fit, trim to fit, re-tailor preserving decisions. Done when an accepted change survives a re-tailor and every change has a source.
5. **PDF export.** Print CSS, export, parse preview with pdf.js. Done when the exported PDF extracts in reading order and a third-party scan (for example Jobscan's free scan) shows no formatting warnings.
6. **Cover letter.** Own screen, generation from a saved job and from a pasted ad, paragraph blocks, checks, export. Done when a letter passes all six checks on a real ad.
7. **Role profiles.** The five JSON files tuned against the real ads. Done when the analysis call's requirement lists match what a human reads in the ads.

Verify in build 1, do not assume: ~~browser-direct API calls from localhost~~ (**verified**: `GET /v1/models` from `http://localhost:8080` with `anthropic-dangerous-direct-browser-access: true` returns a clean 401 on a bad key, so CORS and auth both work), browser-direct calls from file://, structured output shapes, print-to-PDF text order, in-browser folder reconnect, cost per run from response usage.

**Free key test.** `GET /v1/models` authenticates without generating anything: no input or output tokens, no charge, and it is not the messages endpoint so it cannot consume a messages rate limit. The Profile screen uses it for the Test key button, and the returned model list also greys out any model the key cannot reach. Use this, never a one-token message, whenever a key needs checking.

---

## 13. What the owner supplies

- The current resume as a PDF.
- 10 to 15 pasted Melbourne job ads across the five roles, kept out of the repo (see `.gitignore`).
- A project and experience inventory with real numbers.
- An Anthropic API key with credit.

Until these arrive, milestones 1 and 2 can be built against a synthetic sample. The sample content in `design/` (the candidate "Sam Taylor", employer "Yarra Energy") is invented and safe to reuse as fixture data.

---

## 14. Phase 2 candidates (not now)

Key Selection Criteria generator for Victorian Government roles (STAR responses per criterion), SEEK and LinkedIn keyword list export, PDF-overlay parse correction, interview prep generated from the gap list, a dark warm chrome variant.
