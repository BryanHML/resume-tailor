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

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  var selectedBulletId = null;

  function renderInventory() {
    var host = $('inventory');
    host.textContent = '';

    if (!stagedResume && !ws.profile) {
      host.className = 'pagehost empty';
      host.appendChild(buildEmpty('No profile yet',
        ['Add your resume as a PDF to start. Every bullet is pulled out word for word, tagged, and stored with the real numbers behind it.',
         'Nothing here is generated. The inventory only ever holds what you wrote or told it.']));
      return;
    }

    host.className = 'pagehost';

    if (stagedResume) {
      var card = el('div', 'filecard');
      var grow = el('div', 'grow');
      grow.appendChild(el('div', 'name', stagedResume.name));
      grow.appendChild(el('div', 'meta', formatSize(stagedResume.size)
        + (ws.profile ? ' · will replace the profile below' : ' · ready to extract')));
      card.appendChild(grow);

      var remove = el('button', 'link-btn', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', function () { stagedResume = null; renderInventory(); });
      card.appendChild(remove);
      host.appendChild(card);

      var actions = el('div', 'form-actions');
      var extract = el('button', 'btn btn-accent', 'Extract profile');
      extract.type = 'button';
      extract.disabled = !apiKey || busy;
      extract.addEventListener('click', function () { extractProfile(extract); });
      actions.appendChild(extract);
      host.appendChild(actions);

      var note = el('p', 'note', apiKey
        ? 'Runs one call on ' + ws.settings.model.replace('claude-', '') + '. Bullets are copied word for word; anything uncertain lands in the parse review.'
        : 'Add your API key on the left to run the extraction.');
      host.appendChild(note);
    }

    if (!ws.profile) return;

    // The inventory sits on A4 sheets like the tailored resume, so the person
    // sees how much of a page their raw material fills. The staged-file card
    // above stays outside the sheets; the flow below is paginated into them.
    var p = ws.profile;
    var flow = [];

    var header = keep(el('div', 'inv-header'));
    header.appendChild(el('div', 'inv-name', p.basics.name || 'Unnamed'));
    var contact = [p.basics.city, p.basics.state, p.basics.phone, p.basics.email, p.basics.linkedin]
      .filter(Boolean).join(' · ');
    header.appendChild(el('div', 'inv-contact', contact));
    flow.push(header);

    if (p.skills && p.skills.length) {
      flow.push(keep(el('div', 'inv-heading', 'Skills')));
      p.skills.forEach(function (group) {
        var row = el('div', 'inv-skillrow');
        row.appendChild(el('span', 'inv-skillgroup', group.group + ': '));
        row.appendChild(document.createTextNode(group.items.join(' · ')));
        flow.push(row);
      });
    }

    (p.sections || []).forEach(function (section) {
      flow.push(keep(el('div', 'inv-heading', section.title)));
      (section.items || []).forEach(function (item) {
        var head = keep(el('div', 'inv-item'));
        var left = el('div', 'inv-item-name');
        left.appendChild(el('strong', null, item.heading));
        if (item.subheading) left.appendChild(document.createTextNode(' · ' + item.subheading));
        head.appendChild(left);
        var dates = [item.dates.start, item.dates.end].filter(Boolean).join(' – ');
        if (dates) head.appendChild(el('span', 'inv-dates mono', dates));
        flow.push(head);
        (item.bullets || []).forEach(function (id) {
          var b = p.bullets[id];
          if (b && !b.retired) flow.push(bulletBlock(b));
        });
      });
    });

    var fromGaps = RT.liveBullets(p).filter(function (b) { return b.source && b.source.type === 'gap'; });
    if (fromGaps.length) {
      flow.push(keep(el('div', 'inv-heading', 'From your answers')));
      fromGaps.forEach(function (b) { flow.push(bulletBlock(b)); });
    }

    var sheets = el('div', 'sheets');
    host.appendChild(sheets);
    paginate(sheets, flow);
  }

  function bulletBlock(b) {
    var row = el('button', 'inv-bullet');
    row.type = 'button';
    if (b.id === selectedBulletId) row.setAttribute('aria-current', 'true');
    row.appendChild(el('span', 'inv-dot', '•'));

    var body = el('div', 'grow');
    body.appendChild(el('div', null, b.text));
    if (b.tags.length || b.roles.length) {
      var tags = el('div', 'inv-tags mono');
      b.roles.forEach(function (r) { tags.appendChild(el('span', 'tag role', r)); });
      b.tags.slice(0, 6).forEach(function (t) { tags.appendChild(el('span', 'tag', t)); });
      body.appendChild(tags);
    }
    row.appendChild(body);

    if (!b.numbers.length) row.appendChild(el('span', 'flag amber mono', 'no metric'));
    row.addEventListener('click', function () {
      selectedBulletId = b.id;
      renderInventory();
      renderBulletInspector();
    });
    return row;
  }

  function renderBulletInspector() {
    var host = $('bullet-inspector');
    host.textContent = '';
    var b = ws.profile && selectedBulletId ? ws.profile.bullets[selectedBulletId] : null;
    $('bullet-id').textContent = b ? b.id : '';

    if (!b) {
      host.appendChild(el('p', 'empty-note',
        'Select a bullet to see its text, the numbers on record behind it and where each one came from.'));
      return;
    }

    var text = el('div', 'field');
    text.appendChild(el('span', 'field-label mono', 'text'));
    text.appendChild(el('div', 'readonly-box', b.text));
    host.appendChild(text);

    var nums = el('div', 'field');
    nums.appendChild(el('span', 'field-label mono', 'numbers on record'));
    if (b.numbers.length) {
      var grid = el('div', 'kv');
      b.numbers.forEach(function (n) {
        grid.appendChild(el('div', 'kv-key mono', n.value));
        grid.appendChild(el('div', null, n.what + ' · from ' + n.source));
      });
      nums.appendChild(grid);
    } else {
      nums.appendChild(el('p', 'note', 'No number in this bullet. Tailoring will never add one, so if there is a real figure behind it, add it here.'));
    }
    host.appendChild(nums);

    var meta = el('div', 'field');
    meta.appendChild(el('span', 'field-label mono', 'tags and roles'));
    var chips = el('div', 'inv-tags mono');
    b.roles.forEach(function (r) { chips.appendChild(el('span', 'tag role', r)); });
    b.tags.forEach(function (t) { chips.appendChild(el('span', 'tag', t)); });
    if (!b.roles.length && !b.tags.length) chips.appendChild(el('span', 'muted', 'none'));
    meta.appendChild(chips);
    host.appendChild(meta);

    var src = el('div', 'field');
    src.appendChild(el('span', 'field-label mono', 'source'));
    src.appendChild(el('div', null, b.source.type === 'gap'
      ? 'Your answer to a gap question'
      : 'Your resume, ' + (ws.profile.source.filename || 'imported PDF')));
    host.appendChild(src);
  }

  function renderParseReview() {
    var host = $('parse-review');
    host.textContent = '';
    var items = ws.profile && ws.profile.parseReview ? ws.profile.parseReview : [];
    var open = items.filter(function (r) { return !r.resolved; });
    $('review-count').textContent = open.length + ' to confirm';

    if (!items.length) {
      host.appendChild(el('p', 'empty-note', 'Anything the import could not read with confidence is listed here.'));
      return;
    }

    items.forEach(function (r) {
      var row = el('div', 'review-row' + (r.resolved ? ' done' : ''));
      var body = el('div', 'grow');
      body.appendChild(el('div', 'review-field mono', r.field));
      body.appendChild(el('div', 'review-note', r.note));
      row.appendChild(body);
      var mark = el('button', 'link-btn', r.resolved ? 'undo' : 'got it');
      mark.type = 'button';
      mark.addEventListener('click', function () {
        r.resolved = !r.resolved;
        RT.stamp(ws.profile);
        scheduleSave();
        renderParseReview();
        renderProfileStrip();
      });
      row.appendChild(mark);
      host.appendChild(row);
    });
  }

  /* --------------------------------------------------------- running a call
     These take 30 to 90 seconds. Lock the button, say what is happening, and
     always report what it cost, because it is the person's own money. */

  var busy = false;

  function runCall(label, button, build, onResult) {
    if (busy) return;
    if (!apiKey) { toast('Add your API key on the Profile screen first.', true); return; }
    busy = true;
    var original = button.textContent;
    button.disabled = true;
    button.textContent = label + '...';

    var model = ws.settings.model;
    var started = Date.now();

    Promise.resolve(build()).then(function (body) {
      return RTClaude.send(apiKey, body, function () {
        var secs = Math.round((Date.now() - started) / 1000);
        button.textContent = label + '... ' + secs + 's';
      });
    }).then(function (message) {
      var result = RTClaude.readJson(message);
      var spent = RTClaude.cost(model, message.usage);
      onResult(result, message);
      toast(label + ' finished in ' + Math.round((Date.now() - started) / 1000) + 's · '
        + RTClaude.money(spent) + ' on ' + model.replace('claude-', ''));
    }).catch(function (err) {
      toast(err.message, true);
    }).then(function () {
      busy = false;
      button.disabled = false;
      button.textContent = original;
      render();
    });
  }

  function extractProfile(button) {
    runCall('Extracting', button, function () {
      return RTClaude.extractRequest({
        prompts: RTPrompts,
        model: ws.settings.model,
        effort: ws.settings.effort,
        pdfBase64: stagedResume.base64,
        careerStage: ws.settings.careerStage
      });
    }, function (extracted) {
      ws.profile = RT.buildProfile(
        extracted,
        { type: 'pdf', filename: stagedResume.name, importedAt: new Date().toISOString() },
        ws.profile
      );
      stagedResume = null;
      selectedBulletId = null;
      flushSave();
    });
  }

  function analyseAd(button) {
    var job = openJobId ? findJob(openJobId) : null;
    if (!job) return;
    if (!ws.profile) { toast('Import your resume first, so there is something to compare the ad against.', true); return; }

    runCall('Analysing', button, function () {
      return RTClaude.analyseRequest({
        prompts: RTPrompts,
        model: ws.settings.model,
        effort: ws.settings.effort,
        inventory: RT.inventoryLines(ws.profile),
        skills: RT.skillLines(ws.profile),
        adText: job.adText
      });
    }, function (analysis) {
      job.role = analysis.role;
      job.shape = analysis.shape;
      job.analysis = {
        requirements: analysis.requirements.map(function (r, i) {
          return Object.assign({ id: 'r' + (i + 1) }, r);
        }),
        predicted: analysis.predicted || [],
        adInstructions: analysis.adInstructions || [],
        coverageBefore: RT.coverage(analysis.requirements)
      };
      job.gaps = (analysis.gaps || []).map(function (g, i) {
        return { id: 'q' + (i + 1), requirement: g.requirement, question: g.question, answer: '', skipped: false, bulletId: null };
      });
      job.status = 'analysed';
      adEditing = false; // show the marked-up ad, not the textarea
      RT.stamp(job);
      flushSave();
    });
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
    adEditing = false;
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
    adEditing = false;
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
    var job = openJobId ? findJob(openJobId) : null;
    $('job-wordcount').textContent = words + (words === 1 ? ' word' : ' words');
    $('delete-job').hidden = !openJobId;

    var analyse = $('analyse-job');
    analyse.disabled = busy || !apiKey || !ws.profile || words < 20;
    analyse.textContent = job && job.analysis ? 'Re-analyse ad' : 'Analyse ad';

    var hint = $('job-hint');
    if (!words) hint.textContent = 'Paste the whole ad. It is read here and sent to Claude with your key, nowhere else.';
    else if (words < 20) hint.textContent = 'That is too short to analyse. Paste the whole ad.';
    else if (!ws.profile) hint.textContent = 'Import your resume on the Profile screen first, so the ad has something to be compared against.';
    else if (!apiKey) hint.textContent = 'Add your API key on the Profile screen to analyse this ad.';
    else if (words < 80) hint.textContent = 'That is short for an ad. More text gives a better requirements table.';
    else if (job && job.analysis) hint.textContent = 'Analysed. Re-analysing replaces the requirements and the gap questions.';
    else hint.textContent = 'Ready. One call on ' + ws.settings.model.replace('claude-', '') + '.';

    renderAdPane(job);
    renderJobStrip(job);
    renderRequirements(job, $('requirements'), null);
    applyLayouts(); // the analysed state has its own default widths
    renderCounts();
    if (tailorOpen) renderTailor();
  }

  /* ---------------------------------------------------------- the ad pane
     Before analysis the textarea is the job. After it, the ad is reference:
     what you want is to see where each requirement actually appears, so it
     becomes a read-only view with the matched terms marked. */

  var adEditing = false;

  function renderAdPane(job) {
    var box = $('job-ad');
    var view = $('job-ad-view');
    var toggle = $('ad-toggle');
    var analysed = !!(job && job.analysis);

    toggle.hidden = !analysed;
    toggle.textContent = adEditing ? 'Done editing' : 'Edit ad';

    if (!analysed || adEditing) {
      box.hidden = false;
      view.hidden = true;
      $('job-ad-label').textContent = 'job ad · paste the full text';
      return;
    }

    box.hidden = true;
    view.hidden = false;
    $('job-ad-label').textContent = 'job ad · matched requirements marked';
    paintAd(view, job.adText, job.analysis.requirements);
  }

  /* Collect every alias worth looking for. A requirement's own name is only
     useful when it is short enough to appear literally; "Proficiency in Python
     for data analysis" never will. */
  function adTerms(requirements) {
    var terms = [];
    (requirements || []).forEach(function (r) {
      var candidates = (r.aliases || []).slice();
      if (r.name && r.name.split(/\s+/).length <= 3) candidates.push(r.name);
      candidates.forEach(function (t) {
        if (t && t.length > 1) terms.push({ term: t, req: r });
      });
    });
    // Longest first so "Power BI" wins over "BI".
    terms.sort(function (a, b) { return b.term.length - a.term.length; });
    return terms;
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* Built with createElement and text nodes, never innerHTML: the ad is pasted
     from a website and must never be able to inject markup here. */
  function paintAd(host, text, requirements) {
    host.textContent = '';
    var terms = adTerms(requirements);
    if (!terms.length) { host.textContent = text; return; }

    var pattern = terms.map(function (t) { return escapeRe(t.term); }).join('|');
    var re;
    try {
      re = new RegExp('(?<![\\w-])(' + pattern + ')(?![\\w-])', 'gi');
    } catch (e) {
      host.textContent = text;
      return;
    }

    var lookup = {};
    terms.forEach(function (t) {
      var k = t.term.toLowerCase();
      if (!lookup[k]) lookup[k] = t.req;
    });

    var last = 0;
    var match;
    var counts = {};
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) host.appendChild(document.createTextNode(text.slice(last, match.index)));
      var req = lookup[match[0].toLowerCase()];
      var mark = document.createElement('mark');
      mark.textContent = match[0];
      if (req) {
        mark.dataset.req = req.id;
        mark.title = req.name + ' · weight ' + req.weight + ' · ' + req.status;
        counts[req.id] = (counts[req.id] || 0) + 1;
        mark.addEventListener('click', function () { focusRequirement(req.id); });
      }
      host.appendChild(mark);
      last = match.index + match[0].length;
    }
    if (last < text.length) host.appendChild(document.createTextNode(text.slice(last)));
  }

  /* Clicking a requirement row, or one of its marks in the ad, lights up every
     occurrence and scrolls the first into view. */
  function focusRequirement(reqId) {
    var view = $('job-ad-view');
    if (view.hidden) return;
    var marks = view.querySelectorAll('mark');
    var first = null;
    for (var i = 0; i < marks.length; i++) {
      var on = marks[i].dataset.req === reqId;
      marks[i].classList.toggle('hot', on);
      if (on && !first) first = marks[i];
    }
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return !!first;
  }

  function renderJobStrip(job) {
    var a = job && job.analysis;
    $('m-role').textContent = job && job.role ? job.role : '–';
    $('m-role-sub').textContent = job && job.shape
      ? (job.shape.length > 60 ? job.shape.slice(0, 57) + '...' : job.shape)
      : (job ? 'not analysed' : 'no job open');
    if (job && job.shape) $('m-role-sub').title = job.shape;

    var pct = a ? Math.round(a.coverageBefore * 100) : null;
    $('m-coverage').textContent = pct === null ? '–' : pct + '%';
    var bar = $('m-coverage-bar');
    bar.style.width = (pct || 0) + '%';
    bar.style.background = pct === null ? 'transparent'
      : pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';

    var open = job ? (job.gaps || []).filter(function (g) { return !g.answer && !g.skipped; }).length : 0;
    $('m-gaps').textContent = job && job.gaps ? String(open) : '–';
    $('m-gaps-sub').textContent = job && job.gaps && job.gaps.length
      ? open + ' of ' + job.gaps.length + ' unanswered'
      : 'open questions';
  }

  /* Shared by the Job screen (host = #requirements) and the Tailor screen,
     where `cv` carries how often each requirement appears in the document. */
  function renderRequirements(job, host, cv) {
    host.textContent = '';
    var a = job && job.analysis;
    $(cv ? 't-req-count' : 'req-count').textContent = a ? a.requirements.length + ' from the ad' : '';

    if (!a) {
      var body = el('div', 'panel-body');
      body.appendChild(el('p', 'empty-note',
        'Analyse an ad to see its requirements, their weight, how often each appears, and what in your profile evidences it.'));
      host.appendChild(body);
      return;
    }

    if (!cv && a.adInstructions && a.adInstructions.length) {
      var callout = el('div', 'callout');
      callout.appendChild(el('div', 'callout-head', 'The ad asks you to do this'));
      a.adInstructions.forEach(function (x) {
        var row = el('div', 'callout-row');
        row.appendChild(el('div', null, x.instruction));
        row.appendChild(el('div', 'callout-quote', '“' + x.quote + '”'));
        callout.appendChild(row);
      });
      host.appendChild(callout);
    }

    var head = el('div', 'reqhead mono' + (cv ? ' withcv' : ''));
    (cv ? ['requirement', 'wt', 'ad', 'cv', 'status'] : ['requirement', 'wt', 'ad', 'status']).forEach(function (label, i) {
      head.appendChild(el('div', i === 0 ? null : 'right', label));
    });
    host.appendChild(head);

    a.requirements.slice().sort(function (x, y) { return y.weight - x.weight; }).forEach(function (r) {
      var row = el('div', 'reqrow mono' + (cv ? ' withcv' : ''));
      var name = el('div', 'reqname');
      name.textContent = r.name;
      name.title = r.name + (r.required ? ' (required)' : ' (preferred)')
        + (r.evidence && r.evidence.length ? '\nEvidence: ' + r.evidence.join(', ') : '\nNo evidence in your profile.');
      if (!r.required) name.appendChild(el('span', 'pref mono', ' pref'));
      row.appendChild(name);
      row.appendChild(el('div', 'right', String(r.weight)));
      row.appendChild(el('div', 'right', String(r.adCount)));
      if (cv) row.appendChild(el('div', 'right' + (cv[r.id] ? '' : ' muted'), String(cv[r.id] || 0)));
      var status = el('div', 'right');
      status.appendChild(el('span', 'tag ' + r.status, r.status));
      row.appendChild(status);
      row.addEventListener('click', function () {
        if (cv) { if (!focusTerm(r)) showEvidence(r); }
        else if (!focusRequirement(r.id)) showEvidence(r);
      });
      host.appendChild(row);
    });

    if (!cv && a.predicted && a.predicted.length) {
      var pred = el('div', 'predicted mono');
      pred.appendChild(el('span', 'muted', 'expected but not in the ad: '));
      pred.appendChild(document.createTextNode(a.predicted.join(' · ')));
      host.appendChild(pred);
    }

    var gaps = (job.gaps || []).filter(function (g) { return !cv || (!g.answer && !g.skipped); });
    if (gaps.length) {
      var gapHead = el('div', 'panel-head');
      gapHead.appendChild(el('h2', 'sm', cv ? 'Gap questions still open' : 'Gap questions'));
      var openCount = job.gaps.filter(function (g) { return !g.answer && !g.skipped; }).length;
      gapHead.appendChild(el('span', 'mono muted', openCount + ' open'));
      host.appendChild(gapHead);

      var gapBody = el('div', 'panel-body');
      gaps.forEach(function (g) {
        gapBody.appendChild(gapCard(job, g));
      });
      host.appendChild(gapBody);
    }

    if (!cv) {
      var foot = el('div', 'panel-body');
      var go = el('button', 'btn btn-accent btn-block', job.tailored && job.tailored.version ? 'Open tailored resume' : 'Tailor resume');
      go.type = 'button';
      go.addEventListener('click', function () { openTailor(); });
      foot.appendChild(go);
      var openGaps = job.gaps.filter(function (g) { return !g.answer && !g.skipped; }).length;
      if (openGaps) {
        var skip = el('button', 'link-btn', 'Skip the ' + openGaps + ' open ' + (openGaps === 1 ? 'gap' : 'gaps') + ' and tailor anyway');
        skip.type = 'button';
        skip.addEventListener('click', function () {
          job.gaps.forEach(function (g) { if (!g.answer) g.skipped = true; });
          RT.stamp(job);
          scheduleSave();
          openTailor();
        });
        foot.appendChild(skip);
      }
      host.appendChild(foot);
    }
  }

  function gapCard(job, g) {
    var card = el('div', 'gapcard' + (g.answer ? ' answered' : g.skipped ? ' skipped' : ''));
    var top = el('div', 'gaptop');
    top.appendChild(el('span', 'gapid mono', g.id.toUpperCase()));
    top.appendChild(el('div', 'grow', g.question));
    card.appendChild(top);

    var box = document.createElement('textarea');
    box.className = 'gapanswer';
    box.rows = 2;
    box.value = g.answer;
    box.placeholder = 'Answer in your own words, or skip. Nothing is added unless you write it here.';
    box.addEventListener('input', function () {
      g.answer = this.value;
      if (this.value.trim()) g.skipped = false;
      RT.stamp(job);
      scheduleSave();
    });
    // Only re-render on blur; re-rendering per keystroke would steal focus.
    box.addEventListener('blur', function () {
      saveGapAsBullet(job, g);
      renderJobs();
      // The answer just became a profile bullet, so the Profile screen's
      // inventory and counts are now stale too.
      renderProfileStrip();
      renderInventory();
    });
    card.appendChild(box);

    var foot = el('div', 'gapfoot');
    foot.appendChild(el('span', 'mono muted', g.requirement));
    var skip = el('button', 'link-btn', g.skipped ? 'unskip' : 'skip');
    skip.type = 'button';
    skip.addEventListener('click', function () {
      g.skipped = !g.skipped;
      RT.stamp(job);
      scheduleSave();
      renderJobs();
    });
    foot.appendChild(skip);
    card.appendChild(foot);
    return card;
  }

  /* An answered gap becomes a real bullet in the profile, so the next ad that
     asks the same thing already has the evidence. */
  function saveGapAsBullet(job, g) {
    if (!ws.profile) return;
    var answer = (g.answer || '').trim();

    if (!answer) {
      if (g.bulletId && ws.profile.bullets[g.bulletId]) {
        delete ws.profile.bullets[g.bulletId];
        g.bulletId = null;
        RT.stamp(ws.profile);
        scheduleSave();
      }
      return;
    }

    var id = g.bulletId || RT.newId('gap');
    g.bulletId = id;
    ws.profile.bullets[id] = {
      id: id,
      text: answer,
      tags: [],
      roles: job.role ? [job.role] : [],
      numbers: [],
      source: { type: 'gap', jobId: job.id, date: new Date().toISOString() },
      retired: false
    };
    RT.stamp(ws.profile);
    scheduleSave();
  }

  function showEvidence(r) {
    if (!r.evidence || !r.evidence.length) {
      toast(r.name + ': nothing in your profile evidences this yet.');
      return;
    }
    var texts = r.evidence.map(function (id) {
      var b = ws.profile && ws.profile.bullets[id];
      return b ? '• ' + b.text : null;
    }).filter(Boolean);
    toast(r.name + ' — ' + (texts[0] || 'evidence bullet no longer in the profile'));
  }

  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  /* ---------------------------------------------------------------- tailor
     The document on screen is rebuilt from profile + changes on every render
     (RT.buildDoc). Nothing here edits text in place: every action, including
     the person's own edits, becomes a change with a decision, so the record of
     what came from where is never lost. */

  var tailorOpen = false;
  var selectedBlockId = null;
  var editingBlockId = null;
  var undoStack = [];
  var redoStack = [];
  var lastDoc = null;
  var lastLint = [];
  var lastFit = null;
  var PRINTABLE = 994; // 297mm less two 17mm margins, at 96dpi
  var LINE_PX = 18.5; // 10.5pt Arial at line-height 1.32

  function openTailor() {
    var job = openJobId ? findJob(openJobId) : null;
    if (!job || !job.analysis || !ws.profile) return;
    if (!job.tailored) job.tailored = RT.newTailored();
    tailorOpen = true;
    selectedBlockId = null;
    editingBlockId = null;
    undoStack = [];
    redoStack = [];
    $('screen-jobs').hidden = true;
    $('screen-tailor').hidden = false;
    applyLayouts();
    renderTailor();
    if (!job.tailored.version && apiKey && !busy) $('t-tailor').focus();
    else $('t-pagehost').focus();
  }

  function closeTailor() {
    tailorOpen = false;
    $('screen-tailor').hidden = true;
    $('screen-jobs').hidden = false;
    renderJobs();
  }

  function currentJob() {
    return tailorOpen && openJobId ? findJob(openJobId) : null;
  }

  function findChange(job, id) {
    if (!job || !job.tailored || !id) return null;
    for (var i = 0; i < job.tailored.changes.length; i++) if (job.tailored.changes[i].id === id) return job.tailored.changes[i];
    return null;
  }

  /* Undo is in memory only, as snapshots of the change list, per the spec. */
  function snapshot(job) {
    undoStack.push(JSON.stringify(job.tailored.changes));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
  }

  function undo(job) {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(job.tailored.changes));
    job.tailored.changes = JSON.parse(undoStack.pop());
    afterChange(job);
  }

  function redo(job) {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(job.tailored.changes));
    job.tailored.changes = JSON.parse(redoStack.pop());
    afterChange(job);
  }

  function afterChange(job) {
    job.tailored.updatedAt = new Date().toISOString();
    if (job.status === 'analysed') job.status = 'tailoring';
    RT.stamp(job);
    scheduleSave();
    renderTailor();
  }

  function decide(job, change, decision) {
    if (!change) return;
    snapshot(job);
    change.decision = decision;
    if (decision !== 'edited') change.editedText = null;
    afterChange(job);
  }

  function userChange(job, fields) {
    var n = job.tailored.changes.length + 1;
    var c = Object.assign({
      id: 'c' + n, target: { sectionId: '', itemId: '', bulletId: '' }, original: '', suggested: '', list: [],
      why: '', sources: [{ type: 'user', id: '' }], decision: 'accepted', editedText: null
    }, fields);
    // Ids must be unique across the list even after deletions, so bump past any clash.
    while (findChange(job, c.id)) c.id = 'c' + (++n);
    job.tailored.changes.push(c);
    return c;
  }

  /* Editing a block. With a change on it, the edit becomes that change's
     final text. Without one, the edit is a new change the person made. */
  function saveEdit(job, block, text) {
    text = text.trim();
    snapshot(job);
    var c = findChange(job, block.changeId);
    if (c && c.kind !== 'hide') {
      if (text === c.original) { c.decision = 'rejected'; c.editedText = null; }
      else if (text === c.suggested) { c.decision = 'accepted'; c.editedText = null; }
      else { c.decision = 'edited'; c.editedText = text; }
    } else if (block.id === 'summary' || block.id === 'headline') {
      var orig = block.id === 'summary' ? (ws.profile.summary || '') : '';
      if (text !== orig) userChange(job, { kind: block.id, original: orig, suggested: text, editedText: text, decision: 'edited', why: 'Written by you.' });
    } else if (block.id === 'skills') {
      userChange(job, { kind: 'skills-order', original: RT.flatSkills(ws.profile).join(' · '), editedText: text, decision: 'edited', why: 'Ordered by you.' });
    } else {
      var b = ws.profile.bullets[block.id];
      if (b && text !== b.text) {
        userChange(job, { kind: 'rewrite', target: { sectionId: '', itemId: block.itemId, bulletId: block.id },
          original: b.text, suggested: text, editedText: text, decision: 'edited', why: 'Rewritten by you.' });
      }
    }
    editingBlockId = null;
    afterChange(job);
  }

  function toggleHide(job, block) {
    snapshot(job);
    var hide = findChange(job, block.hideId);
    if (hide) hide.decision = hide.decision === 'rejected' ? 'accepted' : 'rejected';
    else userChange(job, { kind: 'hide', target: { sectionId: '', itemId: block.itemId, bulletId: block.id }, original: block.text, why: 'Hidden by you.' });
    afterChange(job);
  }

  function moveBullet(job, block, dir) {
    var item = null;
    lastDoc.sections.forEach(function (s) { s.items.forEach(function (it) { if (it.id === block.itemId) item = it; }); });
    if (!item) return;
    var ids = item.bullets.map(function (b) { return b.id; });
    var i = ids.indexOf(block.id);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(i, 1);
    ids.splice(j, 0, block.id);
    snapshot(job);
    var existing = null;
    job.tailored.changes.forEach(function (c) { if (c.kind === 'reorder' && c.target.itemId === block.itemId) existing = c; });
    if (existing) { existing.list = ids; existing.decision = 'accepted'; existing.sources = [{ type: 'user', id: '' }]; existing.why = 'Ordered by you.'; }
    else userChange(job, { kind: 'reorder', target: { sectionId: '', itemId: block.itemId, bulletId: '' }, list: ids, why: 'Ordered by you.' });
    afterChange(job);
  }

  /* ------------------------------------------------------------ the call */

  function runTailor(button, trimLines) {
    var job = currentJob();
    if (!job) return;
    var doc = RT.buildDoc(ws.profile, job.tailored, ws.settings);
    var decisions = RT.decisionsForModel(job.tailored.changes);
    var reqs = job.analysis.requirements;

    runCall(trimLines ? 'Trimming' : 'Tailoring', button, function () {
      return RTClaude.tailorRequest({
        prompts: RTPrompts,
        model: ws.settings.model,
        effort: ws.settings.effort,
        careerStage: ws.settings.careerStage,
        pageTarget: ws.settings.pageTarget,
        currentLines: RT.estimateLines(doc),
        role: job.role,
        shape: job.shape,
        title: job.title,
        company: job.company,
        requirements: reqs,
        outline: RT.outlineForModel(ws.profile),
        inventory: RT.inventoryLines(ws.profile),
        skills: RT.skillLines(ws.profile),
        summary: ws.profile.summary,
        locked: decisions.locked,
        rejected: decisions.rejected,
        trimLines: trimLines || 0,
        adText: job.adText
      });
    }, function (result) {
      snapshot(job);
      // Pending proposals from the last run are superseded; decisions stay.
      var kept = job.tailored.changes.filter(function (c) { return c.decision !== 'pending'; });
      var fresh = RT.normaliseChanges(result.changes, ws.profile, kept);
      job.tailored.changes = kept.concat(fresh);
      job.tailored.version += 1;
      job.tailored.note = result.note || '';
      job.tailored.updatedAt = new Date().toISOString();
      job.status = 'tailoring';
      selectedBlockId = null;
      RT.stamp(job);
      flushSave();
      if (fresh.length) selectedBlockId = blockIdForChange(fresh[0]);
      if (result.note) toast(result.note);
    });
  }

  function blockIdForChange(c) {
    if (c.kind === 'summary' || c.kind === 'headline') return c.kind;
    if (c.kind === 'skills-order') return 'skills';
    if (c.kind === 'reorder') return c.list[0] || null;
    return c.target.bulletId;
  }

  /* ---------------------------------------------------------------- render */

  function renderTailor() {
    var job = currentJob();
    if (!job) return;
    var t = job.tailored;
    lastDoc = RT.buildDoc(ws.profile, t, ws.settings);
    lastLint = RT.lintDoc(lastDoc, job.adText);
    var known = RT.profileNumbers(ws.profile);
    var hits = RT.keywordHits(RT.docText(lastDoc), job.analysis.requirements);
    var blocks = RT.docBlocks(lastDoc);
    var pending = t.changes.filter(function (c) { return c.decision === 'pending'; }).length;
    var decided = t.changes.filter(function (c) { return c.decision !== 'pending'; }).length;

    // Number and skill checks per change, cached on the change for the inspector.
    t.changes.forEach(function (c) {
      if (c.decision === 'rejected') { c.numbersCheck = { ok: true, unmatched: [] }; return; }
      var text = c.kind === 'skills-order' ? '' : RT.effectiveText(c);
      c.numbersCheck = RT.numbersCheck(text, known);
      if (c.kind === 'skills-order') {
        var bad = RT.unknownSkills(c.decision === 'edited' ? (lastDoc.skills ? lastDoc.skills.list : []) : c.list, ws.profile);
        c.numbersCheck = { ok: !bad.length, unmatched: bad };
      }
    });

    job.coverageAfter = hits.coverage;

    $('t-title').textContent = (job.title || 'Untitled job') + (job.company ? ' · ' + job.company : '');
    var chips = $('t-chips');
    chips.textContent = '';
    addChip(chips, 'role=' + (job.role || '?'), true);
    addChip(chips, 'stage=' + ws.settings.careerStage);
    addChip(chips, 'pages=' + ws.settings.pageTarget + ' A4');
    if (t.version) addChip(chips, 'v' + t.version);

    $('t-version').textContent = t.version
      ? 'tailored v' + t.version + ' · ' + pending + ' pending · ' + decided + ' decided'
      : 'not tailored yet · showing your profile as it stands';
    $('t-tailor').textContent = t.version ? 'Re-tailor' : 'Tailor';
    $('t-tailor').disabled = busy || !apiKey;
    $('t-export').disabled = busy;

    renderRequirements(job, $('t-requirements'), hits.counts);
    renderPage(job, lastDoc, blocks);
    var fit = measureFit(job);
    renderTailorStrip(job, hits, fit);
    renderInspector(job, blocks);
    renderLint(job);
  }

  function renderTailorStrip(job, hits, fit) {
    var pct = Math.round(hits.coverage * 100);
    $('t-coverage').textContent = pct + '%';
    var bar = $('t-coverage-bar');
    bar.style.width = pct + '%';
    bar.style.background = pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';

    // Structural checks 1 to 9 hold by construction of the template. 10 and
    // 11 are checked here. 12 (the exported PDF extracts in order) needs the
    // PDF, which is the next milestone.
    var dates = [];
    lastDoc.sections.forEach(function (s) { s.items.forEach(function (it) { dates.push(it.dates.start, it.dates.end); }); });
    var datesOk = dates.filter(Boolean).every(function (d) { return /^(\d{2}\/\d{4}|\d{4}|Present)$/.test(d); });
    var pagesOk = fit.pages <= ws.settings.pageTarget;
    var safe = 9 + (datesOk ? 1 : 0) + (pagesOk ? 1 : 0);
    $('t-safety').textContent = safe + '/12';
    $('t-safety-sub').textContent = safe === 11 ? 'pdf not checked yet' : (!pagesOk ? 'over page target' : 'dates inconsistent');
    $('t-safety-bar').style.width = Math.round(safe / 12 * 100) + '%';
    $('t-safety-bar').style.background = safe >= 11 ? 'var(--green)' : 'var(--amber)';

    var byKind = {};
    lastLint.forEach(function (f) { byKind[f.kind] = (byKind[f.kind] || 0) + 1; });
    var unmatched = job.tailored.changes.filter(function (c) { return c.numbersCheck && !c.numbersCheck.ok; }).length;
    var flags = lastLint.length + unmatched;
    $('t-flags').textContent = String(flags);
    var subs = Object.keys(byKind).map(function (k) { return byKind[k] + ' ' + k; });
    if (unmatched) subs.unshift(unmatched + ' unsourced');
    $('t-flags-sub').textContent = subs.slice(0, 3).join(' · ') || 'none';
    $('t-flags-bar').style.width = Math.min(100, flags * 10) + '%';
    $('t-flags-bar').style.background = unmatched ? 'var(--red)' : flags ? 'var(--amber)' : 'var(--green)';

    $('t-fit').textContent = fit.percent + '%';
    $('t-fit-sub').textContent = fit.pages > ws.settings.pageTarget
      ? 'over by ' + fit.overLines + (fit.overLines === 1 ? ' line' : ' lines')
      : 'of page ' + ws.settings.pageTarget;
    $('t-fit-bar').style.width = Math.min(100, fit.percent) + '%';
    $('t-fit-bar').style.background = fit.pages > ws.settings.pageTarget ? 'var(--red)' : 'var(--accent)';
    $('t-trim').hidden = !(fit.pages > ws.settings.pageTarget && job.tailored.version);
  }

  /* Flow a list of nodes onto A4 sheets, the way a word processor does: fill
     a sheet, and when a node no longer fits, start the next sheet with it.
     A node marked keepWithNext (a heading, an item head) is carried over with
     the node after it, so no heading is left alone at the foot of a page.
     Bullets (li) are wrapped in a ul per sheet, so a list can continue over.
     Layout is measured live, which is why the nodes go into the DOM first. */
  function paginate(host, nodes) {
    host.textContent = '';
    var page, inner, ul, placed;
    function newPage() {
      page = el('div', 'page');
      inner = el('div', 'p-inner');
      page.appendChild(inner);
      host.appendChild(page);
      ul = null;
      placed = [];
    }
    function place(node) {
      if (node.tagName === 'LI') {
        if (!ul) { ul = document.createElement('ul'); inner.appendChild(ul); }
        ul.appendChild(node);
      } else {
        ul = null;
        inner.appendChild(node);
      }
      placed.push(node);
    }
    function unplace() {
      var node = placed.pop();
      var parent = node.parentNode;
      node.remove();
      if (parent.tagName === 'UL' && !parent.childNodes.length) { parent.remove(); if (ul === parent) ul = null; }
      return node;
    }
    newPage();
    nodes.forEach(function (node) {
      place(node);
      var limit = inner.getBoundingClientRect().bottom + 0.5;
      if (node.getBoundingClientRect().bottom <= limit || placed.length === 1) return;
      var carry = [unplace()];
      while (placed.length > 1 && placed[placed.length - 1].keepWithNext) carry.unshift(unplace());
      newPage();
      carry.forEach(place);
    });
    return host.querySelectorAll('.page').length;
  }

  function keep(node) { node.keepWithNext = true; return node; }

  /* The page is built with createElement only. Everything in it came either
     from the person's own PDF or from the model, and neither is trusted as HTML. */
  function renderPage(job, doc, blocks) {
    var flow = [];
    var re = termRegex(job.analysis.requirements);
    var flagsByBlock = {};
    lastLint.forEach(function (f) { (flagsByBlock[f.blockId] = flagsByBlock[f.blockId] || []).push(f); });

    function badge(text, cls) { return el('span', 'p-badge ' + cls, text); }

    function decorate(node, block) {
      node.classList.add('sel');
      node.dataset.block = block.id;
      var c = findChange(job, block.changeId);
      if (c) node.classList.add(c.decision);
      if (block.id === selectedBlockId) node.classList.add('selected');
      node.setAttribute('tabindex', '-1');
      node.addEventListener('click', function () {
        if (editingBlockId) return;
        selectedBlockId = block.id;
        renderTailor();
      });
      node.addEventListener('dblclick', function () { startEdit(block); });
    }

    function fill(node, block) {
      if (editingBlockId === block.id) {
        var box = document.createElement('textarea');
        box.className = 'p-edit';
        box.value = block.text;
        box.rows = Math.max(2, Math.ceil(block.text.length / 90));
        box.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.preventDefault(); editingBlockId = null; renderTailor(); }
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(job, block, box.value); }
        });
        box.addEventListener('blur', function () { if (editingBlockId === block.id) saveEdit(job, block, box.value); });
        node.appendChild(box);
        setTimeout(function () { box.focus(); box.select(); }, 0);
        return;
      }
      highlight(node, block.text, re);
      var c = findChange(job, block.changeId);
      if (c && c.decision === 'pending') node.appendChild(badge(c.kind === 'hide' ? 'hide?' : c.id, 'accent'));
      if (c && c.numbersCheck && !c.numbersCheck.ok) node.appendChild(badge('unsourced ' + c.numbersCheck.unmatched.join(', '), 'red'));
      (flagsByBlock[block.id] || []).slice(0, 2).forEach(function (f) {
        node.appendChild(badge(f.kind, f.kind === 'ai-tell' ? 'red' : 'amber'));
      });
    }

    var byId = {};
    blocks.forEach(function (b) { byId[b.id] = b; });

    var head = keep(el('div', 'p-head'));
    head.appendChild(el('p', 'p-name', doc.basics.name || 'Your name'));
    if (byId.headline) { var h = el('p', 'p-headline'); decorate(h, byId.headline); fill(h, byId.headline); head.appendChild(h); }
    var contact = [
      [doc.basics.city, doc.basics.state].filter(Boolean).join(' '),
      doc.basics.phone, doc.basics.email, doc.basics.linkedin, doc.basics.portfolio, doc.workRights
    ].filter(Boolean).join(' · ');
    head.appendChild(el('p', 'p-contact', contact));
    flow.push(head);

    if (byId.summary) {
      flow.push(keep(el('h2', null, 'Summary')));
      var sp = el('p', 'p-block'); decorate(sp, byId.summary); fill(sp, byId.summary); flow.push(sp);
    }
    if (byId.skills) {
      flow.push(keep(el('h2', null, 'Key Skills')));
      var kp = el('p', 'p-block p-skills'); decorate(kp, byId.skills); fill(kp, byId.skills); flow.push(kp);
    }

    doc.sections.forEach(function (s) {
      flow.push(keep(el('h2', null, sectionTitle(s))));
      s.items.forEach(function (it) {
        var ih = keep(el('div', 'p-item-head'));
        var left = el('div');
        left.appendChild(el('b', null, it.heading));
        if (it.subheading) left.appendChild(document.createTextNode(' · ' + it.subheading));
        ih.appendChild(left);
        var d = [it.dates.start, it.dates.end].filter(Boolean).join(' – ');
        if (d) ih.appendChild(el('span', 'p-dates', d));
        flow.push(ih);
        it.bullets.filter(function (b) { return !b.hidden; }).forEach(function (b) {
          var block = byId[b.id];
          var li = document.createElement('li');
          decorate(li, block);
          fill(li, block);
          flow.push(li);
        });
      });
    });

    if (doc.referees) flow.push(el('p', 'p-referees', 'Referees available on request.'));
    paginate($('t-pagehost'), flow);

    // "Too long" is a rendered property, so it is checked here, after layout.
    $('t-pagehost').querySelectorAll('li.sel').forEach(function (li) {
      if (li.offsetHeight > LINE_PX * 2.6) {
        li.appendChild(badge('too-long', 'amber'));
        lastLint.push({ blockId: li.dataset.block, changeId: null, kind: 'too-long', note: 'over two lines' });
      }
    });
  }

  function sectionTitle(s) {
    var std = { experience: 'Experience', projects: 'Projects', education: 'Education', certifications: 'Certifications' };
    return std[s.kind] || s.title;
  }

  /* How full the document is against the page target, from the real sheets. */
  function measureFit(job) {
    var sheets = $('t-pagehost').querySelectorAll('.page');
    var pages = sheets.length || 1;
    var last = sheets[pages - 1];
    var inner = last ? last.querySelector('.p-inner') : null;
    var used = 0;
    if (inner && inner.lastElementChild) {
      used = inner.lastElementChild.getBoundingClientRect().bottom - inner.getBoundingClientRect().top;
    }
    var printable = inner ? inner.getBoundingClientRect().height : PRINTABLE;
    var content = (pages - 1) * printable + used;
    var target = ws.settings.pageTarget;
    var over = content - printable * target;
    lastFit = {
      pages: pages,
      percent: Math.round(content / (printable * target) * 100),
      overLines: over > 0 ? Math.ceil(over / LINE_PX) : 0
    };
    return lastFit;
  }

  function termRegex(requirements) {
    var terms = adTerms(requirements).map(function (t) { return escapeRe(t.term); });
    if (!terms.length) return null;
    try { return new RegExp('(?<![\\w-])(' + terms.join('|') + ')(?![\\w-])', 'gi'); } catch (e) { return null; }
  }

  function highlight(host, text, re) {
    if (!re) { host.appendChild(document.createTextNode(text)); return; }
    var last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) host.appendChild(document.createTextNode(text.slice(last, m.index)));
      host.appendChild(el('span', 'p-kw', m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) host.appendChild(document.createTextNode(text.slice(last)));
  }

  /* Clicking a requirement on the tailor screen jumps to its first mention. */
  function focusTerm(r) {
    var re = termRegex([r]);
    if (!re) return false;
    var nodes = $('t-pagehost').querySelectorAll('.sel');
    for (var i = 0; i < nodes.length; i++) {
      re.lastIndex = 0;
      if (re.test(nodes[i].textContent)) {
        selectedBlockId = nodes[i].dataset.block;
        renderTailor();
        var hit = $('t-pagehost').querySelector('.sel.selected');
        if (hit) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------ inspector */

  function pendingChanges(job) {
    return job.tailored.changes.filter(function (c) { return c.decision === 'pending'; });
  }

  function renderInspector(job, blocks) {
    var host = $('t-inspector');
    host.textContent = '';
    var block = null;
    blocks.forEach(function (b) { if (b.id === selectedBlockId) block = b; });
    var c = block ? findChange(job, block.changeId) : null;
    var pend = pendingChanges(job);
    var pos = c ? pend.indexOf(c) : -1;

    $('t-change-title').textContent = c ? 'Change ' + c.id : (block ? 'Block ' + block.id : 'Changes');
    $('t-change-pos').textContent = pos >= 0 ? (pos + 1) + ' of ' + pend.length + ' pending' : (pend.length ? pend.length + ' pending' : '');

    if (!block) {
      var body = el('div', 'panel-body');
      body.appendChild(el('p', 'empty-note', job.tailored.version
        ? (pend.length ? 'Click a highlighted block, or press J to step to the first pending change.' : 'No pending changes. Re-tailor to ask for more, or export.')
        : 'Press Tailor to get a set of proposed changes for this ad. Each one comes with a reason and a source, and nothing is applied until you accept it.'));
      host.appendChild(body);
      return;
    }

    if (c) {
      var diff = el('div', 'diff');
      var parts = wordDiff(c.original, c.kind === 'hide' ? '' : (c.decision === 'edited' ? c.editedText : c.suggested));
      if (c.kind === 'reorder') {
        diff.appendChild(el('p', 'note', 'Reorders the bullets in this item. Compare the page with your profile order.'));
      } else {
        if (c.original) diff.appendChild(diffLine('minus', parts.pre, parts.a, parts.post, 'del'));
        if (c.kind !== 'hide') diff.appendChild(diffLine('plus', parts.pre, parts.b, parts.post, 'ins'));
        else diff.appendChild(el('p', 'note', 'Hidden from this version. Your profile keeps it.'));
      }
      host.appendChild(diff);

      var meta = el('div', 'inspect-body');
      meta.appendChild(field('decision', el('span', 'decision-chip ' + c.decision, c.decision + (c.kind === 'headline' ? ' · headline change' : ''))));
      if (c.why) meta.appendChild(field('why', el('div', null, c.why)));
      meta.appendChild(field('sources', sourcesGrid(job, c)));
      var nc = el('div', 'numcheck');
      nc.appendChild(makeDot(c.numbersCheck && c.numbersCheck.ok ? 'ok' : 'bad'));
      nc.appendChild(document.createTextNode(c.numbersCheck && c.numbersCheck.ok
        ? (c.kind === 'skills-order' ? 'every skill is in your profile' : (RT.numbersIn(RT.effectiveText(c) || '').length ? 'every number is on record' : 'no numbers in this text'))
        : 'not in your profile: ' + c.numbersCheck.unmatched.join(', ')));
      meta.appendChild(field(c.kind === 'skills-order' ? 'skills check' : 'numbers check', nc));
      host.appendChild(meta);

      var decide3 = el('div', 'decide');
      decide3.appendChild(decideBtn('Accept', 'A', 'btn-green', c.decision === 'accepted', function () { decide(job, c, 'accepted'); }));
      decide3.appendChild(decideBtn('Reject', 'R', 'btn-ghost', c.decision === 'rejected', function () { decide(job, c, 'rejected'); }));
      decide3.appendChild(decideBtn('Edit', 'E', 'btn-ghost', false, function () { startEdit(block); }));
      host.appendChild(decide3);

      var pn = el('div', 'prevnext mono');
      var prev = el('button', 'link-btn', '← prev (K)'); prev.type = 'button';
      prev.addEventListener('click', function () { stepChange(job, -1); });
      var next = el('button', 'link-btn', 'next (J) →'); next.type = 'button';
      next.addEventListener('click', function () { stepChange(job, 1); });
      pn.appendChild(prev); pn.appendChild(next);
      host.appendChild(pn);
    } else {
      var plain = el('div', 'inspect-body');
      plain.appendChild(field('text', el('div', 'readonly-box', block.text)));
      plain.appendChild(field('source', el('div', null, block.isBullet
        ? (ws.profile.bullets[block.id].source.type === 'gap' ? 'Your answer to a gap question' : 'Your resume, unchanged')
        : 'Your profile, unchanged')));
      host.appendChild(plain);
    }

    var menu = el('div', 'blockmenu');
    menu.appendChild(linkBtn('Edit (E)', function () { startEdit(block); }));
    if (block.isBullet) {
      menu.appendChild(linkBtn(block.hideId && findChange(job, block.hideId).decision !== 'rejected' ? 'Unhide' : 'Hide from this version', function () { toggleHide(job, block); }));
      menu.appendChild(linkBtn('Move up', function () { moveBullet(job, block, -1); }));
      menu.appendChild(linkBtn('Move down', function () { moveBullet(job, block, 1); }));
    }
    menu.appendChild(linkBtn('Undo (Ctrl+Z)', function () { undo(job); }));
    host.appendChild(menu);
  }

  function field(label, node) {
    var f = el('div', 'field');
    f.appendChild(el('span', 'field-label mono', label));
    f.appendChild(node);
    return f;
  }

  function linkBtn(text, fn) {
    var b = el('button', 'link-btn', text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  function decideBtn(text, key, cls, current, fn) {
    var b = el('button', 'btn ' + cls, text);
    b.type = 'button';
    b.appendChild(el('span', 'key', key));
    if (current) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', fn);
    return b;
  }

  function diffLine(cls, pre, mid, post, tag) {
    var line = el('div', 'diff-line ' + cls);
    line.appendChild(el('span', 'sign', cls === 'minus' ? '−' : '+'));
    var body = el('div');
    if (pre) body.appendChild(document.createTextNode(pre));
    if (mid) body.appendChild(el(tag, null, mid));
    if (post) body.appendChild(document.createTextNode(post));
    line.appendChild(body);
    return line;
  }

  /* Common prefix and suffix by word: enough to show what actually changed
     in a rewritten bullet without a diff library. */
  function wordDiff(a, b) {
    var wa = String(a || '').split(/(\s+)/), wb = String(b || '').split(/(\s+)/);
    var p = 0;
    while (p < wa.length && p < wb.length && wa[p] === wb[p]) p++;
    var s = 0;
    while (s < wa.length - p && s < wb.length - p && wa[wa.length - 1 - s] === wb[wb.length - 1 - s]) s++;
    return {
      pre: wa.slice(0, p).join(''),
      a: wa.slice(p, wa.length - s).join(''),
      b: wb.slice(p, wb.length - s).join(''),
      post: wa.slice(wa.length - s).join('')
    };
  }

  function sourcesGrid(job, c) {
    var grid = el('div', 'kv');
    if (!c.sources.length) {
      grid.appendChild(el('div', 'kv-key mono', 'none'));
      grid.appendChild(el('div', 'muted', 'No source given. Treat this change with suspicion.'));
    }
    c.sources.forEach(function (s) {
      var label = s.type, text = s.id;
      if (s.type === 'user') { label = 'you'; text = 'Your own edit.'; }
      else if (s.type === 'ad') {
        var r = null;
        job.analysis.requirements.forEach(function (x) { if (x.id === s.id) r = x; });
        label = 'ad';
        text = r ? r.name + ' · weight ' + r.weight : s.id;
      } else {
        var b = ws.profile.bullets[s.id];
        label = b && b.source.type === 'gap' ? 'gap answer' : 'profile';
        text = b ? s.id + ' · ' + (b.text.length > 90 ? b.text.slice(0, 87) + '...' : b.text) : s.id + ' · no longer in the profile';
      }
      grid.appendChild(el('div', 'kv-key mono', label));
      grid.appendChild(el('div', null, text));
    });
    return grid;
  }

  function renderLint(job) {
    var host = $('t-lint');
    host.textContent = '';
    var unmatched = job.tailored.changes.filter(function (c) { return c.numbersCheck && !c.numbersCheck.ok; });
    $('t-lint-count').textContent = (lastLint.length + unmatched.length) + ' flags';
    if (!lastLint.length && !unmatched.length) {
      host.appendChild(el('p', 'empty-note', 'No flags. Metrics, verbs, spelling and AI-tell words all pass.'));
      return;
    }
    unmatched.forEach(function (c) {
      var row = el('div', 'lintrow');
      row.appendChild(el('span', 'kind red', 'unsourced'));
      row.appendChild(el('span', 'grow', c.id + ': ' + c.numbersCheck.unmatched.join(', ')));
      row.addEventListener('click', function () { selectedBlockId = blockIdForChange(c); renderTailor(); });
      host.appendChild(row);
    });
    lastLint.forEach(function (f) {
      var row = el('div', 'lintrow');
      row.appendChild(el('span', 'kind ' + (f.kind === 'ai-tell' ? 'red' : 'amber'), f.kind));
      row.appendChild(el('span', 'grow', f.blockId + ': ' + f.note));
      row.addEventListener('click', function () { selectedBlockId = f.blockId; renderTailor(); });
      host.appendChild(row);
    });
  }

  /* ------------------------------------------------------------ actions */

  function startEdit(block) {
    if (!block || busy) return;
    selectedBlockId = block.id;
    editingBlockId = block.id;
    renderTailor();
  }

  function stepChange(job, dir) {
    var pend = pendingChanges(job);
    if (!pend.length) { toast('No pending changes.'); return; }
    var blocks = RT.docBlocks(lastDoc);
    var current = null;
    blocks.forEach(function (b) { if (b.id === selectedBlockId) current = b; });
    var c = current ? findChange(job, current.changeId) : null;
    var i = c ? pend.indexOf(c) : -1;
    var next = pend[(i + dir + pend.length) % pend.length];
    selectedBlockId = blockIdForChange(next);
    renderTailor();
    var hit = $('t-pagehost').querySelector('.sel.selected');
    if (hit) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function selectedBlock() {
    var out = null;
    RT.docBlocks(lastDoc).forEach(function (b) { if (b.id === selectedBlockId) out = b; });
    return out;
  }

  function tailorKeys(e) {
    var job = currentJob();
    if (!job || editingBlockId) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (tag === 'button' && (e.key === 'Enter' || e.key === ' ')) return; // let the button click
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo(job) : undo(job); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(job); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var block = selectedBlock();
    var c = block ? findChange(job, block.changeId) : null;
    switch (e.key) {
      case 'j': case 'J': case 'ArrowDown': stepChange(job, 1); break;
      case 'k': case 'K': case 'ArrowUp': stepChange(job, -1); break;
      case 'a': case 'A': if (c) decide(job, c, 'accepted'); break;
      case 'r': case 'R': if (c) decide(job, c, 'rejected'); break;
      case 'e': case 'E': case 'Enter': if (block) startEdit(block); break;
      case 'Escape': selectedBlockId = null; renderTailor(); break;
      default: return;
    }
    e.preventDefault();
  }

  /* Print the sheets alone. Each sheet is exactly A4 and carries its own
     margins as padding, so @page margin is zero and the browser adds no
     header or footer. */
  function exportPdf() {
    var job = currentJob();
    if (!job) return;
    var root = document.createElement('div');
    root.id = 'print-root';
    $('t-pagehost').querySelectorAll('.page').forEach(function (p) {
      var clone = p.cloneNode(true);
      clone.querySelectorAll('.p-badge, .p-edit').forEach(function (n) { n.remove(); });
      root.appendChild(clone);
    });
    document.body.appendChild(root);
    function done() {
      root.remove();
      window.removeEventListener('afterprint', done);
      job.status = 'exported';
      RT.stamp(job);
      flushSave();
      renderTailor();
    }
    window.addEventListener('afterprint', done);
    window.print();
  }

  function wireTailor() {
    $('t-back').addEventListener('click', closeTailor);
    $('t-tailor').addEventListener('click', function () { runTailor(this, 0); });
    $('t-trim').addEventListener('click', function () {
      runTailor(this, Math.max(1, lastFit ? lastFit.overLines : 1));
    });
    $('t-export').addEventListener('click', exportPdf);
    document.addEventListener('keydown', function (e) { if (tailorOpen) tailorKeys(e); });
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
    renderBulletInspector();
    renderParseReview();
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

  /* --------------------------------------------------------------- layout
     Each screen's side panels are draggable. The widths that matter change
     with what you are doing: while you are pasting an ad the textarea is the
     job, and once it is analysed the requirements are. So the default follows
     the phase, and any drag becomes a permanent override for that screen. */

  var LAYOUT_MIN = 220;
  var CENTRE_MIN = 300;

  var LAYOUT_DEFAULTS = {
    'screen-profile': { left: 300, right: 320 }, // leaves room for a real A4 sheet at 1440
    'screen-jobs': { left: 300, right: 460 },
    'screen-tailor': { left: 300, right: 310 }, // leaves room for a real A4 page at 1440
    'screen-letters': { left: 360, right: 380 }
  };
  // Once an ad is analysed the right panel carries the requirements and the
  // gap answers, which is where the work actually happens.
  var JOBS_ANALYSED = { left: 280, right: 640 };

  function layoutFor(screenId) {
    var saved = ws.settings.layout && ws.settings.layout[screenId];
    if (saved) return saved;
    if (screenId === 'screen-jobs') {
      var job = openJobId ? findJob(openJobId) : null;
      if (job && job.analysis) return JOBS_ANALYSED;
    }
    return LAYOUT_DEFAULTS[screenId];
  }

  function applyLayouts() {
    Object.keys(LAYOUT_DEFAULTS).forEach(function (screenId) {
      var panels = $(screenId).querySelector('.panels');
      if (!panels) return;
      var size = layoutFor(screenId);
      panels.style.setProperty('--col-left', size.left + 'px');
      panels.style.setProperty('--col-right', size.right + 'px');
      var dividers = panels.querySelectorAll('.divider');
      if (dividers[0]) dividers[0].setAttribute('aria-valuenow', String(size.left));
      if (dividers[1]) dividers[1].setAttribute('aria-valuenow', String(size.right));
    });
  }

  function setSize(screenId, side, px) {
    var panels = $(screenId).querySelector('.panels');
    var total = panels.getBoundingClientRect().width;
    var current = layoutFor(screenId);
    var other = side === 'left' ? current.right : current.left;
    // Leave the centre usable no matter how hard someone drags.
    var max = Math.max(LAYOUT_MIN, total - other - CENTRE_MIN - 10);
    var width = Math.round(Math.min(max, Math.max(LAYOUT_MIN, px)));

    if (!ws.settings.layout) ws.settings.layout = {};
    ws.settings.layout[screenId] = {
      left: side === 'left' ? width : current.left,
      right: side === 'right' ? width : current.right
    };
    applyLayouts();
  }

  function makeDivider(screenId, side) {
    var d = document.createElement('div');
    d.className = 'divider';
    d.setAttribute('role', 'separator');
    d.setAttribute('aria-orientation', 'vertical');
    d.setAttribute('tabindex', '0');
    d.setAttribute('aria-label', (side === 'left' ? 'Left' : 'Right')
      + ' panel width. Arrow keys to resize, double-click to reset.');

    // Track the drag ourselves rather than trusting pointer capture, which can
    // be lost mid-gesture and is not always available.
    var dragging = false;

    d.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      dragging = true;
      try { d.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
      d.classList.add('dragging');
      document.body.classList.add('resizing');
    });

    d.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var box = $(screenId).querySelector('.panels').getBoundingClientRect();
      setSize(screenId, side, side === 'left' ? e.clientX - box.left : box.right - e.clientX);
    });

    function stop(e) {
      if (!dragging) return;
      dragging = false;
      try { d.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      d.classList.remove('dragging');
      document.body.classList.remove('resizing');
      touchSettings();
    }
    d.addEventListener('pointerup', stop);
    d.addEventListener('pointercancel', stop);
    // If the pointer is released outside the divider, the gesture still ends.
    window.addEventListener('pointerup', stop);

    d.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 48 : 16;
      var current = layoutFor(screenId)[side];
      if (e.key === 'ArrowLeft') setSize(screenId, side, current + (side === 'left' ? -step : step));
      else if (e.key === 'ArrowRight') setSize(screenId, side, current + (side === 'left' ? step : -step));
      else return;
      e.preventDefault();
      touchSettings();
    });

    // Double-click hands the screen back to the automatic width.
    d.addEventListener('dblclick', function () {
      if (ws.settings.layout) delete ws.settings.layout[screenId];
      applyLayouts();
      touchSettings();
      toast('Panel widths reset to the default for this screen.');
    });

    return d;
  }

  function setupResizers() {
    Object.keys(LAYOUT_DEFAULTS).forEach(function (screenId) {
      var panels = $(screenId).querySelector('.panels');
      if (!panels) return;
      var centre = panels.querySelector('.panel-centre');
      var right = panels.querySelector('.panel-right');
      panels.insertBefore(makeDivider(screenId, 'left'), centre);
      panels.insertBefore(makeDivider(screenId, 'right'), right);
    });
    applyLayouts();
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
    // The tailor is a phase of the Jobs screen, reached from a job, never from the nav.
    tailorOpen = false;
    $('screen-tailor').hidden = true;
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
    $('analyse-job').addEventListener('click', function () { analyseAd(this); });
    $('ad-toggle').addEventListener('click', function () {
      adEditing = !adEditing;
      renderJobs();
      if (adEditing) $('job-ad').focus();
    });

    wireTailor();

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
    setupResizers();
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
