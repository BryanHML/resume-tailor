/* Checks for core.js — the workspace merge is the one place a bug silently eats
   the user's work, so it gets a runnable test. Run: node test.js */
'use strict';

var assert = require('assert');
var RT = require('./core.js');

function test(name, fn) {
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (err) {
    console.error('  FAIL ' + name + '\n       ' + err.message);
    process.exitCode = 1;
  }
}

function job(id, updatedAt, extra) {
  return Object.assign({ id: id, title: id, updatedAt: updatedAt }, extra || {});
}

console.log('core.js');

test('defaults are the locked ones: Opus 5, high effort, junior, one page', function () {
  var s = RT.defaultWorkspace().settings;
  assert.strictEqual(s.model, 'claude-opus-5');
  assert.strictEqual(s.effort, 'high');
  assert.strictEqual(s.careerStage, 'junior');
  assert.strictEqual(s.pageTarget, 1);
  assert.strictEqual(s.workRightsLine, false, 'work-rights line is off by default');
  assert.strictEqual(s.refereesLine, true);
});

test('migrate survives garbage input', function () {
  [null, undefined, 42, 'nope', []].forEach(function (bad) {
    var ws = RT.migrate(bad);
    assert.strictEqual(ws.schemaVersion, RT.SCHEMA_VERSION);
    assert.deepStrictEqual(ws.jobs, []);
    assert.strictEqual(ws.profile, null);
  });
});

test('migrate keeps good settings and replaces impossible ones', function () {
  var ws = RT.migrate({
    settings: {
      model: 'claude-sonnet-5',
      effort: 'banana',
      careerStage: 'wizard',
      pageTarget: '9',
      refereesLine: false,
      workRightsText: 'Australian citizen'
    }
  });
  assert.strictEqual(ws.settings.model, 'claude-sonnet-5', 'a valid choice is kept');
  assert.strictEqual(ws.settings.effort, 'high', 'a bad effort falls back');
  assert.strictEqual(ws.settings.careerStage, 'junior', 'a bad stage falls back');
  assert.strictEqual(ws.settings.pageTarget, 3, 'page target is clamped into 1..3');
  assert.strictEqual(ws.settings.refereesLine, false, 'an explicit false is respected');
  assert.strictEqual(ws.settings.workRightsText, 'Australian citizen');
});

test('migrate drops records with no id', function () {
  var ws = RT.migrate({ jobs: [job('j1', '2026-09-01'), { title: 'no id' }, null] });
  assert.strictEqual(ws.jobs.length, 1);
  assert.strictEqual(ws.jobs[0].id, 'j1');
});

test('merge keeps the newer copy of a record that exists on both sides', function () {
  var local = { jobs: [job('j1', '2026-09-14T10:00:00.000Z', { title: 'old' })] };
  var disk = { jobs: [job('j1', '2026-09-14T12:00:00.000Z', { title: 'new' })] };
  assert.strictEqual(RT.mergeWorkspace(local, disk).jobs[0].title, 'new');
  assert.strictEqual(RT.mergeWorkspace(disk, local).jobs[0].title, 'new', 'argument order does not matter');
});

test('merge is a union, so a record on only one side survives', function () {
  var local = { jobs: [job('j1', '2026-09-14T10:00:00.000Z')] };
  var disk = { jobs: [job('j2', '2026-09-13T10:00:00.000Z')] };
  var ids = RT.mergeWorkspace(local, disk).jobs.map(function (j) { return j.id; }).sort();
  assert.deepStrictEqual(ids, ['j1', 'j2']);
});

test('a record with no timestamp loses to one that has it', function () {
  var local = { jobs: [job('j1', undefined, { title: 'untimed' })] };
  var disk = { jobs: [job('j1', '2026-01-01T00:00:00.000Z', { title: 'timed' })] };
  assert.strictEqual(RT.mergeWorkspace(local, disk).jobs[0].title, 'timed');
});

test('settings come from whichever side was edited more recently', function () {
  var local = {
    settingsUpdatedAt: '2026-09-14T12:00:00.000Z',
    settings: { model: 'claude-opus-5' }
  };
  var disk = {
    settingsUpdatedAt: '2026-09-14T09:00:00.000Z',
    settings: { model: 'claude-haiku-4-5' }
  };
  assert.strictEqual(RT.mergeWorkspace(local, disk).settings.model, 'claude-opus-5');
  disk.settingsUpdatedAt = '2026-09-14T18:00:00.000Z';
  assert.strictEqual(RT.mergeWorkspace(local, disk).settings.model, 'claude-haiku-4-5');
});

