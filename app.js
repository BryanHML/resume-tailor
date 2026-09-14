/* Resume Tailor — app shell: state, settings, key handling, persistence.
   Classic script on purpose: ES modules do not load from file://, and the app
   must keep working when index.html is opened by double-click. */
(function () {
  'use strict';

  var RT = window.RT;

  var LS_WORKSPACE = 'resume-tailor.workspace.v1';
  var KEY_NAME = 'resume-tailor.key';
  var IDB_NAME = 'resume-tailor';
  var IDB_STORE = 'handles';
  var DIR_KEY = 'workspaceDir';

  var ws = RT.defaultWorkspace();
  var apiKey = '';
  var dirHandle = null;
  var dirStatus = 'none'; // none | needs-permission | connected | unsupported
  var saveTimer = null;

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------- storage
     Every storage call can throw: private windows, blocked site data, and
     file:// origins all fail in different ways. None of them should take the
     app down, so everything is wrapped and absence is a normal outcome. */

  function safeGet(store, k) {
    try { return store.getItem(k); } catch (e) { return null; }
  }
  function safeSet(store, k, v) {
    try { store.setItem(k, v); return true; } catch (e) { return false; }
  }
  function safeRemove(store, k) {
    try { store.removeItem(k); } catch (e) { /* nothing to do */ }
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbSet(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbDel(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function quiet() { return null; }

  /* ------------------------------------------------------------------ save */

  function saveLocal() {
    return safeSet(localStorage, LS_WORKSPACE, JSON.stringify(ws));
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 500);
  }

  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    var ok = saveLocal();
    if (!ok) {
      markSaved(false);
      toast('Could not write to browser storage. Export your workspace to keep it.', true);
      return;
    }
    markSaved(true);
    writeFolder().catch(function (err) {
      markSaved(false);
      toast('Folder write failed: ' + err.message, true);
    });
  }

  function touchSettings() {
    ws.settingsUpdatedAt = new Date().toISOString();
    scheduleSave();
  }

  function markSaved(ok) {
    var dot = $('saved-dot');
    var text = $('saved-text');
    dot.className = 'dot ' + (ok ? 'ok' : 'bad');
    if (!ok) { text.textContent = 'save failed'; return; }
    var d = new Date();
    text.textContent = 'saved ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var toastTimer = null;
  function toast(message, bad) {
    var el = $('status');
    el.textContent = message;
    el.className = 'toast' + (bad ? ' bad' : '');
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, bad ? 9000 : 4500);
  }

  /* ---------------------------------------------------------------- folder */

  function folderSupported() {
    // Needs a secure context, so it is absent on file:// by design.
    return typeof window.showDirectoryPicker === 'function';
  }

  function writeJson(dir, name, obj) {
    return dir.getFileHandle(name, { create: true }).then(function (fh) {
      return fh.createWritable();
    }).then(function (w) {
      return w.write(JSON.stringify(obj, null, 2)).then(function () { return w.close(); });
    });
  }

  function readJson(dir, name) {
    return dir.getFileHandle(name).then(function (fh) {
      return fh.getFile();
    }).then(function (file) {
      return file.text();
    }).then(function (text) {
      try { return JSON.parse(text); } catch (e) { return null; }
    }).catch(function () { return null; }); // missing file is the normal case
  }

  function writeFolder() {
    if (!dirHandle || dirStatus !== 'connected') return Promise.resolve();
    // ponytail: rewrites every record on every save. Fine for the dozens of jobs
    // one person accumulates; write only dirty records if that ever drags.
    var chain = writeJson(dirHandle, 'settings.json', {
      settingsUpdatedAt: ws.settingsUpdatedAt,
      settings: ws.settings
    });
    if (ws.profile) {
      chain = chain.then(function () { return writeJson(dirHandle, 'profile.json', ws.profile); });
    }
    chain = chain.then(function () { return writeRecords('jobs', ws.jobs); });
    chain = chain.then(function () { return writeRecords('letters', ws.coverLetters); });
    return chain;
  }

  function writeRecords(folderName, records) {
    if (!records.length) return Promise.resolve();
    return dirHandle.getDirectoryHandle(folderName, { create: true }).then(function (dir) {
      return records.reduce(function (p, rec) {
        return p.then(function () { return writeJson(dir, rec.id + '.json', rec); });
      }, Promise.resolve());
    });
  }

  function readRecords(folderName) {
    return dirHandle.getDirectoryHandle(folderName).then(function (dir) {
      var out = [];
      var walk = dir.values();
      function step() {
        return walk.next().then(function (res) {
          if (res.done) return out;
          var entry = res.value;
          if (entry.kind !== 'file' || !/\.json$/i.test(entry.name)) return step();
          return readJson(dir, entry.name).then(function (rec) {
            if (rec && rec.id) out.push(rec);
            return step();
          });
        });
      }
      return step();
    }).catch(function () { return []; }); // no such folder yet
  }

  function readFolder() {
    var disk = RT.defaultWorkspace();
    return readJson(dirHandle, 'settings.json').then(function (s) {
      if (s && s.settings) {
        disk.settings = s.settings;
        disk.settingsUpdatedAt = s.settingsUpdatedAt || '';
      }
      return readJson(dirHandle, 'profile.json');
    }).then(function (p) {
      disk.profile = p;
      return readRecords('jobs');
    }).then(function (jobs) {
      disk.jobs = jobs;
      return readRecords('letters');
    }).then(function (letters) {
      disk.coverLetters = letters;
      return disk;
    });
  }

  function pickFolder() {
    if (!folderSupported()) return;
    window.showDirectoryPicker({ mode: 'readwrite', id: 'resume-tailor' }).then(function (handle) {
      dirHandle = handle;
      return idbSet(DIR_KEY, handle).catch(quiet).then(connectFolder);
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return; // user cancelled the picker
      toast('Could not open that folder: ' + err.message, true);
    });
  }

  function connectFolder() {
    if (!dirHandle) return Promise.resolve();
    return dirHandle.requestPermission({ mode: 'readwrite' }).then(function (perm) {
      if (perm !== 'granted') {
        dirStatus = 'needs-permission';
        renderFolder();
        return;
      }
      dirStatus = 'connected';
      return readFolder().then(function (disk) {
        // Union both sides so a record that only exists on one of them survives.
        ws = RT.mergeWorkspace(ws, disk);
        saveLocal();
        applySettings();
        render();
        return writeFolder().then(function () {
          markSaved(true);
          toast('Workspace folder connected. ' + describeWorkspace() + '.');
        });
      });
    }).catch(function (err) {
      dirStatus = 'needs-permission';
      renderFolder();
      toast('Could not reconnect the folder: ' + err.message, true);
    });
  }

  function forgetFolder() {
    dirHandle = null;
    dirStatus = 'none';
    idbDel(DIR_KEY).catch(quiet);
    renderFolder();
    toast('Folder forgotten. Your work is still saved in this browser.');
  }

  function restoreFolder() {
    if (!folderSupported()) {
      dirStatus = 'unsupported';
      renderFolder();
      return Promise.resolve();
    }
    return idbGet(DIR_KEY).catch(quiet).then(function (handle) {
      if (!handle) { dirStatus = 'none'; renderFolder(); return; }
      dirHandle = handle;
      return handle.queryPermission({ mode: 'readwrite' }).then(function (perm) {
        if (perm === 'granted') return connectFolder();
        dirStatus = 'needs-permission';
        renderFolder();
      });
    }).catch(function () {
      dirStatus = 'none';
      renderFolder();
    });
  }

  function describeWorkspace() {
    var bits = [];
    bits.push(ws.profile ? 'profile included' : 'no profile yet');
    bits.push(ws.jobs.length + (ws.jobs.length === 1 ? ' job' : ' jobs'));
    bits.push(ws.coverLetters.length + (ws.coverLetters.length === 1 ? ' letter' : ' letters'));
    return bits.join(', ');
  }

  /* ------------------------------------------------------------- export/import */

  function exportWorkspace() {
    var blob = new Blob([JSON.stringify(ws, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'workspace.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Exported workspace.json. It holds no API key.');
  }

  function importWorkspace(file) {
    file.text().then(function (text) {
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        toast('That file is not valid JSON.', true);
        return;
      }
      if (!parsed || typeof parsed !== 'object') {
        toast('That file does not look like a workspace.', true);
        return;
      }
      // Merge rather than replace, so importing on a machine that already has
      // work cannot silently destroy it.
      ws = RT.mergeWorkspace(ws, parsed);
      applySettings();
      render();
      flushSave();
      toast('Imported and merged. Now holding ' + describeWorkspace() + '.');
    }).catch(function (err) {
      toast('Could not read that file: ' + err.message, true);
    });
  }

  /* ------------------------------------------------------------------- key */

  function loadKey() {
    apiKey = safeGet(sessionStorage, KEY_NAME) || '';
    if (!apiKey && ws.settings.rememberKey) apiKey = safeGet(localStorage, KEY_NAME) || '';
    $('key-input').value = apiKey;
    renderKeyNote();
  }

  function storeKey(value) {
    apiKey = String(value || '').trim();
    if (apiKey) safeSet(sessionStorage, KEY_NAME, apiKey);
    else safeRemove(sessionStorage, KEY_NAME);

    if (apiKey && ws.settings.rememberKey) safeSet(localStorage, KEY_NAME, apiKey);
    else safeRemove(localStorage, KEY_NAME);

    renderKeyNote();
  }

  function renderKeyNote() {
    var note = $('key-note');
    var messages = [];
    if (apiKey && apiKey.indexOf('sk-ant-') !== 0) {
      messages.push('That does not look like an Anthropic key. They start with sk-ant-.');
    }
    if (ws.settings.rememberKey && location.protocol === 'file:') {
      messages.push('Opened as a local file, so any other local page in this browser could read a remembered key. Serve the folder over localhost instead.');
    }
    if (!messages.length) { note.hidden = true; return; }
    note.hidden = false;
    note.className = 'note warn';
    note.textContent = messages.join(' ');
  }

  /* -------------------------------------------------------------- key test
     GET /v1/models authenticates without generating anything: no input or
     output tokens, and it is not the messages endpoint, so a test costs
     nothing and cannot eat a messages rate limit. */

  var ANTHROPIC_VERSION = '2023-06-01';

  function testKey() {
    if (!apiKey) {
      setKeyStatus('bad', 'Paste a key first.');
      return;
    }
    setKeyStatus('busy', 'checking...');
    fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true'
      }
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, body: body };
      });
    }).then(function (r) {
      if (r.status === 200) {
        var ids = (r.body.data || []).map(function (m) { return m.id; });
        var have = RT.MODELS.filter(function (m) { return ids.indexOf(m) !== -1; });
        setKeyStatus('ok', 'works · ' + ids.length + ' models, '
          + (have.length ? have.length + ' of the 3 here' : 'none of the 3 here'));
        restrictModelChoices(ids);
        return;
      }
      if (r.status === 401) { setKeyStatus('bad', 'key rejected'); return; }
      if (r.status === 403) { setKeyStatus('bad', 'key has no access to this'); return; }
      if (r.status === 429) { setKeyStatus('bad', 'rate limited, try again shortly'); return; }
      var msg = r.body && r.body.error && r.body.error.message ? r.body.error.message : ('HTTP ' + r.status);
      setKeyStatus('bad', msg);
    }).catch(function () {
      // A thrown fetch is the browser blocking it or no network, never a bad key.
      setKeyStatus('bad', 'could not reach the API (offline, or blocked by the browser)');
    });
  }

  function setKeyStatus(kind, text) {
    var el = $('key-status');
    el.className = 'keystatus ' + kind;
    el.textContent = '';
    if (kind === 'ok' || kind === 'bad') el.appendChild(makeDot(kind === 'ok' ? 'ok' : 'bad'));
    el.appendChild(document.createTextNode(text));
  }

  /* If the key cannot see a model, saying so on the picker beats a failed call later. */
  function restrictModelChoices(ids) {
    var select = $('set-model');
    for (var i = 0; i < select.options.length; i++) {
      var opt = select.options[i];
      var ok = ids.indexOf(opt.value) !== -1;
      opt.disabled = !ok;
      opt.textContent = opt.textContent.replace(/ · not on this key$/, '');
      if (!ok) opt.textContent += ' · not on this key';
    }
  }

  /* ------------------------------------------------------------ resume file
     The PDF is held in memory only. It is needed for one API call, and a
     base64 resume would eat most of the 5 MB local storage budget.
     ponytail: re-pick the file after a reload; store it in IndexedDB if that
     ever becomes annoying. */

  var stagedResume = null; // { name, size, base64 }

  function chooseResume(file) {
    if (!file) return;
    var MAX = 10 * 1024 * 1024;
    if (file.size > MAX) {
      toast('That file is ' + formatSize(file.size) + '. Resumes are normally well under 1 MB, so this is probably not one.', true);
      return;
    }
    // Trust the bytes, not the extension.
    file.slice(0, 5).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      var isPdf = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
      if (!isPdf) {
        toast('That is not a PDF. Export your resume as a PDF and try again.', true);
        return;
      }
      return readAsBase64(file).then(function (base64) {
        stagedResume = { name: file.name, size: file.size, base64: base64 };
        renderInventory();
        toast('Loaded ' + file.name + '. It stays on this machine until you extract it.');
      });
    }).catch(function (err) {
      toast('Could not read that file: ' + err.message, true);
    });
  }

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        // A data URL's payload is unbroken base64, which is what the API wants.
        var s = String(reader.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(reader.error || new Error('unreadable')); };
      reader.readAsDataURL(file);
    });
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function renderInventory() {
    var host = $('inventory');
    host.textContent = '';

    if (!stagedResume && !ws.profile) {
      host.className = 'doc empty';
      host.appendChild(buildEmpty('No profile yet',
        ['Add your resume as a PDF to start. Every bullet is pulled out word for word, tagged, and stored with the real numbers behind it.',
         'Nothing here is generated. The inventory only ever holds what you wrote or told it.']));
      return;
    }

    host.className = 'doc doc-pad';

    if (stagedResume) {
      var card = document.createElement('div');
      card.className = 'filecard';

      var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('width', '20'); icon.setAttribute('height', '20');
      icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', '#8f4222'); icon.setAttribute('stroke-width', '2');
      icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('stroke-linejoin', 'round');
      var p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p1.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z');
      var p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p2.setAttribute('d', 'M14 2v6h6');
      icon.appendChild(p1); icon.appendChild(p2);
      card.appendChild(icon);

      var grow = document.createElement('div');
      grow.className = 'grow';
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = stagedResume.name;
      var meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = formatSize(stagedResume.size) + ' · ready to extract';
      grow.appendChild(name);
      grow.appendChild(meta);
      card.appendChild(grow);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link-btn';
      remove.textContent = 'Remove';
      remove.addEventListener('click', function () {
        stagedResume = null;
        renderInventory();
      });
      card.appendChild(remove);
      host.appendChild(card);

      var extract = document.createElement('button');
      extract.type = 'button';
      extract.className = 'btn btn-accent';
      extract.textContent = 'Extract profile';
      extract.disabled = true;
      host.appendChild(extract);

      var note = document.createElement('p');
      note.className = 'note';
      note.textContent = apiKey
        ? 'Extraction is the next step in the build. Your file is loaded and waiting.'
        : 'Add your API key on the left, then extraction runs here. Extraction is the next step in the build.';
      host.appendChild(note);
    }
  }

  function buildEmpty(heading, paragraphs) {
    var inner = document.createElement('div');
    inner.className = 'empty-inner';
    var h = document.createElement('h3');
    h.textContent = heading;
    inner.appendChild(h);
    paragraphs.forEach(function (text, i) {
      var p = document.createElement('p');
      if (i === paragraphs.length - 1 && paragraphs.length > 1) p.className = 'muted';
      p.textContent = text;
      inner.appendChild(p);
    });
    return inner;
  }

  /* ------------------------------------------------------------------ jobs */

  var openJobId = null;

  function openJob(id) {
    openJobId = id;
    ws.settings.lastOpenJobId = id;
    touchSettings();
    var job = findJob(id);
    $('job-title').value = job ? job.title : '';
    $('job-company').value = job ? job.company : '';
    $('job-ad').value = job ? job.adText : '';
    renderJobs();
  }

  function findJob(id) {
    for (var i = 0; i < ws.jobs.length; i++) if (ws.jobs[i].id === id) return ws.jobs[i];
    return null;
  }

  function newJobDraft() {
    openJobId = null;
    ws.settings.lastOpenJobId = null;
    touchSettings();
    $('job-title').value = '';
    $('job-company').value = '';
    $('job-ad').value = '';
    renderJobs();
    $('job-title').focus();
  }

  /* Create the record the moment there is anything worth keeping, so a pasted
     ad is never lost to a stray reload. */
  function captureJobForm() {
    var title = $('job-title').value;
    var company = $('job-company').value;
    var adText = $('job-ad').value;
    var hasContent = title.trim() || company.trim() || adText.trim();

    var job = openJobId ? findJob(openJobId) : null;
    if (!job) {
      if (!hasContent) { renderJobs(); return; }
      job = RT.newJob();
      ws.jobs.unshift(job);
      openJobId = job.id;
      ws.settings.lastOpenJobId = job.id;
      ws.settingsUpdatedAt = new Date().toISOString();
    }

    job.title = title;
    job.company = company;
    if (job.adText !== adText) {
      job.adText = adText;
      job.pastedAt = adText.trim() ? new Date().toISOString() : null;
    }
    RT.stamp(job);
    scheduleSave();
    renderJobs();
  }

  function deleteJob() {
    var job = openJobId ? findJob(openJobId) : null;
    if (!job) return;
    var label = job.title || job.company || 'this job';
    if (!window.confirm('Delete ' + label + '? This cannot be undone.')) return;
    ws.jobs = ws.jobs.filter(function (j) { return j.id !== job.id; });
    // The folder keeps its own copy, so remove that too or it comes back on reconnect.
    removeRecordFile('jobs', job.id);
    newJobDraft();
    flushSave();
    toast('Deleted ' + label + '.');
  }

  function removeRecordFile(folderName, id) {
    if (!dirHandle || dirStatus !== 'connected') return;
    dirHandle.getDirectoryHandle(folderName).then(function (dir) {
      return dir.removeEntry(id + '.json');
    }).catch(quiet);
  }

  function renderJobs() {
    var list = $('job-list');
    list.textContent = '';

    RT.byNewest(ws.jobs).forEach(function (job) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'jobrow';
      if (job.id === openJobId) row.setAttribute('aria-current', 'true');

      var top = document.createElement('div');
      top.className = 'top';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = job.title || 'Untitled job';
      var tag = document.createElement('span');
      tag.className = 'tag ' + job.status;
      tag.textContent = job.status;
      top.appendChild(name);
      top.appendChild(tag);
      row.appendChild(top);

      if (job.company) {
        var where = document.createElement('span');
        where.className = 'where';
        where.textContent = job.company;
        row.appendChild(where);
      }

      var when = document.createElement('span');
      when.className = 'when';
      when.textContent = RT.wordCount(job.adText) + ' words · ' + shortDate(job.updatedAt);
      row.appendChild(when);

      row.addEventListener('click', function () { openJob(job.id); });
      list.appendChild(row);
    });

    if (!ws.jobs.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-note';
      empty.style.padding = '0 20px';
      empty.textContent = 'No jobs yet. Paste an ad to start one.';
      list.appendChild(empty);
    }

    var words = RT.wordCount($('job-ad').value);
    $('job-wordcount').textContent = words + (words === 1 ? ' word' : ' words');
    $('delete-job').hidden = !openJobId;
    $('analyse-job').disabled = true;

    var hint = $('job-hint');
    if (!words) hint.textContent = 'Paste the whole ad. Analysis reads it on your machine and sends it to Claude with your key.';
    else if (words < 80) hint.textContent = 'That is short for an ad. More text gives a better requirements table.';
    else if (!apiKey) hint.textContent = 'Add your API key on the Profile screen to analyse this ad.';
    else hint.textContent = 'Saved. Analysis is the next step in the build.';

    renderCounts();
  }

  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  /* ---------------------------------------------------------------- render */

  function applySettings() {
    var s = ws.settings;
    $('set-model').value = s.model;
    setRadio('effort', s.effort);
    setRadio('stage', s.careerStage);
    $('set-pages').value = String(s.pageTarget);
    $('set-workrights').checked = s.workRightsLine;
    $('set-workrights-text').value = s.workRightsText;
    $('workrights-row').hidden = !s.workRightsLine;
    $('set-referees').checked = s.refereesLine;
    $('key-remember').checked = s.rememberKey;
  }

  function setRadio(name, value) {
    var inputs = document.querySelectorAll('input[name="' + name + '"]');
    for (var i = 0; i < inputs.length; i++) inputs[i].checked = (inputs[i].value === value);
  }

  function render() {
    renderReadout();
    renderProfileStrip();
    renderInventory();
    renderJobs(); // ends with renderCounts
    renderFolder();
  }

  function renderReadout() {
    var short = ws.settings.model.replace('claude-', '').replace('-4-5', '-4.5');
    $('readout-model').textContent = 'model=' + short + ' effort=' + ws.settings.effort;
  }

  function renderProfileStrip() {
    var p = ws.profile;
    var bullets = p && p.bullets ? Object.keys(p.bullets) : [];
    var live = bullets.filter(function (id) { return !p.bullets[id].retired; });
    var review = p && Array.isArray(p.parseReview)
      ? p.parseReview.filter(function (r) { return !r.resolved; }).length
      : 0;

    $('profile-name').textContent = p && p.basics && p.basics.name ? p.basics.name : 'not imported yet';
    $('m-inventory').textContent = String(live.length);
    $('m-inventory-sub').textContent = live.length === 1 ? 'bullet' : 'bullets';
    $('m-review').textContent = String(review);
    $('review-count').textContent = review + ' to confirm';

    var roles = {};
    live.forEach(function (id) {
      (p.bullets[id].roles || []).forEach(function (r) { roles[r] = (roles[r] || 0) + 1; });
    });
    var names = Object.keys(roles).sort(function (a, b) { return roles[b] - roles[a]; });
    $('m-tagged').textContent = names.length ? names[0] + ' ' + roles[names[0]] : '–';

    var chips = $('profile-chips');
    chips.textContent = '';
    if (p) {
      addChip(chips, 'v' + (p.version || 1));
      if (p.source && p.source.filename) addChip(chips, 'source=' + p.source.filename);
    } else {
      addChip(chips, 'no profile');
    }
    addChip(chips, 'stage=' + ws.settings.careerStage, true);
    addChip(chips, 'pages=' + ws.settings.pageTarget + ' A4');
  }

  function addChip(parent, text, accent) {
    var span = document.createElement('span');
    span.className = 'chip' + (accent ? ' on' : '');
    span.textContent = text;
    parent.appendChild(span);
  }

  function renderCounts() {
    var jobs = ws.jobs.length + ' saved';
    $('jobs-count').textContent = jobs;
    $('jobs-count-2').textContent = jobs;
    $('letters-count').textContent = ws.coverLetters.length + ' saved';
  }

  function renderFolder() {
    var path = $('folder-path');
    var state = $('folder-state');
    var connect = $('folder-connect');
    var forget = $('folder-forget');
    var note = $('folder-note');

    forget.hidden = !dirHandle;
    state.className = 'folder-state';
    state.textContent = '';
    note.className = 'note';

    if (dirStatus === 'unsupported') {
      path.textContent = 'not available here';
      connect.textContent = 'Choose folder';
      connect.disabled = true;
      note.textContent = 'Saving to a folder needs a secure page. Serve this directory with '
        + 'python -m http.server 8080 and open localhost, or use Export and Import instead.';
      return;
    }

    connect.disabled = false;

    if (dirStatus === 'connected' && dirHandle) {
      path.textContent = dirHandle.name;
      state.className = 'folder-state ok';
      state.appendChild(makeDot('ok'));
      state.appendChild(document.createTextNode('connected'));
      connect.textContent = 'Change folder';
      note.textContent = 'Plain JSON files you can back up, commit or hand-edit. Your API key is never written here.';
      return;
    }

    if (dirStatus === 'needs-permission' && dirHandle) {
      path.textContent = dirHandle.name;
      state.className = 'folder-state wait';
      state.textContent = 'needs permission';
      connect.textContent = 'Reopen workspace';
      note.textContent = 'One click to reconnect and load what is in the folder.';
      return;
    }

    path.textContent = 'no folder connected';
    connect.textContent = 'Choose folder';
    note.textContent = 'Optional. Without it your work still saves in this browser, and Export moves it between machines.';
  }

  function makeDot(kind) {
    var s = document.createElement('span');
    s.className = 'dot ' + kind;
    return s;
  }

  /* ------------------------------------------------------------------ nav */

  var SCREENS = [
    { nav: 'nav-profile', panel: 'screen-profile' },
    { nav: 'nav-jobs', panel: 'screen-jobs' },
    { nav: 'nav-letters', panel: 'screen-letters' }
  ];

  function showScreen(navId) {
    SCREENS.forEach(function (s) {
      var on = s.nav === navId;
      $(s.nav).setAttribute('aria-selected', on ? 'true' : 'false');
      $(s.panel).hidden = !on;
    });
  }

  /* ----------------------------------------------------------------- wire */

  function wire() {
    SCREENS.forEach(function (s) {
      $(s.nav).addEventListener('click', function () { showScreen(s.nav); });
    });

    $('key-input').addEventListener('input', function () {
      storeKey(this.value);
      setKeyStatus('', '');
      renderJobs();
      renderInventory();
    });

    $('key-test').addEventListener('click', testKey);

    $('key-show').addEventListener('click', function () {
      var input = $('key-input');
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      this.textContent = show ? 'hide' : 'show';
      this.setAttribute('aria-pressed', show ? 'true' : 'false');
    });

    $('key-remember').addEventListener('change', function () {
      ws.settings.rememberKey = this.checked;
      touchSettings();
      storeKey(apiKey); // moves the key between localStorage and sessionStorage
    });

    $('set-model').addEventListener('change', function () {
      ws.settings.model = this.value;
      touchSettings();
      renderReadout();
    });

    document.querySelectorAll('input[name="effort"]').forEach(function (input) {
      input.addEventListener('change', function () {
        ws.settings.effort = this.value;
        touchSettings();
        renderReadout();
      });
    });

    document.querySelectorAll('input[name="stage"]').forEach(function (input) {
      input.addEventListener('change', function () {
        ws.settings.careerStage = this.value;
        // Career stage drives the default page target: one page for early
        // career, two for established, which is the Australian norm.
        ws.settings.pageTarget = (this.value === 'mid' || this.value === 'senior') ? 2 : 1;
        $('set-pages').value = String(ws.settings.pageTarget);
        touchSettings();
        renderProfileStrip();
      });
    });

    $('set-pages').addEventListener('change', function () {
      ws.settings.pageTarget = parseInt(this.value, 10);
      touchSettings();
      renderProfileStrip();
    });

    $('set-workrights').addEventListener('change', function () {
      ws.settings.workRightsLine = this.checked;
      $('workrights-row').hidden = !this.checked;
      touchSettings();
    });

    $('set-workrights-text').addEventListener('input', function () {
      ws.settings.workRightsText = this.value;
      touchSettings();
    });

    $('set-referees').addEventListener('change', function () {
      ws.settings.refereesLine = this.checked;
      touchSettings();
    });

    $('folder-connect').addEventListener('click', function () {
      if (dirStatus === 'needs-permission' && dirHandle) connectFolder();
      else pickFolder();
    });
    $('folder-forget').addEventListener('click', forgetFolder);

    $('add-resume').addEventListener('click', function () { $('resume-file').click(); });
    $('resume-file').addEventListener('change', function () {
      if (this.files && this.files[0]) chooseResume(this.files[0]);
      this.value = ''; // so picking the same file again still fires change
    });

    ['job-title', 'job-company', 'job-ad'].forEach(function (id) {
      $(id).addEventListener('input', captureJobForm);
    });
    $('new-job').addEventListener('click', newJobDraft);
    $('delete-job').addEventListener('click', deleteJob);

    $('btn-export').addEventListener('click', exportWorkspace);
    $('btn-import').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      if (this.files && this.files[0]) importWorkspace(this.files[0]);
      this.value = ''; // so re-importing the same file fires change again
    });

    // A pending debounce must not be lost when the tab goes away. localStorage
    // is synchronous, so the crash buffer is always current even here.
    window.addEventListener('pagehide', function () { if (saveTimer) saveLocal(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && saveTimer) saveLocal();
    });
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    var stored = safeGet(localStorage, LS_WORKSPACE);
    if (stored) {
      try {
        ws = RT.migrate(JSON.parse(stored));
      } catch (e) {
        ws = RT.defaultWorkspace();
        toast('Saved workspace was unreadable, so this is a fresh one. Import a backup to recover.', true);
      }
    }

    wire();
    applySettings();
    loadKey();

    // Come back to whatever was open last.
    var last = ws.settings.lastOpenJobId;
    if (last && findJob(last)) {
      openJobId = last;
      var job = findJob(last);
      $('job-title').value = job.title;
      $('job-company').value = job.company;
      $('job-ad').value = job.adText;
    }

    render();
    if (stored) markSaved(true);

    restoreFolder();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
