/* Dev harness: exercises the same request builders the browser uses, so the
   prompts can be iterated without clicking through the UI.

   Usage:
     node tools/run.mjs extract "Bryan Ho - Resume.pdf" [model] [effort]
     node tools/run.mjs analyse Junior_Data_Analyst_ad.txt [model] [effort]
     node tools/run.mjs tailor Junior_Data_Analyst_ad.txt [model] [effort]
     node tools/run.mjs cost

   Every run appends what it spent to fixtures/spend.json, because the budget
   here is someone's real money and "roughly a few cents" is not a ledger. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Claude = require('../claude.js');
const Prompts = require('../prompts.js');
const Core = require('../core.js');

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'fixtures');
const LEDGER = path.join(OUT, 'spend.json');

function env(name) {
  const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim();
  }
  throw new Error(`${name} not found in .env`);
}

function ledger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return { runs: [], total: 0 }; }
}

function record(label, model, usage) {
  const l = ledger();
  const spent = Claude.cost(model, usage);
  l.runs.push({
    at: new Date().toISOString(), label, model,
    input: usage.input_tokens, output: usage.output_tokens,
    cost: Number(spent.toFixed(5))
  });
  l.total = Number(l.runs.reduce((s, r) => s + r.cost, 0).toFixed(5));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2));
  return l;
}

function save(name, data) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return path.relative(ROOT, file);
}

const [, , command, arg, modelArg, effortArg] = process.argv;
const model = modelArg || 'claude-opus-5';
const effort = effortArg || 'high';

if (command === 'cost') {
  const l = ledger();
  console.log(`${l.runs.length} runs, ${Claude.money(l.total)} spent\n`);
  for (const r of l.runs) {
    console.log(`  ${r.at.slice(11, 19)}  ${r.label.padEnd(22)} ${r.model.padEnd(18)} ` +
      `${String(r.input).padStart(6)} in ${String(r.output).padStart(6)} out  ${Claude.money(r.cost)}`);
  }
  process.exit(0);
}

const key = env('CLAUDE_API_KEY');

if (command === 'extract') {
  const pdfPath = path.join(ROOT, arg);
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  const body = Claude.extractRequest({
    prompts: Prompts, model, effort, pdfBase64, careerStage: 'junior'
  });

  const estimated = await Claude.countTokens(key, body);
  console.log(`input ${estimated} tokens (counted free) · ${model} · effort ${effort}`);
  console.log('calling...');

  const t0 = Date.now();
  const message = await Claude.send(key, body);
  const profile = Claude.readJson(message);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  const file = save('extract.json', profile);
  const l = record(`extract ${effort}`, model, message.usage);

  console.log(`\ndone in ${seconds}s · in ${message.usage.input_tokens} out ${message.usage.output_tokens}` +
    ` · ${Claude.money(Claude.cost(model, message.usage))} · running total ${Claude.money(l.total)}`);
  console.log(`saved ${file}\n`);

  const bullets = profile.sections.flatMap(s => s.items.flatMap(i => i.bullets));
  console.log(`${profile.sections.length} sections, ${bullets.length} bullets, ` +
    `${profile.skills.length} skill groups, ${profile.parseReview.length} parse-review items`);
  console.log(`numbers captured: ${bullets.reduce((n, b) => n + b.numbers.length, 0)}`);
  process.exit(0);
}

if (command === 'analyse') {
  const profile = JSON.parse(fs.readFileSync(path.join(OUT, 'extract.json'), 'utf8'));
  const adText = fs.readFileSync(path.join(ROOT, arg), 'utf8');

  // Mirror how the browser will hand the inventory over: stable ids, one per line.
  let n = 0;
  const lines = [];
  for (const section of profile.sections) {
    for (const item of section.items) {
      for (const bullet of item.bullets) {
        lines.push(`b${++n}: [${section.kind} · ${item.heading}] ${bullet.text}`);
      }
    }
  }
  const skills = profile.skills.map(g => `${g.group}: ${g.items.join(', ')}`).join('\n');

  const body = Claude.analyseRequest({
    prompts: Prompts, model, effort, inventory: lines.join('\n'), skills, adText
  });

  const estimated = await Claude.countTokens(key, body);
  console.log(`input ${estimated} tokens (counted free) · ${model} · effort ${effort}`);
  console.log('calling...');

  const t0 = Date.now();
  const message = await Claude.send(key, body);
  const analysis = Claude.readJson(message);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  const file = save(`analyse-${path.basename(arg, '.txt')}.json`, analysis);
  const l = record(`analyse ${path.basename(arg, '.txt').slice(0, 14)}`, model, message.usage);

  console.log(`\ndone in ${seconds}s · in ${message.usage.input_tokens} out ${message.usage.output_tokens}` +
    ` · ${Claude.money(Claude.cost(model, message.usage))} · running total ${Claude.money(l.total)}`);
  console.log(`saved ${file}\n`);

  console.log(`role ${analysis.role} · ${analysis.shape}`);
  console.log(`${analysis.requirements.length} requirements, ${analysis.gaps.length} gap questions, ` +
    `${analysis.adInstructions.length} ad instructions`);
  const by = s => analysis.requirements.filter(r => r.status === s).length;
  console.log(`evidenced ${by('evidenced')} · partial ${by('partial')} · missing ${by('missing')}`);
  process.exit(0);
}

if (command === 'tailor') {
  // Builds the same request the browser would from the saved fixtures:
  // extract.json for the profile, analyse-<ad>.json for the requirements.
  const extracted = JSON.parse(fs.readFileSync(path.join(OUT, 'extract.json'), 'utf8'));
  const profile = Core.buildProfile(extracted, { type: 'pdf', filename: 'fixture' });
  const adName = path.basename(arg, '.txt');
  const analysis = JSON.parse(fs.readFileSync(path.join(OUT, `analyse-${adName}.json`), 'utf8'));
  const adText = fs.readFileSync(path.join(ROOT, arg), 'utf8');
  const settings = Core.defaultSettings();
  const requirements = analysis.requirements.map((r, i) => ({ id: `r${i + 1}`, ...r }));
  const doc = Core.buildDoc(profile, Core.newTailored(), settings);

  const body = Claude.tailorRequest({
    prompts: Prompts, model, effort,
    careerStage: settings.careerStage, pageTarget: settings.pageTarget,
    currentLines: Core.estimateLines(doc),
    role: analysis.role, shape: analysis.shape, title: adName.replace(/_/g, ' '), company: '',
    requirements,
    outline: Core.outlineForModel(profile),
    inventory: Core.inventoryLines(profile),
    skills: Core.skillLines(profile),
    summary: profile.summary,
    locked: [], rejected: [], trimLines: 0, adText
  });

  const estimated = await Claude.countTokens(key, body);
  console.log(`input ${estimated} tokens (counted free) · ${model} · effort ${effort} · doc ~${Core.estimateLines(doc)} lines`);
  console.log('calling...');

  const t0 = Date.now();
  const message = await Claude.send(key, body);
  const result = Claude.readJson(message);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  const file = save(`tailor-${adName}.json`, result);
  const l = record(`tailor ${adName.slice(0, 14)}`, model, message.usage);
  console.log(`\ndone in ${seconds}s · in ${message.usage.input_tokens} out ${message.usage.output_tokens}` +
    ` · ${Claude.money(Claude.cost(model, message.usage))} · running total ${Claude.money(l.total)}`);
  console.log(`saved ${file}\n`);

  const changes = Core.normaliseChanges(result.changes, profile, []);
  console.log(`note: ${result.note}`);
  console.log(`${result.changes.length} changes returned, ${changes.length} applicable`);
  const known = Core.profileNumbers(profile);
  const tailored = { changes };
  const after = Core.buildDoc(profile, tailored, settings);
  for (const c of changes) {
    const text = c.kind === 'skills-order' ? c.list.join(' · ') : (c.kind === 'reorder' ? c.list.join(', ') : c.suggested);
    const nc = c.kind === 'skills-order' ? Core.unknownSkills(c.list, profile) : c.kind === 'reorder' ? [] : Core.numbersCheck(text, known).unmatched;
    console.log(`\n${c.id} ${c.kind} ${c.target.itemId || ''} ${c.target.bulletId || ''}` +
      `${nc.length ? '  !! unsourced: ' + nc.join(', ') : ''}\n  ${text}\n  why: ${c.why}\n  sources: ${c.sources.map(s => s.type + ':' + s.id).join(' ')}`);
  }
  const hits = Core.keywordHits(Core.docText(after), requirements);
  const before = Core.keywordHits(Core.docText(doc), requirements);
  console.log(`\nkeyword coverage ${Math.round(before.coverage * 100)}% → ${Math.round(hits.coverage * 100)}% ` +
    `· lines ~${Core.estimateLines(doc)} → ~${Core.estimateLines(after)} · lint flags ${Core.lintDoc(after, adText).length}`);
  process.exit(0);
}

console.log('commands: extract <pdf> | analyse <ad.txt> | tailor <ad.txt> | cost');
process.exit(1);