test('the newer profile wins, and a missing one never overwrites a real one', function () {
  var withProfile = { profile: { version: 2, updatedAt: '2026-09-14T10:00:00.000Z' } };
  assert.strictEqual(RT.mergeWorkspace(withProfile, {}).profile.version, 2);
  assert.strictEqual(RT.mergeWorkspace({}, withProfile).profile.version, 2);

  var newer = { profile: { version: 3, updatedAt: '2026-09-14T20:00:00.000Z' } };
  assert.strictEqual(RT.mergeWorkspace(withProfile, newer).profile.version, 3);
});

test('merging a workspace into itself changes nothing', function () {
  var ws = RT.migrate({
    settingsUpdatedAt: '2026-09-14T12:00:00.000Z',
    settings: { model: 'claude-sonnet-5', pageTarget: 2 },
    jobs: [job('j1', '2026-09-14T10:00:00.000Z'), job('j2', '2026-09-14T11:00:00.000Z')],
    coverLetters: [job('c1', '2026-09-14T10:30:00.000Z')]
  });
  assert.deepStrictEqual(RT.mergeWorkspace(ws, ws), ws);
});

test('byNewest sorts most recently touched first', function () {
  var list = [job('a', '2026-09-01'), job('c', '2026-09-30'), job('b', '2026-09-15')];
  assert.deepStrictEqual(
    RT.byNewest(list).map(function (j) { return j.id; }),
    ['c', 'b', 'a']
  );
});

test('buildProfile numbers bullets itself and keeps them addressable', function () {
  var p = RT.buildProfile({
    basics: { name: 'A' },
    skills: [{ group: 'Languages', items: ['Python'] }],
    sections: [{
      kind: 'experience', title: 'EXPERIENCE',
      items: [{
        heading: 'Analyst', subheading: 'Co', dateStart: '03/2026', dateEnd: 'Present',
        bullets: [
          { text: 'Did a thing with 40,000 rows.', tags: ['sql'], roles: ['DA'], numbers: [{ value: '40,000', what: 'rows' }] },
          { text: 'Did another thing.', tags: [], roles: [], numbers: [] }
        ]
      }]
    }],
    parseReview: [{ field: 'phone', note: 'check it' }]
  }, { type: 'pdf', filename: 'r.pdf' });

  assert.strictEqual(Object.keys(p.bullets).length, 2);
  assert.deepStrictEqual(p.sections[0].items[0].bullets, ['b1', 'b2'], 'items reference bullets by id');
  assert.strictEqual(p.bullets.b1.numbers[0].source, 'resume');
  assert.strictEqual(p.bullets.b1.retired, false);
  assert.strictEqual(p.parseReview[0].resolved, false);
  assert.strictEqual(p.version, 1);
  assert.strictEqual(p.sections[0].items[0].dates.end, 'Present');
});

test('re-importing a resume keeps bullets that came from gap answers', function () {
  var previous = {
    version: 2,
    bullets: {
      b1: { id: 'b1', text: 'from the old pdf', source: { type: 'resume' }, retired: false },
      g7: { id: 'g7', text: 'Used Snowflake in a subject.', source: { type: 'gap', jobId: 'job-1' }, retired: false }
    }
  };
  var p = RT.buildProfile({ basics: {}, skills: [], sections: [], parseReview: [] }, { type: 'pdf' }, previous);
  assert.ok(p.bullets.g7, 'a gap answer survives the re-import');
  assert.ok(!p.bullets.b1 || p.bullets.b1.text !== 'from the old pdf', 'old resume bullets are replaced');
  assert.strictEqual(p.version, 3, 'version increments');
});

test('coverage counts partial as half and never divides by zero', function () {
  var reqs = [
    { weight: 10, status: 'evidenced' },
    { weight: 10, status: 'partial' },
    { weight: 10, status: 'missing' }
  ];
  assert.strictEqual(Math.round(RT.coverage(reqs) * 100), 50);
  assert.strictEqual(RT.coverage([]), 0);
  assert.strictEqual(RT.coverage(undefined), 0);
  assert.strictEqual(RT.coverage([{ weight: 5, status: 'evidenced' }]), 1);
});

test('inventoryLines gives the model an id it can point back at', function () {
  var p = RT.buildProfile({
    basics: {}, skills: [],
    sections: [{ kind: 'experience', title: 'E', items: [{ heading: 'Analyst', subheading: '', dateStart: '', dateEnd: '', bullets: [{ text: 'Wrote SQL.', tags: [], roles: [], numbers: [] }] }] }],
    parseReview: []
  }, {});
  var lines = RT.inventoryLines(p);
  assert.ok(lines.indexOf('b1: [experience · Analyst] Wrote SQL.') === 0, lines);
});

