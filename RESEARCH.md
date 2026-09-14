# Resume Tailor: Research Findings (2026-09-14)

Goal: local, plug-and-play web app. User brings a Claude API key, uploads a resume, pastes a job description (JD), gets back an ATS-safe tailored resume. Not built for scale.

---

## 1. How ATS actually works in 2026 (myths vs reality)

**An ATS is a database with a parser on the front.** Your resume's job is to parse cleanly and contain the right words. Nothing more mystical than that.

| Myth | Reality |
|---|---|
| "75% of resumes are auto-rejected by ATS" | No study exists. Traces to a 2012 sales pitch by a startup that folded in 2013. Systems don't reject; people do. |
| "Beat the ATS with keyword tricks" | Recruiters search and filter by keyword. AI ranking layers now use semantic matching. Hidden/white text is flagged as fraud in 2026. |
| "All ATS behave the same" | Taleo breaks on tables/columns and prefers DOCX. Workday parses into form fields (wrong extraction = wrong stored data). Greenhouse and Lever parse text-PDFs fine and do not auto-score. iCIMS uses knockout questions on the form. |
| "ATS score of 90% = interview" | Every vendor's score is proprietary and directional at best. |

**The AI layer (new since 2025-26):** Workday (HiredScore A/B/C/D grades), Greenhouse Talent Matching (Feb 2026), Lever Talent Fit, iCIMS Coalesce, SAP Joule. These score semantic fit, not exact keyword hits. "Python engineer" and "backend developer, 5 yrs" can score high with zero keyword overlap. Still, consistent terminology helps both search and ranking.

**Two sequential filters to pass:**
1. Machine: clean parse, terminology alignment, evidenced skills, measurable outcomes.
2. Human: recruiter spends ~7 seconds on first scan (F-pattern, top third gets 80% of attention), ~67 seconds on detailed review. Generic AI-sounding text gets binned here regardless of algorithm rank.

**Formatting that breaks parsers:** multi-column layouts, tables, text boxes, contact info in header/footer, graphics/icons/skill bars, non-standard section names, custom bullet glyphs, image-exported PDFs. Reverse-chronological single-column averages ~97% extraction accuracy.

---

## 2. What a good resume looks like

**Structure (single column, reverse chronological):**
- Contact (in body, not header): name, phone, email, city/state, LinkedIn.
- Summary: 2-3 lines, targeted to the role. Mirrors the target title and top requirements.
- Skills: grouped hard skills (languages, tools, platforms). Most JD-relevant first.
- Experience: title, company, dates (consistent format), 3-5 bullets per recent role, fewer for older.
- Education, then optional Projects / Certifications.
- One page under ~10 years experience; two pages acceptable beyond that.
- Standard headings ("Work Experience", "Skills", "Education"). Standard fonts (Arial, Calibri, Georgia, Times), 10-12pt body, 14-16pt headings, standard round/square bullets.

**Bullets (the XYZ formula):** "Accomplished X, as measured by Y, by doing Z." Strong action verb, 1-2 lines, quantified. Only ~26% of candidates quantify anything, so real numbers stand out. Numbers must be real; every AI tool tested fabricates them.

**Anti-AI-tells (recruiters claim they spot these; ~49% auto-reject template-sounding resumes):**
- Overused words: spearheaded, leveraged, pivotal, intricate, showcasing, synergy, delve, realm, robust, orchestrated.
- Em-dash density (3+ on a page is a pattern match).
- Uniform sentence rhythm, vague quantification ("significantly improved"), content that could apply to any company.
- Human-edited AI output is fine. Unedited AI ghostwriting is what gets flagged.

---

## 3. How to tailor well (the craft)

1. **Parse the JD into structured requirements.** Required vs preferred. Hard skills, tools, certifications, soft skills, title, years. Repeated phrases signal importance. Weight each 1-10.
2. **Work from a master inventory, not the last resume.** The best open-source tools store a superset of experience (YAML/JSON) and *select* what fits, rather than rewriting from scratch. Selection can't hallucinate; synthesis can.
3. **Map evidence to requirements.** For each weighted requirement: fully evidenced / partially / missing.
4. **For gaps, ask; never invent.** "The JD needs Kubernetes and your resume doesn't mention it. Have you used it? Where?" Jobscan's Coach and Resume Worded both do this. Answers go into the master inventory.
5. **Rewrite with the JD's vocabulary where truthful.** "CI/CD" vs "continuous integration"; include both acronym and expansion once. Keep the user's voice.
6. **Reorder for the F-pattern.** Most relevant bullets first within each role, most relevant skills first, summary mirrors title + top 3 requirements.
7. **Cut what doesn't serve this role.** Brevity is a scored dimension (Resume Worded).
8. **Target ~75-80% keyword coverage, not 100%.** Jobscan's own guidance: 100% reads stuffed and robotic.
9. **Make every change traceable.** Show the diff and the reason. User approves each change (Jobscan and Resume Worded both use accept/reject cards).

