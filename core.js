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
      lastOpenJobId: null
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

    ws.settingsUpdatedAt = String(stored.settingsUpdatedAt || '');
    ws.profile = (stored.profile && typeof stored.profile === 'object') ? stored.profile : null;
    ws.jobs = Array.isArray(stored.jobs) ? stored.jobs.filter(hasId) : [];
    ws.coverLetters = Array.isArray(stored.coverLetters) ? stored.coverLetters.filter(hasId) : [];
    return ws;
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
    buildProfile: buildProfile,
    liveBullets: liveBullets,
    inventoryLines: inventoryLines,
    skillLines: skillLines,
    coverage: coverage,
    newerOf: newerOf,
    mergeRecords: mergeRecords,
    mergeWorkspace: mergeWorkspace,
    byNewest: byNewest
  };
});