test('retired bullets stay out of the inventory sent to the model', function () {
  var p = RT.buildProfile({
    basics: {}, skills: [],
    sections: [{ kind: 'experience', title: 'E', items: [{ heading: 'A', subheading: '', dateStart: '', dateEnd: '', bullets: [{ text: 'One.', tags: [], roles: [], numbers: [] }, { text: 'Two.', tags: [], roles: [], numbers: [] }] }] }],
    parseReview: []
  }, {});
  p.bullets.b1.retired = true;
  assert.strictEqual(RT.liveBullets(p).length, 1);
  assert.ok(RT.inventoryLines(p).indexOf('b1:') === -1, 'a retired bullet is not offered as evidence');
});

/* ---- tailoring: profile + changes → document, and the checks over it ---- */

function sampleProfile() {
  var p = RT.buildProfile({
    basics: { name: 'Sam Taylor', city: 'Melbourne', state: 'VIC', phone: '', email: '', linkedin: '', portfolio: '' },
    summary: 'Graduate analyst.',
    skills: [{ group: 'Tools', items: ['SQL', 'Power BI', 'Excel'] }],
    sections: [
      { kind: 'experience', title: 'EXPERIENCE', items: [{ heading: 'Retail Assistant', subheading: 'Shop', dateStart: '03/2022', dateEnd: '11/2024',
        bullets: [{ text: 'Reported weekly stock discrepancies, cutting recount time by 2 hours a week.', tags: [], roles: [], numbers: [{ value: '2 hours', what: 'time saved' }] }] }] },
      { kind: 'projects', title: 'PROJECTS', items: [{ heading: 'Churn analysis', subheading: 'Capstone', dateStart: '', dateEnd: '2025',
        bullets: [
          { text: 'Analysed churn data using Python and SQL to find drivers of customer loss.', tags: [], roles: [], numbers: [] },
          { text: 'Built a Power BI dashboard for weekly reporting.', tags: [], roles: [], numbers: [] }
        ] }] }
    ],
    parseReview: []
  }, {});
  p.bullets.g1 = { id: 'g1', text: 'Analysed 40,000 customer records for a 12% annual loss.', tags: [], roles: [], numbers: [],
    source: { type: 'gap', jobId: 'j1', date: '' }, retired: false };
  return p;
}

var junior = Object.assign(RT.defaultSettings(), { careerStage: 'junior' });

test('normaliseChanges fills original from the profile and drops changes it cannot apply', function () {
  var p = sampleProfile();
  var out = RT.normaliseChanges([
    { kind: 'rewrite', bulletId: 'b2', suggested: 'Analysed 40,000 customer records in SQL.', why: 'w', sources: [{ type: 'profile', id: 'b2' }] },
    { kind: 'rewrite', bulletId: 'b99', suggested: 'ghost', why: '', sources: [] },
    { kind: 'rewrite', bulletId: 'b3', suggested: 'Built a Power BI dashboard for weekly reporting.', why: 'no-op', sources: [] },
    { kind: 'add-from-inventory', itemId: 's2i1', bulletId: 'g1', why: 'gap answer', sources: [{ type: 'gap', id: 'g1' }] },
    { kind: 'reorder', itemId: 's2i1', list: ['b3', 'b2'], why: 'F-pattern', sources: [] },
    { kind: 'reorder', itemId: 's2i1', list: ['b3'], why: 'lost one', sources: [] },
    { kind: 'headline', suggested: 'Junior Data Analyst', why: '', sources: [] },
    { kind: 'nonsense', suggested: 'x', why: '', sources: [] }
  ], p, []);
  assert.deepStrictEqual(out.map(function (c) { return c.kind; }), ['rewrite', 'add-from-inventory', 'reorder', 'headline']);
  assert.strictEqual(out[0].original, p.bullets.b2.text, 'original comes from the profile, not the model');
  assert.strictEqual(out[0].decision, 'pending');
  assert.strictEqual(out[1].target.sectionId, 's2');
});

test('an accepted change is never overridden by a re-tailor', function () {
  var p = sampleProfile();
  var first = RT.normaliseChanges([{ kind: 'rewrite', bulletId: 'b2', suggested: 'Accepted wording.', why: '', sources: [] }], p, []);
  first[0].decision = 'accepted';
  var second = RT.normaliseChanges([
    { kind: 'rewrite', bulletId: 'b2', suggested: 'A different wording.', why: '', sources: [] },
    { kind: 'hide', bulletId: 'b2', why: '', sources: [] },
    { kind: 'rewrite', bulletId: 'b3', suggested: 'New bullet three.', why: '', sources: [] }
  ], p, first);
  assert.strictEqual(second.length, 1);
  assert.strictEqual(second[0].target.bulletId, 'b3');
  assert.strictEqual(second[0].id, 'c2', 'ids keep counting from the existing list');
  var doc = RT.buildDoc(p, { changes: first.concat(second) }, junior);
  assert.strictEqual(doc.sections[0].items[0].bullets[0].text, 'Accepted wording.');
});

