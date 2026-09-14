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

if (!process.exitCode) console.log('\nall passing');
