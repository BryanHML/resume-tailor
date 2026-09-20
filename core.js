/* Pure workspace data: defaults, migration, merge.
   Loaded as a classic script in the browser (window.RT) and required by test.js in node.
   Kept separate from app.js only because it is the one part worth testing headlessly. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RT = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  var MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
  var EFFORTS = ['low', 'medium', 'high'];
  var STAGES = ['student', 'graduate', 'junior', 'mid', 'senior'];

  function oneOf(value, allowed, fallback) {
    return allowed.indexOf(value) === -1 ? fallback : value;
  }

  function defaultSettings() {
    return {
      model: 'claude-opus-5',
      effort: 'high',
      rememberKey: false,
      careerStage: 'junior',
      pageTarget: 1,
      workRightsLine: false,
      workRightsText: '',
      refereesLine: true,
      spelling: 'en-AU',
      lastOpenJobId: null,
      // Per-screen panel widths, only present once someone drags one.
      layout: {}
    };
  }

  function defaultWorkspace() {
    return {
      schemaVersion: SCHEMA_VERSION,
      // Spec refinement: settings and profile need their own timestamps so the
      // folder/localStorage merge can pick a winner per record, as section 10 requires.
      settingsUpdatedAt: '',
      settings: defaultSettings(),
      profile: null,
      jobs: [],
      coverLetters: []
    };
  }

  /* A stored workspace is user-controlled input (hand-edited file, imported file,
     older schema). Fill in what is missing and reject values that would break
     later arithmetic, rather than trusting the file. */
  function migrate(stored) {
    var ws = defaultWorkspace();
    if (!stored || typeof stored !== 'object') return ws;

    var s = (stored.settings && typeof stored.settings === 'object') ? stored.settings : {};
    Object.keys(ws.settings).forEach(function (k) {
      if (s[k] !== undefined) ws.settings[k] = s[k];
    });
    ws.settings.model = oneOf(ws.settings.model, MODELS, 'claude-opus-5');
    ws.settings.effort = oneOf(ws.settings.effort, EFFORTS, 'high');
    ws.settings.careerStage = oneOf(ws.settings.careerStage, STAGES, 'junior');
    ws.settings.pageTarget = Math.min(3, Math.max(1, parseInt(ws.settings.pageTarget, 10) || 1));
    ws.settings.rememberKey = ws.settings.rememberKey === true;
    ws.settings.workRightsLine = ws.settings.workRightsLine === true;
    ws.settings.refereesLine = ws.settings.refereesLine !== false;
    ws.settings.workRightsText = String(ws.settings.workRightsText || '');
    ws.settings.spelling = 'en-AU';
    if (typeof ws.settings.lastOpenJobId !== 'string') ws.settings.lastOpenJobId = null;
    ws.settings.layout = sanitiseLayout(ws.settings.layout);

    ws.settingsUpdatedAt = String(stored.settingsUpdatedAt || '');
    ws.profile = (stored.profile && typeof stored.profile === 'object') ? stored.profile : null;
    ws.jobs = Array.isArray(stored.jobs) ? stored.jobs.filter(hasId) : [];
    ws.coverLetters = Array.isArray(stored.coverLetters) ? stored.coverLetters.filter(hasId) : [];
    return ws;
  }

  /* Panel widths come back from a file someone could have edited. A negative
     or absurd width would render the app unusable, so only sane numbers pass. */
  function sanitiseLayout(layout) {
    var out = {};
    if (!layout || typeof layout !== 'object') return out;
    Object.keys(layout).forEach(function (screen) {
      var v = layout[screen];
      if (!v || typeof v !== 'object') return;
      var left = Math.round(Number(v.left));
      var right = Math.round(Number(v.right));
      if (!isFinite(left) || !isFinite(right)) return;
      if (left < 160 || right < 160 || left > 1200 || right > 1200) return;
      out[screen] = { left: left, right: right };
    });
    return out;
  }

  function hasId(r) {
    return r && typeof r === 'object' && typeof r.id === 'string' && r.id.length > 0;
  }

  function stamp(record) {
    record.updatedAt = new Date().toISOString();
    return record;
  }

  /* Ids only have to be unique within one person's workspace and stable enough
     to name a file, so time plus a little randomness is plenty. */
  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function newJob() {
    var now = new Date().toISOString();
    return {
      id: newId('job'),
      title: '',
      company: '',
      location: '',
      adText: '',
      pastedAt: null,
      role: null,
      shape: null,
      analysis: null,
      gaps: [],
      tailored: null,
      coverageAfter: null,
      status: 'new',
      createdAt: now,
      updatedAt: now
    };
  }

  function wordCount(text) {
    var trimmed = String(text || '').trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  /* Turn what the model returned into the stored profile. The model is not
     asked to invent cross-referenced ids; it returns bullets inline and we
     number them here, so the ids are ours and stay stable. */
  function buildProfile(extracted, source, previous) {
    var now = new Date().toISOString();
    var bullets = {};
    var n = 0;

    var sections = (extracted.sections || []).map(function (s, si) {
      return {
        id: 's' + (si + 1),
        kind: s.kind,
        title: s.title,
        items: (s.items || []).map(function (item, ii) {
          return {
            id: 's' + (si + 1) + 'i' + (ii + 1),
            heading: item.heading,
            subheading: item.subheading || '',
            dates: { start: item.dateStart || '', end: item.dateEnd || '' },
            bullets: (item.bullets || []).map(function (b) {
              var id = 'b' + (++n);
              bullets[id] = {
                id: id,
                text: b.text,
                tags: b.tags || [],
                roles: b.roles || [],
                numbers: (b.numbers || []).map(function (num) {
                  return { value: num.value, what: num.what, source: 'resume' };
                }),
                source: { type: 'resume', jobId: null, date: now },
                retired: false
              };
              return id;
            })
          };
        })
      };
    });

    // Gap answers from earlier jobs are not in the PDF, so carry them across a
    // re-import rather than throwing away work the person already did.
    if (previous && previous.bullets) {
      Object.keys(previous.bullets).forEach(function (id) {
        var b = previous.bullets[id];
        if (b.source && b.source.type === 'gap') bullets[id] = b;
      });
    }

    return {
      version: previous ? (previous.version || 1) + 1 : 1,
      updatedAt: now,
      source: source,
      basics: extracted.basics || {},
      summary: extracted.summary || '',
      skills: extracted.skills || [],
      sections: sections,
      bullets: bullets,
      parseReview: (extracted.parseReview || []).map(function (r, i) {
        return { id: 'r' + (i + 1), field: r.field, note: r.note, resolved: false };
      })
    };
  }

  function liveBullets(profile) {
    if (!profile || !profile.bullets) return [];
    return Object.keys(profile.bullets)
      .map(function (id) { return profile.bullets[id]; })
      .filter(function (b) { return !b.retired; });
  }

  /* How the inventory is handed to the analysis call: one line per bullet,
     carrying the id so the model can point back at its evidence. */
  function inventoryLines(profile) {
    var lines = [];
    (profile.sections || []).forEach(function (section) {
      (section.items || []).forEach(function (item) {
        (item.bullets || []).forEach(function (id) {
          var b = profile.bullets[id];
          if (b && !b.retired) {
            lines.push(id + ': [' + section.kind + ' · ' + item.heading + '] ' + b.text);
          }
        });
      });
    });
    liveBullets(profile).forEach(function (b) {
      if (b.source && b.source.type === 'gap') lines.push(b.id + ': [from your answer] ' + b.text);
    });
    return lines.join('\n');
  }

  function skillLines(profile) {
    return (profile.skills || []).map(function (g) {
      return g.group + ': ' + (g.items || []).join(', ');
    }).join('\n');
  }

  /* Weighted coverage: the share of the ad's weight that the person evidences.
     Partial counts half, because "mentioned once in a skills list" is not the
     same as "a bullet proves it", and pretending otherwise inflates the score. */
  function coverage(requirements) {
    var total = 0, got = 0;
    (requirements || []).forEach(function (r) {
      var w = r.weight || 0;
      total += w;
      if (r.status === 'evidenced') got += w;
      else if (r.status === 'partial') got += w / 2;
    });
    return total ? got / total : 0;
  }

  /* ISO 8601 strings compare correctly with >, so no date parsing is needed.
     A record with no timestamp always loses to one that has a timestamp. */
  function newerOf(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return String(b.updatedAt || '') > String(a.updatedAt || '') ? b : a;
  }

  function mergeRecords(a, b) {
    var byId = {};
    var order = [];
    function take(list) {
      (list || []).forEach(function (r) {
        if (!hasId(r)) return;
        if (!Object.prototype.hasOwnProperty.call(byId, r.id)) order.push(r.id);
        byId[r.id] = newerOf(byId[r.id], r);
      });
    }
    take(a);
    take(b);
    return order.map(function (id) { return byId[id]; });
  }

  /* Union, never replace: a record present on only one side survives, and where
     both sides have it the newer updatedAt wins. Used for folder reconnect and
     for importing a workspace.json from another machine. */
  function mergeWorkspace(local, disk) {
    var l = migrate(local);
    var d = migrate(disk);
    var out = defaultWorkspace();
    var diskWins = String(d.settingsUpdatedAt || '') > String(l.settingsUpdatedAt || '');
    out.settings = diskWins ? d.settings : l.settings;
    out.settingsUpdatedAt = diskWins ? d.settingsUpdatedAt : l.settingsUpdatedAt;
    out.profile = newerOf(l.profile, d.profile);
    out.jobs = mergeRecords(l.jobs, d.jobs);
    out.coverLetters = mergeRecords(l.coverLetters, d.coverLetters);
    return out;
  }

  function byNewest(list) {
    return (list || []).slice().sort(function (a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  /* ------------------------------------------------------------- tailoring
     The tailored resume is never stored as a document. It is the profile plus
     a list of changes, each with a decision, and the document is rebuilt from
     those on every render. That is what lets a re-tailor keep accepted changes
     verbatim: the model can only add to the list, never overwrite it. */

  var SECTION_ORDER = {
    early: ['projects', 'education', 'experience', 'certifications', 'other'],
    established: ['experience', 'projects', 'education', 'certifications', 'other']
  };

  function sectionOrder(stage) {
    return stage === 'mid' || stage === 'senior' ? SECTION_ORDER.established : SECTION_ORDER.early;
  }

  function newTailored() {
    return { version: 0, changes: [], updatedAt: '' };
  }

  /* Which part of the document a change applies to. Two changes on the same
     key conflict, and the later one loses if the earlier is accepted. */
  function changeKey(c) {
    var t = c.target || {};
    if (c.kind === 'summary' || c.kind === 'headline' || c.kind === 'skills-order') return c.kind;
    if (c.kind === 'reorder') return 'order:' + t.itemId;
    if (c.kind === 'add-from-inventory') return 'add:' + t.itemId + ':' + t.bulletId;
    if (c.kind === 'hide') return 'hide:' + t.bulletId;
    return 'bullet:' + t.bulletId; // rewrite
  }

  function effectiveText(c) {
    if (c.decision === 'rejected') return c.original;
    if (c.decision === 'edited') return c.editedText;
    return c.suggested;
  }

  function isLive(c) {
    return c.decision !== 'rejected';
  }

  /* Model output → stored changes. The model never sees our decision field, so
     everything it returns starts pending, and `original` is filled from the
     profile rather than trusted from the model. Anything that points at a
     bullet or item that does not exist is dropped: it cannot be applied and
     showing it would only confuse. */
  function normaliseChanges(raw, profile, existing) {
    var items = {};
    (profile.sections || []).forEach(function (s) {
      (s.items || []).forEach(function (it) { items[it.id] = { section: s, item: it }; });
    });
    var taken = {};
    (existing || []).forEach(function (c) { if (c.decision === 'accepted' || c.decision === 'edited') taken[changeKey(c)] = true; });
    var next = (existing || []).length;
    var out = [];

    (raw || []).forEach(function (r) {
      var c = {
        id: '',
        kind: r.kind,
        target: { sectionId: r.sectionId || '', itemId: r.itemId || '', bulletId: r.bulletId || '' },
        original: '',
        suggested: r.suggested || '',
        list: Array.isArray(r.list) ? r.list.filter(Boolean) : [],
        why: r.why || '',
        sources: (r.sources || []).filter(function (s) { return s && s.id; }),
        decision: 'pending',
        editedText: null
      };
      var b = profile.bullets[c.target.bulletId];
      var it = items[c.target.itemId];

      if (c.kind === 'rewrite' || c.kind === 'hide') {
        if (!b || b.retired) return;
        c.original = b.text;
        if (c.kind === 'hide') c.suggested = '';
        if (c.kind === 'rewrite' && (!c.suggested.trim() || c.suggested === c.original)) return;
      } else if (c.kind === 'add-from-inventory') {
        if (!b || b.retired || !it) return;
        c.target.sectionId = it.section.id;
        c.suggested = c.suggested.trim() || b.text;
        c.original = '';
      } else if (c.kind === 'reorder') {
        if (!it) return;
        c.target.sectionId = it.section.id;
        var have = it.item.bullets.slice();
        c.list = c.list.filter(function (id) { return have.indexOf(id) !== -1; });
        if (c.list.length !== have.length || c.list.join() === have.join()) return;
      } else if (c.kind === 'summary') {
        c.original = profile.summary || '';
        if (!c.suggested.trim()) return;
      } else if (c.kind === 'headline') {
        c.original = '';
        if (!c.suggested.trim()) return;
      } else if (c.kind === 'skills-order') {
        c.original = flatSkills(profile).join(' · ');
        if (!c.list.length) return;
      } else {
        return;
      }

      var key = changeKey(c);
      if (taken[key]) return; // an accepted decision is never overridden
      // A rewrite and a hide of the same bullet are one target to the model.
      if (c.kind === 'hide' && taken['bullet:' + c.target.bulletId]) return;
      if (c.kind === 'rewrite' && taken['hide:' + c.target.bulletId]) return;
      taken[key] = true;
      c.id = 'c' + (++next);
      out.push(c);
    });
    return out;
  }

  function flatSkills(profile) {
    var out = [];
    (profile.skills || []).forEach(function (g) { (g.items || []).forEach(function (s) { out.push(s); }); });
    return out;
  }

  /* Rebuild the document from profile + changes. Every block carries the id
     of the change that produced it, so the editor can bind the inspector. */
  function buildDoc(profile, tailored, settings) {
    var changes = (tailored && tailored.changes) || [];
    var byKey = {};
    changes.forEach(function (c) { if (isLive(c)) byKey[changeKey(c)] = c; });
    var adds = changes.filter(function (c) { return c.kind === 'add-from-inventory' && isLive(c); });
    var flags = {};

    var doc = {
      basics: profile.basics || {},
      headline: byKey.headline ? { text: effectiveText(byKey.headline), changeId: byKey.headline.id } : null,
      summary: null,
      skills: null,
      sections: [],
      workRights: settings.workRightsLine && settings.workRightsText ? settings.workRightsText : '',
      referees: !!settings.refereesLine
    };

    var summaryText = byKey.summary ? effectiveText(byKey.summary) : (profile.summary || '');
    if (summaryText) doc.summary = { id: 'summary', text: summaryText, changeId: byKey.summary ? byKey.summary.id : null };

    var sk = byKey['skills-order'];
    var skills = !sk ? flatSkills(profile)
      : sk.decision === 'edited' ? String(sk.editedText || '').split(/\s*[·,;]\s*/).filter(Boolean)
      : sk.list;
    if (skills.length) doc.skills = { id: 'skills', list: skills, changeId: byKey['skills-order'] ? byKey['skills-order'].id : null };

    var order = sectionOrder(settings.careerStage);
    var sections = (profile.sections || []).filter(function (s) { return s.kind !== 'skills'; }).slice();
    sections.sort(function (a, b) {
      var ia = order.indexOf(a.kind), ib = order.indexOf(b.kind);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    sections.forEach(function (s) {
      var sec = { id: s.id, kind: s.kind, title: s.title, items: [] };
      (s.items || []).forEach(function (it) {
        var ids = it.bullets.slice();
        var re = byKey['order:' + it.id];
        if (re) ids = re.list.slice();
        adds.forEach(function (a) {
          if (a.target.itemId === it.id && ids.indexOf(a.target.bulletId) === -1) ids.push(a.target.bulletId);
        });
        var item = { id: it.id, heading: it.heading, subheading: it.subheading || '', dates: it.dates || {}, bullets: [] };
        ids.forEach(function (id) {
          var b = profile.bullets[id];
          if (!b || b.retired) return;
          var c = byKey['bullet:' + id];
          var add = byKey['add:' + it.id + ':' + id];
          var hide = byKey['hide:' + id];
          var text = c ? effectiveText(c) : (add ? effectiveText(add) : b.text);
          // A pending hide still shows the bullet, marked, so it can be judged.
          var hidden = !!hide && hide.decision !== 'pending';
          item.bullets.push({
            id: id, text: text, hidden: hidden,
            changeId: hide && hide.decision === 'pending' ? hide.id : (c ? c.id : (add ? add.id : null)),
            hideId: hide ? hide.id : null
          });
        });
        sec.items.push(item);
      });
      if (sec.items.length) doc.sections.push(sec);
    });
    return doc;
  }

  /* Every visible line of the document, in reading order, for the checks. */
  function docBlocks(doc) {
    var out = [];
    if (doc.headline) out.push({ id: 'headline', text: doc.headline.text, changeId: doc.headline.changeId });
    if (doc.summary) out.push({ id: 'summary', text: doc.summary.text, changeId: doc.summary.changeId });
    if (doc.skills) out.push({ id: 'skills', text: doc.skills.list.join(' · '), changeId: doc.skills.changeId, isSkills: true });
    doc.sections.forEach(function (s) {
      s.items.forEach(function (it) {
        it.bullets.forEach(function (b) {
          if (!b.hidden) out.push({ id: b.id, text: b.text, changeId: b.changeId, isBullet: true, itemId: it.id });
        });
      });
    });
    return out;
  }

  function docText(doc) {
    var head = [doc.basics.name, doc.basics.city, doc.basics.state].filter(Boolean).join(' ');
    var lines = [head];
    docBlocks(doc).forEach(function (b) { lines.push(b.text); });
    doc.sections.forEach(function (s) {
      lines.push(s.title);
      s.items.forEach(function (it) { lines.push([it.heading, it.subheading].filter(Boolean).join(' ')); });
    });
    return lines.join('\n');
  }

  /* -------------------------------------------------------------- checks */

  var AI_TELL = ['spearheaded', 'leveraged', 'leverage', 'leveraging', 'pivotal', 'intricate', 'showcasing', 'synergy',
    'delve', 'delving', 'realm', 'robust', 'orchestrated', 'passionate', 'results-driven', 'dynamic', 'seamlessly'];
  var WEAK_START = ['responsible for', 'worked on', 'helped', 'assisted with', 'involved in', 'duties included', 'tasked with'];
  var NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|dozen|hundred|thousand|million|half|twice|double|triple)\b/i;
  // US → AU. "program" is left alone on purpose; "practice/practise" and
  // "license/licence" depend on part of speech, so only the clear cases are here.
  var US_AU = [['optimiz', 'optimis'], ['analyz', 'analys'], ['organiz', 'organis'], ['color', 'colour'], ['center', 'centre'],
    ['modeling', 'modelling'], ['modeled', 'modelled'], ['labeled', 'labelled'], ['labeling', 'labelling'], ['catalog', 'catalogue'],
    ['behavior', 'behaviour'], ['utiliz', 'utilis'], ['visualiz', 'visualis'], ['summariz', 'summaris'], ['prioritiz', 'prioritis'],
    ['specializ', 'specialis'], ['recogniz', 'recognis'], ['minimiz', 'minimis'], ['maximiz', 'maximis'], ['standardiz', 'standardis'],
    ['favorite', 'favourite'], ['defense', 'defence'], ['customiz', 'customis'], ['normaliz', 'normalis'], ['initializ', 'initialis']];

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* Words the ad itself spells the American way are not flagged: the rule is
     to mirror the ad, and a recruiter's keyword search uses their spelling. */
  function usWordsInAd(adText) {
    var ad = String(adText || '').toLowerCase();
    var out = {};
    US_AU.forEach(function (pair) { if (ad.indexOf(pair[0]) !== -1) out[pair[0]] = true; });
    return out;
  }

  function lintText(text, adUs) {
    var flags = [];
    var lower = text.toLowerCase();
    AI_TELL.forEach(function (w) {
      if (new RegExp('\\b' + escapeRe(w) + '\\b', 'i').test(text)) flags.push({ kind: 'ai-tell', note: '“' + w + '”' });
    });
    if (text.indexOf('—') !== -1) flags.push({ kind: 'ai-tell', note: 'em-dash' });
    US_AU.forEach(function (pair) {
      if (adUs && adUs[pair[0]]) return;
      var m = new RegExp('\\b\\w*' + pair[0] + '\\w*', 'i').exec(text);
      if (m) flags.push({ kind: 'en-AU', note: m[0] + ' → ' + m[0].toLowerCase().replace(pair[0], pair[1]) });
    });
    return flags;
  }

  function lintBullet(text, adUs) {
    var flags = lintText(text, adUs);
    if (!/\d/.test(text) && !NUMBER_WORDS.test(text)) flags.push({ kind: 'no-metric', note: 'no number or measure' });
    var start = text.trim().toLowerCase();
    WEAK_START.forEach(function (w) {
      if (start.indexOf(w) === 0) flags.push({ kind: 'weak-verb', note: 'starts with “' + w + '”' });
    });
    return flags;
  }

  /* Content lint over the whole document. Returns [{ blockId, changeId, kind, note }]. */
  function lintDoc(doc, adText) {
    var adUs = usWordsInAd(adText);
    var out = [];
    docBlocks(doc).forEach(function (b) {
      var flags = b.isBullet ? lintBullet(b.text, adUs) : lintText(b.text, adUs);
      flags.forEach(function (f) { out.push({ blockId: b.id, changeId: b.changeId, kind: f.kind, note: f.note }); });
    });
    return out;
  }

  /* Numbers check. Every number in a piece of text must already exist somewhere
     in the profile: a bullet, a number on record, a date, or a gap answer. */
  var NUM_RE = /\d[\d,]*(?:\.\d+)?/g;

  function numbersIn(text) {
    var out = [];
    var m;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(String(text || ''))) !== null) out.push(m[0].replace(/,/g, ''));
    return out;
  }

  function profileNumbers(profile) {
    var set = {};
    function add(text) { numbersIn(text).forEach(function (n) { set[n] = true; }); }
    Object.keys(profile.bullets || {}).forEach(function (id) {
      var b = profile.bullets[id];
      add(b.text);
      (b.numbers || []).forEach(function (n) { add(n.value); });
    });
    (profile.sections || []).forEach(function (s) {
      (s.items || []).forEach(function (it) {
        add(it.heading); add(it.subheading);
        if (it.dates) { add(it.dates.start); add(it.dates.end); }
      });
    });
    add(profile.summary);
    flatSkills(profile).forEach(add);
    Object.keys(profile.basics || {}).forEach(function (k) { add(profile.basics[k]); });
    return set;
  }

  function numbersCheck(text, known) {
    var unmatched = [];
    numbersIn(text).forEach(function (n) {
      if (!known[n] && unmatched.indexOf(n) === -1) unmatched.push(n);
    });
    return { ok: unmatched.length === 0, unmatched: unmatched };
  }

  /* Anything the model puts in the skills line must already be in the profile
     somewhere, or it is an invented skill. */
  function unknownSkills(list, profile) {
    var hay = (flatSkills(profile).join('\n') + '\n' + Object.keys(profile.bullets || {}).map(function (id) {
      return profile.bullets[id].text;
    }).join('\n')).toLowerCase();
    return (list || []).filter(function (s) { return hay.indexOf(String(s).toLowerCase()) === -1; });
  }

  /* Keyword coverage: how many times each requirement's terms appear in the
     document, with the en-AU and US spellings treated as the same word. */
  function auNeutral(s) {
    var out = String(s).toLowerCase();
    US_AU.forEach(function (pair) { out = out.split(pair[1]).join(pair[0]); });
    return out;
  }

  function keywordHits(text, requirements) {
    var hay = auNeutral(text);
    var counts = {};
    var found = 0, total = 0;
    (requirements || []).forEach(function (r) {
      var terms = (r.aliases || []).slice();
      if (r.name && r.name.split(/\s+/).length <= 3) terms.push(r.name);
      var n = 0;
      var seen = {};
      terms.forEach(function (t) {
        if (!t || t.length < 2) return;
        t = auNeutral(t);
        if (seen[t]) return; // "visualisation" and "visualization" are one term
        seen[t] = true;
        var re = new RegExp('(?<![\\w-])' + escapeRe(t) + '(?![\\w-])', 'g');
        var m = hay.match(re);
        if (m) n += m.length;
      });
      counts[r.id] = n;
      total += r.weight || 0;
      if (n) found += r.weight || 0;
    });
    return { counts: counts, coverage: total ? found / total : 0 };
  }

  /* One line of 11pt Arial across an A4 text column holds about 95 characters.
     Only used to tell the model roughly how full the page is; the real fit is
     measured in the browser. */
  function estimateLines(doc) {
    var lines = 3; // name and contact
    if (doc.summary) lines += Math.ceil(doc.summary.text.length / 95) + 1;
    if (doc.skills) lines += Math.ceil(doc.skills.list.join(' · ').length / 95) + 2;
    doc.sections.forEach(function (s) {
      lines += 2;
      s.items.forEach(function (it) {
        lines += 1;
        it.bullets.forEach(function (b) { if (!b.hidden) lines += Math.ceil(b.text.length / 95); });
      });
    });
    return lines;
  }

  function outlineForModel(profile) {
    return (profile.sections || []).filter(function (s) { return s.kind !== 'skills'; }).map(function (s) {
      return s.id + ' ' + s.kind + ' "' + s.title + '"\n' + (s.items || []).map(function (it) {
        return '  ' + it.id + ' ' + it.heading + (it.subheading ? ' · ' + it.subheading : '')
          + ' [' + [it.dates && it.dates.start, it.dates && it.dates.end].filter(Boolean).join('–') + ']'
          + ' bullets: ' + it.bullets.join(', ');
      }).join('\n');
    }).join('\n');
  }

  function decisionsForModel(changes) {
    var locked = [], rejected = [];
    (changes || []).forEach(function (c) {
      var where = c.kind + ' ' + [c.target.itemId, c.target.bulletId].filter(Boolean).join(' ');
      if (c.decision === 'accepted' || c.decision === 'edited') {
        locked.push(where + (c.kind === 'reorder' || c.kind === 'skills-order'
          ? ' → ' + (c.decision === 'edited' ? c.editedText : c.list.join(' · '))
          : ' → "' + effectiveText(c) + '"'));
      } else if (c.decision === 'rejected') {
        rejected.push(where + ': "' + (c.suggested || c.list.join(' · ')) + '"');
      }
    });
    return { locked: locked, rejected: rejected };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MODELS: MODELS,
    EFFORTS: EFFORTS,
    STAGES: STAGES,
    defaultSettings: defaultSettings,
    defaultWorkspace: defaultWorkspace,
    migrate: migrate,
    stamp: stamp,
    newId: newId,
    newJob: newJob,
    wordCount: wordCount,
    sanitiseLayout: sanitiseLayout,
    buildProfile: buildProfile,
    liveBullets: liveBullets,
    inventoryLines: inventoryLines,
    skillLines: skillLines,
    coverage: coverage,
    newerOf: newerOf,
    mergeRecords: mergeRecords,
    mergeWorkspace: mergeWorkspace,
    byNewest: byNewest,
    sectionOrder: sectionOrder,
    newTailored: newTailored,
    changeKey: changeKey,
    effectiveText: effectiveText,
    normaliseChanges: normaliseChanges,
    flatSkills: flatSkills,
    buildDoc: buildDoc,
    docBlocks: docBlocks,
    docText: docText,
    lintDoc: lintDoc,
    numbersIn: numbersIn,
    profileNumbers: profileNumbers,
    numbersCheck: numbersCheck,
    unknownSkills: unknownSkills,
    keywordHits: keywordHits,
    estimateLines: estimateLines,
    outlineForModel: outlineForModel,
    decisionsForModel: decisionsForModel
  };
});