test('buildDoc applies decisions: pending shows, rejected reverts, edited wins, hidden hides', function () {
  var p = sampleProfile();
  var changes = RT.normaliseChanges([
    { kind: 'rewrite', bulletId: 'b2', suggested: 'Pending text.', why: '', sources: [] },
    { kind: 'rewrite', bulletId: 'b3', suggested: 'Rejected text.', why: '', sources: [] },
    { kind: 'hide', bulletId: 'b1', why: '', sources: [] },
    { kind: 'summary', suggested: 'Edited later.', why: '', sources: [] }
  ], p, []);
  changes[1].decision = 'rejected';
  changes[2].decision = 'accepted';
  changes[3].decision = 'edited';
  changes[3].editedText = 'My own summary.';
  var doc = RT.buildDoc(p, { changes: changes }, junior);
  assert.strictEqual(doc.sections[0].kind, 'projects', 'junior puts projects above experience');
  assert.strictEqual(doc.sections[1].kind, 'experience');
  var proj = doc.sections[0].items[0].bullets;
  assert.strictEqual(proj[0].text, 'Pending text.');
  assert.strictEqual(proj[1].text, p.bullets.b3.text, 'rejected falls back to the profile wording');
  assert.strictEqual(doc.sections[1].items[0].bullets[0].hidden, true);
  changes[2].decision = 'pending';
  assert.strictEqual(RT.buildDoc(p, { changes: changes }, junior).sections[1].items[0].bullets[0].hidden, false, 'a pending hide still shows, so it can be judged');
  assert.strictEqual(doc.summary.text, 'My own summary.');
  assert.strictEqual(RT.buildDoc(p, { changes: changes }, Object.assign({}, junior, { careerStage: 'senior' })).sections[0].kind, 'experience');
});

test('numbersCheck only passes numbers already on record', function () {
  var p = sampleProfile();
  var known = RT.profileNumbers(p);
  assert.deepStrictEqual(RT.numbersCheck('Cut recount time by 2 hours across 40,000 records in 2025.', known), { ok: true, unmatched: [] });
  var bad = RT.numbersCheck('Improved accuracy by 35% for 1,200 users.', known);
  assert.deepStrictEqual(bad.unmatched, ['35', '1200']);
  assert.deepStrictEqual(RT.unknownSkills(['SQL', 'Snowflake', 'python'], p), ['Snowflake']);
});

test('lint flags ai-tell, US spelling, weak verbs and missing metrics, but not spellings the ad uses', function () {
  var p = sampleProfile();
  var changes = RT.normaliseChanges([
    { kind: 'rewrite', bulletId: 'b2', suggested: 'Leveraged Python to optimize the model — twice.', why: '', sources: [] },
    { kind: 'rewrite', bulletId: 'b3', suggested: 'Responsible for dashboards.', why: '', sources: [] }
  ], p, []);
  var doc = RT.buildDoc(p, { changes: changes }, junior);
  var kinds = RT.lintDoc(doc, '').filter(function (f) { return f.blockId === 'b2' || f.blockId === 'b3'; })
    .map(function (f) { return f.blockId + ':' + f.kind; }).sort();
  assert.deepStrictEqual(kinds, ['b2:ai-tell', 'b2:ai-tell', 'b2:en-AU', 'b3:no-metric', 'b3:weak-verb']);
  var withAd = RT.lintDoc(doc, 'You will optimize pipelines.').filter(function (f) { return f.kind === 'en-AU'; });
  assert.strictEqual(withAd.length, 0, 'the ad spells it the US way, so mirror it');
});

test('keywordHits counts aliases with word boundaries and treats en-AU and US spelling as equal', function () {
  var reqs = [
    { id: 'r1', name: 'SQL', weight: 10, aliases: ['T-SQL'] },
    { id: 'r2', name: 'Data visualisation', weight: 5, aliases: ['data visualization'] },
    { id: 'r3', name: 'R', weight: 5, aliases: [] },
    { id: 'r4', name: 'Snowflake', weight: 5, aliases: [] }
  ];
  var hits = RT.keywordHits('Wrote SQL and T-SQL for data visualisation. Our reports were clear.', reqs);
  assert.strictEqual(hits.counts.r1, 2);
  assert.strictEqual(hits.counts.r2, 1);
  assert.strictEqual(hits.counts.r3, 0, 'the R in "Our" and "reports" does not count');
  assert.strictEqual(hits.counts.r4, 0);
  assert.strictEqual(hits.coverage, 0.6);
});

if (!process.exitCode) console.log('\nall passing');