---

## 4. Competitors: what they do well, what to steal, where they fail

| Tool | Unique strength worth borrowing | Weakness |
|---|---|---|
| **Jobscan** | Hard vs soft skill breakdown with JD-frequency vs resume-frequency counts. Detects the company's ATS from the job URL and gives ATS-specific tips. "Predicted skills" (common in similar JDs but absent from this one). Suggestion cards: keep / rewrite / pass. | Opaque score, dated templates, $49.95/mo. |
| **Teal** | Per-bullet AI toggle (opt in per line, not bulk rewrite). JD match view highlighting gaps. Generous free tier. | AI over-indexes on flashy verbs. |
| **Rezi** | Real-time score while editing. 23 audits in 5 categories (Content, Format, Optimization, Best Practices, Application-Ready). Single-column-only templates by design. | Hallucinates metrics ("increased revenue 47%"). |
| **Resume Worded** | Impact / Brevity / Style line-by-line checks. Asks what it needs to know before rewriting; user approves each change. | Critique tool only, no builder. |
| **Enhancv** | "Humanize" pass to strip AI tone. Tailor mode reorders by relevance and cuts irrelevant content. | Visual templates (skill bars, sidebars) are invisible to parsers; ~54% Workday parse rate. |
| **Kickresume** | Big template library, polished visuals. | Two-column defaults tank parse rates (~62% Workday). |
| **Huntr / Simplify / Careerflow** | Job tracking, autofill, LinkedIn optimization. | Out of scope for a local tool. |

**Open source worth studying:**
- **claude-code-job-tailor**: YAML master data validated with Zod; JD agent ranks requirements 1-10; selects existing achievements, never synthesizes; react-pdf templates.
- **cv-claw**: canonical JSON resume + per-job derived versions; Jinja2/CSS templates to HTML then PDF; Claude ingests PDF/image/text into JSON.
- **resume-tailor (abdirisaqosman)**: Next.js + shadcn, pluggable Claude/GPT/Gemini via env var, react-pdf output, pdf-parse + mammoth for ingest.
- **OpenResume**: local-only in browser, has a parser you can run to *see* what an ATS would extract. Great idea for a "parse preview."
- **Reactive Resume** (35k stars) and **JSON Resume**: the de-facto schema for structured resumes. Use it rather than inventing one.

**The universal weakness (the opening for this tool):** every commercial AI bullet writer tested produced fictional numbers, and none verifies claims against the source. A truth-first tailor that only selects, reorders, and rephrases existing facts, and asks about gaps, is genuinely differentiated.

---

## 5. Recommended design (no code yet)

**Principles**
1. Truth-first: select, reorder, rephrase. Never add facts or numbers. Gaps become questions.
2. Transparent: diff + rationale per change, weighted keyword coverage before/after. No fake "ATS score %."
3. Human-in-the-loop: accept/reject per change.
4. ATS-safe by construction: one single-column template, DOCX + text-PDF export, contact in body, standard headings.

**Flow**
1. **Input**: upload resume (PDF/DOCX/TXT) or paste text, paste JD, optional company + target title. Claude reads PDF directly as a document block, so no parsing library is needed for PDFs.
2. **Master profile (first run)**: Claude converts the resume into a JSON Resume-style structure. User can edit it and reuse it across every JD. This is also what gets prompt-cached.
3. **JD analysis**: structured requirements with weights, required/preferred, category, JD frequency.
4. **Coverage check**: each requirement is evidenced / partial / missing. Missing ones generate up to ~5 targeted questions (skippable). Answers merge into the master profile.
5. **Tailor**: structured JSON output with the tailored resume plus a change list (what, why, source pointer). Rules: mirror JD vocabulary, F-pattern ordering, reorder skills, rewrite summary, cut irrelevant, cap AI-tell words, no em-dashes, no new facts.
6. **Review UI**: side-by-side diff, accept/reject, coverage meter before/after, content lint (quantified-bullet %, weak verbs, bullet length, AI-tell count), parse-safety lint.
7. **Export**: DOCX (safest for Taleo/Workday), text-based PDF, plain text. Optional cover letter from the same profile.

**Honest scoring (three separate meters, never one blended "ATS score")**
- Weighted keyword coverage (target band 75-80).
- Parse-safety checklist (structural, deterministic, no LLM needed).
- Content quality lint (Impact / Brevity / Style, Resume Worded-style).

**Claude API notes** (from the claude-api skill, current as of this session)
- Default model `claude-opus-5`; expose a model picker so users with cheaper keys can pick Sonnet/Haiku.
- Structured outputs via `output_config.format` for the JD analysis, coverage, and tailored-resume JSON.
- PDF input as a base64 `document` content block.
- Prompt caching: put the master profile + system rules first, JD last, so re-tailoring for many JDs reuses the cached prefix.
- Streaming for the tailor call (long output).
- Handle `stop_reason: "refusal"` and enable server-side fallbacks if Fable-tier models are selected.

