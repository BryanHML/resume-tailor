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
    newerOf: newerOf,
    mergeRecords: mergeRecords,
    mergeWorkspace: mergeWorkspace,
    byNewest: byNewest
  };
});