**Stack options (decide before coding)**
- A) Zero-backend: one static HTML page calling the Claude API directly from the browser (Anthropic supports the direct-browser-access header), key in localStorage, DOCX via the `docx` JS library, PDF via print-to-PDF. Smallest possible thing. Only sane because it's local and single-user.
- B) Thin local server (Python FastAPI + python-docx, or Node Express + docx) holding the key, static frontend. Slightly more code, key never touches the browser, easier DOCX/PDF generation.

---

## 6. Block editor ("bounding boxes to edit")

Recommended interpretation: the live preview is built from selectable blocks, not a PDF overlay.

- The document model is the structured JSON. The preview renders it with the single-column template and every node carries its JSON path. Clicking a summary, skill group, job, or bullet outlines that block.
- Per-block actions: edit inline, AI-rewrite this block only (with an optional one-line instruction), accept suggestion / revert to original, move up or down, hide from this version (never deleted from the master profile), insert an unused bullet from the master inventory.
- Per-block signals: matched JD keywords highlighted inline; badges for weak verb, no metric, AI-tell word, over two lines; a relevance tint per block.
- Page-break marker at letter-size so the user sees what lands on page one.
- Undo/redo by snapshotting the JSON.
- The preview template and the export template are the same thing, so what you see is what you get in PDF and DOCX.

Deferred: bounding boxes drawn over the original uploaded PDF to correct parsing. pdf.js exposes text coordinates so it is possible, but a side-by-side "here is what I extracted, fix it" review screen gets most of the value for a fraction of the work.

---

## 7. Role profiles for data / ML roles

JDs are often generic or mislabeled. A per-role profile encodes what hiring managers for that role actually screen for, so the tailor can classify requirements, add "predicted" skills the JD forgot, ask role-aware gap questions, and lint for role-specific red flags. Five small data files, one generic loader.

Each profile holds: title aliases, a skill taxonomy grouped by category with aliases (Airflow / Apache Airflow, K8s / Kubernetes), signature metrics with the question to ask when a bullet lacks one, red flags, and section priorities.

| Role | What gets screened for | Signature metrics | Red flags |
|---|---|---|---|
| **Data Engineer** | Orchestration (Airflow, Dagster, Prefect), compute (Spark, Flink, SQL engines), warehouse/lakehouse (Snowflake, BigQuery, Redshift, Databricks, Iceberg/Delta), streaming (Kafka, Kinesis), transformation (dbt), reliability (data quality, SLAs, observability, data contracts), cloud + IaC, cost/FinOps | Volume per day, freshness/latency, pipeline SLA %, incidents reduced, cost saved, number of sources/pipelines | Hadoop-era tools as headline skills (Hive, Oozie, MapReduce); 12+ tools in the summary; analyst dashboard vocabulary; "worked with data" |
| **Data Scientist** | Statistics, experimentation (A/B, causal inference), modeling (sklearn, XGBoost, forecasting), SQL, Python/R, communication, business framing | Lift, revenue/retention impact, model metric vs a named baseline (AUC, F1, not "accuracy"), experiment velocity | Metric with no baseline; all modeling and no business outcome; reads like an MLE resume when the JD is analytical |
| **ML Engineer** | Production: Docker, Kubernetes, model serving (Triton, TorchServe, Ray Serve, vLLM), MLOps (MLflow, feature stores, registries, Kubeflow, SageMaker, Vertex), monitoring (drift, Prometheus, Grafana, Arize), CI/CD, PyTorch/TF | Predictions per day, p99 latency, uptime, inference cost, training cost, model metric with production context | Offline accuracy with no production context; resume reads as "analysis" so it gets filtered as a data scientist |
| **AI Engineer (GenAI)** | RAG (vector DBs, hybrid retrieval, reranking, chunking, embeddings), agents/orchestration (LangGraph, LangChain, LlamaIndex, tool calling, MCP, structured outputs), fine-tuning (LoRA/PEFT), serving (vLLM, quantization), evals and observability (Ragas, Langfuse, LLM-as-judge), guardrails, cost/latency per call | Retrieval quality (NDCG, recall@k), eval pass rate, hallucination rate reduction, regressions caught, latency and cost per query | No evals mentioned; "built a chatbot" with no metric or baseline; framework name-dropping with no system detail |
| **Data Analyst** | SQL first, a named BI tool (Tableau, Power BI, Looker), Python/R, Excel, dashboards with adoption, domain specialization (healthcare claims, fintech, etc.) | Who used the dashboard and how many, what decision changed, revenue/cost/time effect, query or report time cut | "Worked on dashboards"; overstated Python mastery; reads like theoretical data science for an analyst role |

Cross-cutting rules for this family:
- Title alignment matters: Analytics Engineer sits between DE and DA; Applied Scientist, MLOps Engineer, LLM Engineer, BI Analyst, Product Analyst are common aliases. Suggest a headline that matches the JD title when the experience genuinely supports it.
- The analyzer should detect JD shape, not just title. A "Data Scientist" JD that asks for Kubernetes and model serving is MLE-shaped; tailor to the shape.
- Projects carry more weight here than in most fields, especially early career and AI Engineer. Hierarchy: full-time > internship > personal project > nothing. Copied Kaggle tutorials are a known red flag; a README that walks problem to outcome is what managers look for. Keep a GitHub link.
- Every metric bullet should carry metric + baseline + business translation.
- The master profile should tag each bullet with taxonomy categories so one inventory can tilt toward DE, DS, MLE, AI, or DA.

Role sources:
- [Jobscan: Data engineer resume examples](https://www.jobscan.co/resume-examples/business-data/data-engineer-resume)
- [ResumeAtlas: Data engineer keywords 2026](https://resumeatlas.io/data-engineer-resume-keywords)
- [Resume Worded: Data engineer skills](https://resumeworded.com/skills-and-keywords/data-engineer-skills)
- [Foundrole: AI vs ML engineer vs data scientist](https://www.foundrole.com/blog/ai-engineer-vs-ml-engineer-vs-data-scientist-which-career-path-pays-more)
- [ResumeAdapter: ML engineer keywords 2026](https://www.resumeadapter.com/blog/machine-learning-engineer-resume-keywords)
- [TechieCV: MLOps engineer resume guide](https://www.techiecv.com/resume-guides/mlops-engineer-resume)
- [KORE1: Hiring an MLOps engineer 2026](https://www.kore1.com/how-to-hire-mlops-engineer-2026/)
- [MirrorCV: AI engineer resume guide 2026](https://mirrorcv.com/resume-guide/ai-ml-engineer)
- [LevStack: AI engineer resume 2026](https://levstack.io/en/blog/ai-engineer-resume-2026/)
- [ResumeAdapter: AI engineer keywords](https://www.resumeadapter.com/blog/ai-engineer-resume-keywords)
- [Jobright: Data analyst job strategy 2026](https://jobright.ai/blog/data-analyst-jobs-2026/)
- [Resume Worded: SQL data analyst examples](https://resumeworded.com/sql-data-analyst-resume-example)
- [Built In: Data science portfolios](https://builtin.com/data-science/data-science-portfolios)
- [Blind: GitHub as portfolio](https://www.teamblind.com/post/importance-of-personal-github-repo-to-hiring-managers-anqhthya)

---

## 8. Australia / Melbourne conventions (overrides earlier US assumptions)

**Document conventions**
- Length: 2 pages is standard, 3 acceptable for senior, technical, or government roles. The US one-page rule does not apply. Page-break markers at pages 1 and 2, and a warning past page 3.
- Paper size: A4, not US Letter. Applies to the print CSS and the DOCX page setup.
- Section order: header (name, city + state, phone, email, LinkedIn, work-rights line), professional summary of 3 to 4 lines, key skills as a flat list mirroring the ad's wording, experience with MM/YYYY dates and 3 to 6 achievement bullets per role, education and certifications, optional referees.
- Work rights: state plainly near the contact details ("Australian citizen", "Permanent resident", "Valid working visa with full working rights"). Pre-empts screening filters. Make it a profile setting the template inserts.
- Referees: "Referees available on request" is standard. Two named referees acceptable for senior roles.
- Exclude photo, date of birth, marital status. Recruiters discard resumes that include them.
- Australian English spelling: organise, specialise, optimise, analyse, colour, centre. Mirror the ad's spelling because keyword matching is literal. Add an en-AU lint that flags US spellings unless the ad itself uses them.
- Phone as +61 4xx xxx xxx or 04xx xxx xxx. Full dates as DD/MM/YYYY.

**Application conventions**
- Cover letters matter more than in the US: most Australian recruiters prefer one, one page, 250 to 400 words, direct and conversational, no corporate polish. Moves the cover letter generator into scope.
- Key Selection Criteria (KSC): Victorian Government and many large employers require a separate document answering each criterion in order, criterion as heading, STAR format (Situation, Task, Action, Result). The resume carries the headline, the KSC carries the full story. Natural phase-2 feature from the same master profile: no US tool does this.
- SEEK is the dominant board. Applications forward to the employer's own ATS, SEEK also runs its own matching score of profile plus CV against the ad, and SEEK screening questions act as knockout filters.
- LinkedIn is used by recruiters to source proactively by keyword. Resume is still the entry ticket.

**ATS landscape in Australia**
- Workday: banks, mining, telcos, large retail, aviation.
- SAP SuccessFactors: parts of retail and mining.
- PageUp (Australian-born): Victorian, NSW and Queensland government, most universities.
- JobAdder (Australian-born) and Bullhorn: recruitment agencies. Hays, Randstad, Robert Walters and the rest run on these. Agencies are a large share of the Melbourne data market. Agency ATSs keep the parsed resume in a searchable candidate database for months, so keyword coverage pays beyond the single application.
- Greenhouse and Lever: startups and SaaS.
- Oracle Taleo: older enterprise deployments.

**Melbourne data market weighting for role profiles**
- Listings most often ask for Databricks, Power BI, Python, SQL, Spark, AWS Glue. Azure is heavily present in enterprise. Banks are running Hadoop-to-AWS/Snowflake migration programs. Snowflake and dbt experience lifts pay.
- Weight Azure, Databricks and Power BI higher than US-centric guides suggest, and treat Hadoop-migration experience as a positive framing rather than a legacy red flag.

Australia sources:
- [ATS Verification: Australian resume format 2026](https://atsverification.com/blog/australian-resume-format-2026/)
- [ATS Verification: ATS checker for Australia](https://atsverification.com/for/australia/)
- [JobSparrow: Australian resume checklist 2026](https://jobsparrow.ai/blog/australian-resume-format-2026-the-ultimate-ats-friendly-checklist-guide)
- [ResumeAdapter: ATS resume Australia](https://www.resumeadapter.com/blog/ats-resume-australia)
- [Sentrient: Best ATS in Australia 2026](https://www.sentrient.com.au/blog/applicant-tracking-systems)
- [Hirex: Best ATS for Australian employers](https://gethirex.com/blog/best-ats-software-for-australian-employers)
- [The Resume Writers: Is the ATS blocking your resume](https://theresumewriters.com.au/how-ats-affects-your-resume/)
- [Resumes To Impress: Victorian Government selection criteria FAQ](https://www.resumestoimpress.com.au/career-resources/victorian-government-selection-criteria-faqs-2025-guide/)
- [The Resume Writers: VPS selection criteria examples](https://theresumewriters.com.au/victorian-vps-selection-criteria-examples-vps2-to-vps6/)
- [StylingCV: Australia cover letter 2026](https://stylingcv.com/blog/australia-cover-letter-2026-complete-guide-with-templates-for-seek-indeed-australia-linkedin/)
- [Merlins Group: Australian cover letter format 2026](https://www.merlinsgroup.com.au/australian-cover-letter-format-2026)
- [Cloud Colleague: LinkedIn vs resume for Australian recruiters](https://cloudcolleague.com/blogs/resume-tips/linkedin-profile-vs-resume/)
- [Built In Melbourne: Data engineer jobs](https://builtinmelbourne.com/jobs/data-analytics/search/data-engineer)
- [Big Wave Digital: Data engineer salary guide Australia 2026](https://bigwavedigital.com.au/data-engineer-salary-guide-australia-2026/)

---

## 9. Persistence without a server

**What must persist:** settings (model, effort, remember-key flag), the master profile, one record per job (company, title, detected role, JD text, analysis, coverage, gap answers, tailored JSON, per-block accept/reject/edit decisions, status, timestamps), and which job was open last. Undo history stays in memory only.

**Three layers, all writing the same `workspace` JSON with a `schemaVersion` field:**
1. **localStorage autosave.** Debounced write on every change. Restores instantly on next open. A profile plus dozens of jobs is well under a megabyte against a ~5 MB budget. This is the crash buffer, not the archive: it is tied to one browser and cleared with site data.
2. **Workspace folder** via the File System Access API (Chrome and Edge only). The user picks a folder once; the app writes `profile.json`, `settings.json`, and `jobs/<company>-<title>.json`. The folder handle is stored in IndexedDB (handles serialise there, not in localStorage). Next launch, one click on "Reopen workspace" calls `requestPermission()`; Chrome 122+ remembers the grant, so it is usually silent. Plain files mean the user can back up, git-commit, or hand-edit.
3. **Export / import `workspace.json`** as the universal fallback for Firefox and Safari and for moving between machines.

Source of truth when both exist: the folder, with localStorage as the buffer. Per record, last write wins by `updatedAt`.

**API key handling.** Default: memory plus sessionStorage, so a reload keeps it and closing the tab drops it. "Remember on this device" opt-in writes it to localStorage. Never written into the workspace folder, so the folder is safe to back up or share. Caveat: when a page is opened as a `file://` URL, Chrome puts every local HTML file on the same origin, so any other local page could read that localStorage.

**How the app is served.** Two ways to open it, both zero-backend:
- Double-click `index.html`. Works if scripts are classic (not ES modules, which Chrome blocks on `file://`) and libraries come from CDN script tags. Shares the `file://` origin caveat above.
- A one-line static file server (`python -m http.server` or `npx serve`) gives a stable `http://localhost` origin, isolates storage, and allows ES modules. Not a backend; it only serves files. Recommended default in the README.

**Direct browser calls to the Claude API.** Supported with the request header `anthropic-dangerous-direct-browser-access: true`. The "dangerous" is about embedding a shared key in public sites; bring-your-own-key on a local page is the sanctioned use. Verify in the first build that it works from both `file://` (Origin: null) and `http://localhost`.

**Resume-where-you-left-off UX.** On launch: restore the workspace, show a card with the last job, its date, and how many blocks are still pending review, with a Continue button, plus the job list with statuses. If a workspace folder was previously connected, show "Reopen workspace" instead of a fresh-start prompt.

Storage sources:
- [Chrome: Persistent permissions for the File System Access API](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
- [Chrome: File System Access API guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [MDN: File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
- [Simon Willison: Claude API CORS support](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/)
- [DEV: Calling the Anthropic API directly from the browser](https://dev.to/sendotltd/calling-the-anthropic-api-directly-from-the-browser-a-150-line-byok-comparison-tool-for-opus--nh)

---

## 10. Decisions locked (round 3)

- **Work rights line: optional toggle, off by default.** It can invite discrimination. SEEK screening questions and graduate-program forms ask for work rights anyway, so leaving it off the resume costs nothing. Overrides the section 8 default.
- **Page target is a setting, default 1 page** for entry/junior level. The 2-page standard in section 8 applies to mid and senior; the setting can raise it.
- **Cover letter generator is in scope**, built from the same JD analysis and master profile.
- **JD input by paste or URL.** A zero-backend page cannot fetch SEEK or LinkedIn itself (CORS). Use Claude's server-side web fetch tool: the URL goes into the message and Claude reads the page on Anthropic's side. Paste stays the guaranteed path. Expect LinkedIn (login wall) and some JS-rendered Workday/PageUp pages to fail; verify SEEK, Indeed, Prosple and plain company pages in build 1.
- **Serving: `python -m http.server 8080` is the documented path.** Double-click stays as a fallback.

---

## 11. Entry-level and graduate specifics (Australia)

- **Summary must be specific, not aspirational.** "Data analyst graduate with Python and SQL, including a churn analysis on 40,000 records" beats "motivated self-starter eager to grow".
- **Section order for junior:** header, summary, key skills, projects, education, experience, certifications. Projects go above experience when experience is thin; the tailor decides by comparing relevance scores per section.
- **Education carries more weight:** degree, institution, graduation year, grade if favourable (distinction average or equivalent), and relevant subjects (statistics, databases, programming) as keyword carriers.
- **Projects:** problem, tools, findings, outcome. One portfolio or GitHub link in the header instead of per-project links.
- **Casual and part-time work** stays in, reframed for transferable evidence (data handling, reporting, stakeholder communication), trimmed to one or two bullets.
- **Graduate programs** (Prosple, SEEK Grad formerly GradConnection, bank and Big 4 and Victorian Government programs) mostly run on online forms, psychometric tests and video interviews with the resume uploaded alongside. Windows cluster in February to April for the following year. Citizenship or PR requirements vary by employer: many government programs require it, some firms accept 485 visa holders with full work rights. The form asks, so the resume does not need to.
- **Cover letter for junior Australian roles:** one page, 250 to 400 words, first person, direct. Four short paragraphs: the role and one line on why this company drawn from the ad, then two or three ad requirements each mapped to concrete evidence (projects, subjects, internships), then availability and a plain ask. Address by name if the ad gives one, otherwise "Dear Hiring Manager". Same no-new-facts rule; company facts only from the ad or user-pasted notes.

Sources:
- [Indeed Australia: Data analyst resume](https://au.indeed.com/career-advice/resumes-cover-letters/data-analyst-resume)
- [Career FAQs: Data analyst resume Australia](https://www.careerfaqs.com.au/careers/resumes-cover-letters/data-analyst-resume-example-template-how-to-write-one-in-australia)
- [Workopia: Data analyst resume structure](https://workopia.io/career-advice/resume-examples/data-analyst-resume)
- [Prosple: Graduate data analyst programs Melbourne](https://au.prosple.com/graduate-data-analyst-jobs-programs-in-melbourne-australia)
- [SEEK Grad: Data science and analytics graduate jobs](https://au.gradconnection.com/graduate-jobs/data-science-and-analytics/sydney/)
- [Ketan Shetye: Companies hiring 485 visa graduates](https://ketanai.dev/blog/companies-hiring-485-visa-graduates-australia/)

---

## 12. Left to explore before coding

**Bryan gathers**
1. Current resume, PDF preferred. DOCX needs an extra converter library in the browser.
2. 10 to 15 real Melbourne job ads across the five roles, saved as text plus URL. These become test fixtures and validate the role taxonomies.
3. A full inventory of projects, subjects, and work with real numbers (records, rows, runtime, users, marks). Seeds the master profile and is the only real defence against fabricated metrics.
4. An Anthropic API key with credit, and a default model choice.

**Design to settle, no code**
5. Master profile schema: JSON Resume base plus AU fields (work-rights toggle, referees line, portfolio link), taxonomy tags per bullet, and the change-list schema the tailor returns.
6. Role profile contents for the five roles with Melbourne weighting, checked against the fixtures from item 2.
7. Truthfulness guard: a deterministic check that every number in the output appears in the profile or gap answers, plus an optional cheap judge call mapping each output claim to a source bullet.
8. Exact rubric lists: parse-safety checks, content lint (weak-verb list, AI-tell list, en-AU spelling list), coverage weighting.
9. Screen flow: Setup (key, model, profile), Job workspace (JD in, analysis, gaps, block editor), Exports (resume, cover letter). A mockup is optional.
10. An eval set so a prompt change can be measured rather than eyeballed.

**Verify in build 1**
11. Browser-direct Claude API calls from localhost.
12. Web fetch on SEEK, Indeed, Prosple, LinkedIn, Workday and PageUp job URLs.
13. Chrome print-to-PDF output extracts cleanly in reading order (pdf.js in-browser parse preview, optionally a Jobscan free scan).
14. In-browser DOCX generation, A4, single column.
15. Workspace folder reconnect flow.
16. Measured cost per tailor run.

**Rough cost per tailor run** (profile + JD + rules ~4k input, ~2k output, before caching)

| Model | Input $/MTok | Output $/MTok | Per run |
|---|---|---|---|
| Opus 5 | 5 | 25 | ~$0.07 |
| Sonnet 5 | 2 | 10 | ~$0.03 |
| Haiku 4.5 | 1 | 5 | ~$0.01 |

**Phase 2 candidates:** Key Selection Criteria generator, SEEK/LinkedIn keyword list export, PDF-overlay parse correction, interview prep from the gap list.

---

## 13. Decisions locked (round 4) and remaining defaults

**Locked**
- PDF only. Input: PDF upload (sent to Claude as a document block) or pasted text. Output: PDF. No DOCX anywhere. Trade-off accepted: Taleo and agency systems prefer DOCX but parse text-based PDFs.
- No URL input. JD is pasted text only. Drops the web fetch dependency entirely.
- Cover letter is a separate feature: own screen, own action, own record, own PDF. It may pick a saved job (reusing that job's analysis and tailored resume for consistency) or take a freshly pasted JD. Not part of the tailor run.

**Remaining decisions, with defaults (override if wanted)**
1. **PDF export = browser print-to-PDF with print CSS.** Zero dependencies, text-based, fonts embedded by Chrome, and the preview is literally the export. `@page { size: A4; margin: 0 }` with inner padding suppresses Chrome's header/footer text. Fallback if the print dialog proves annoying: pdfmake from CDN, rendered from the same JSON.
2. **Font: Arial.** Present on every machine, parses everywhere, boring on purpose. Swap for a Google font later if wanted; Chrome embeds it in the PDF.
3. **Calls per job: two, plus deterministic checks.** Call 1 returns JD analysis, coverage map, and gap questions in one structured response. Call 2 tailors after answers. Lint (parse safety, spelling, AI-tells, weak verbs, numbers) runs in JavaScript for free. Optional call 3 is the claim-to-source judge.
4. **Every tailored bullet carries `source_refs`** pointing at profile bullets or gap answers. No source means a red flag in the editor. Plus a regex check that every number in the output exists in the profile or answers.
5. **Keyword coverage is computed in JavaScript,** with alias expansion from the role profile (K8s = Kubernetes). Claude supplies the semantic "evidenced by" mapping. Two signals, shown separately.
6. **One-page enforcement is measured, not promised.** The preview measures rendered height against A4. Overflow shows a line; the user hides blocks, or presses "trim to fit", which asks Claude to shorten the lowest-relevance bullets to a character budget.
7. **Re-tailoring respects decisions.** The tailor takes profile + JD + current tailored version + accepted/rejected decisions, so accepted edits are never overwritten.
8. **Career stage is a profile setting** (student / graduate / junior / mid / senior, default junior). It drives section order, summary style, and page target.
9. **Gap answers become tagged profile bullets** ("from gap answer, job X") so the next job benefits.
10. **Profile bootstrap normalises** dates to MM/YYYY and phone to +61 format.
11. **Prompt caching skipped in v1.** A one-page profile plus rules sits near the minimum cacheable prefix for Opus, so the win is uncertain. Add when measured.
12. **Errors:** rate limit and overloaded get a retry with backoff; a refusal stop reason shows a plain message.

**Still needed from Bryan before coding starts**
- Current resume as PDF.
- 10 to 15 pasted Melbourne job ads across the five roles.
- Project and experience inventory with real numbers.
- API key with credit; default model (Opus 5 unless told otherwise).

**Build order**
1. Skeleton: static page, settings, key handling, workspace persistence (localStorage, folder, export/import).
2. Profile bootstrap: PDF or text in, structured profile out, parse-review screen using the block editor.
3. Job workspace: paste JD, role detection, analysis, coverage, gap questions.
4. Tailor: structured output, block editor with accept/reject, lint, coverage meter, page measurement.
5. PDF export via print CSS, then verify text extraction order with pdf.js in-browser.
6. Cover letter screen.
7. Role profile data files for the five roles, tuned against the fixtures.

---

## Sources

- [Jobscan: Can ATS detect AI resumes (2026)](https://www.jobscan.co/blog/can-ats-detect-ai-resume/)
- [ApplyMate: How Workday, Taleo, Greenhouse read your resume](https://apply-mate.com/blog/workday-taleo-greenhouse-ats)
- [Careery: Get past ATS in 2026](https://careery.pro/blog/resume-applications/how-to-get-resume-past-ats)
- [Resume Optimizer Pro: ATS best practices 2026](https://resumeoptimizerpro.com/blog/ats-friendly-resume-tips)
- [Resume Optimizer Pro: Greenhouse parser guide](https://resumeoptimizerpro.com/blog/greenhouse-ats-resume-guide)
- [FastApply: ATS format guide 2026](https://blog.fastapply.co/ats-resume-format-guide-2026)
- [Jobscan: ATS-friendly resume checklist](https://www.jobscan.co/blog/20-ats-friendly-resume-templates/)
- [scale.jobs: Optimize for ATS 2026](https://scale.jobs/blog/optimize-resume-for-ats-2026-guide)
- [JobWizard: ATS fonts, columns, layouts](https://jobwizard.ai/blog/how-to-optimize-your-resume-for-ats-systems-in-2026-872842)
- [Indeed: Tailoring your resume](https://www.indeed.com/career-advice/resumes-cover-letters/tailoring-resume)
- [Cake: How to tailor resume to JD](https://www.cake.me/resources/resume/how-to-tailor-resume-to-job-description)
- [Teal: How to tailor your resume](https://www.tealhq.com/post/how-to-tailor-your-resume-to-a-job)
- [ATS Verification: AI resume builders tested 2026](https://atsverification.com/blog/ai-resume-builders-tested-2026/)
- [Jobscan: Best AI resume builders 2026](https://www.jobscan.co/blog/best-ai-resume-builders/)
- [Jobscan: What match rate to aim for](https://www.jobscan.co/blog/what-jobscan-match-rate-should-i-aim-for/)
- [JobShinobi: Jobscan keywords guide](https://www.jobshinobi.com/blog/jobscan-resume-scanner-keywords-guide)
- [Resume Worded: Score guide](https://resumeworded.com/score-guide)
- [Rezi: The Rezi Score explained](https://www.rezi.ai/rezi-docs/the-rezi-score-explained)
- [Enhancv: Humanize your AI resume](https://enhancv.com/features/humanize-your-ai-resume/)
- [Enhancv: Tailor to JD](https://enhancv.com/features/tailor-resume-to-job-description/)
- [Enhancv: Signs of an AI-generated resume](https://enhancv.com/blog/signs-of-ai-generated-resume/)
- [Hirelytica: AI CV red flags 2026](https://hirelytica.com/blog/ai-cv-red-flags-recruiter-detection-2026)
- [KraftCV: Do hiring managers reject AI resumes](https://www.kraftcv.com/blog/ai-resumes-2026-what-hiring-managers-think)
- [Pin: How AI job matching works](https://www.pin.com/blog/ai-job-matching-explained/)
- [Pin: Semantic search in recruitment](https://www.pin.com/blog/semantic-search-recruitment/)
- [Zythr: Eightfold + Greenhouse scoring](https://zythr.com/resources/the-best-greenhouse-ats-integrations-a-practical-guide/eightfold-ai-ats-integration-guide)
- [HR Dive: Eye-tracking, 7 seconds](https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/541582/)
- [The Ladders eye-tracking study (PDF)](https://www.theladders.com/static/images/basicSite/pdfs/TheLadders-EyeTracking-StudyC2.pdf)
- [A4CV: The 6-second scan](https://a4cv.app/blog/six-second-resume-scan-eye-tracking-reveals-what-recruiters-see/)
- [Resume.io: XYZ format](https://resume.io/blog/xyz-resume-format)
- [StylingCV: Google XYZ method](https://stylingcv.com/blog/google-xyz-resume-method-how-to-write-bullet-points-that-get-you-hired-2026-guide/)
- [Wonsulting: Quantifiable results](https://www.wonsulting.com/job-search-hub/the-power-of-quantifiable-results-how-to-use-the-xyz-formula-to-supercharge-your-resume)
- [GitHub: claude-code-job-tailor](https://github.com/javiera-vasquez/claude-code-job-tailor)
- [GitHub: cv-claw](https://github.com/farhan0167/cv-claw)
- [GitHub: resume-tailor](https://github.com/abdirisaqosman/resume-tailor)
- [GitHub: open-resume](https://github.com/xitanggg/open-resume)
- [DEV: 5 open-source resume builders 2026](https://dev.to/srbhr/5-open-source-resume-builders-thatll-help-get-you-hired-in-2026-1b92)
- [Himalayas: Careerflow alternatives](https://himalayas.app/advice/careerflow-alternatives)
- [Huntr vs Enhancv](https://huntr.co/blog/huntr-vs-enhancv)
