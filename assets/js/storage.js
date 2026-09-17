/*
 * Saved-model library.
 *
 * Models live in this browser's localStorage under one key. Each saved record
 * carries its own id, so saving one department's model can never overwrite
 * another department's: an overwrite only happens when the id matches, i.e.
 * when you re-save the model you actually have open.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SGStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'caromont.staffingGrid.models.v1';
  var LAST_KEY = 'caromont.staffingGrid.lastOpened.v1';

  function available() {
    try {
      var k = '__sg_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readAll() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeAll(list) {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    return list;
  }

  function list() {
    return readAll().sort(function (a, b) {
      var d = String(a.departmentName || '').localeCompare(String(b.departmentName || ''));
      if (d !== 0) return d;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  function get(id) {
    var found = readAll().filter(function (m) { return m.id === id; })[0];
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  /** Other saved models that share this department name (case/space-insensitive). */
  function findByDepartment(name, excludeId) {
    var norm = String(name || '').trim().toLowerCase();
    if (!norm) return [];
    return readAll().filter(function (m) {
      return String(m.departmentName || '').trim().toLowerCase() === norm && m.id !== excludeId;
    });
  }

  function save(model) {
    var all = readAll();
    var copy = JSON.parse(JSON.stringify(model));
    copy.updatedAt = new Date().toISOString();
    if (!copy.createdAt) copy.createdAt = copy.updatedAt;
    var idx = -1;
    for (var i = 0; i < all.length; i++) if (all[i].id === copy.id) { idx = i; break; }
    if (idx >= 0) all[idx] = copy; else all.push(copy);
    writeAll(all);
    setLastOpened(copy.id);
    return copy;
  }

  function remove(id) {
    writeAll(readAll().filter(function (m) { return m.id !== id; }));
    if (getLastOpened() === id) setLastOpened('');
  }

  function setLastOpened(id) {
    try { window.localStorage.setItem(LAST_KEY, id || ''); } catch (e) { /* ignore */ }
  }

  function getLastOpened() {
    try { return window.localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; }
  }

  function exportBackup() {
    return JSON.stringify({
      kind: 'caromont-staffing-grid-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      models: readAll()
    }, null, 2);
  }

  /**
   * Import a backup or a single exported model.
   * Existing records are matched by id and replaced only when replaceExisting
   * is true; otherwise the incoming record is given a fresh id so nothing is
   * clobbered.
   */
  function importBackup(json, replaceExisting) {
    var data = typeof json === 'string' ? JSON.parse(json) : json;
    var incoming = Array.isArray(data) ? data : (data.models || [data]);
    if (!incoming.length) return { added: 0, replaced: 0 };

    var all = readAll();
    var byId = {};
    all.forEach(function (m, i) { byId[m.id] = i; });
    var added = 0, replaced = 0;

    incoming.forEach(function (m) {
      if (!m || !m.departmentName && !m.positions) return;
      var copy = JSON.parse(JSON.stringify(m));
      if (copy.id && byId[copy.id] !== undefined) {
        if (replaceExisting) { all[byId[copy.id]] = copy; replaced++; return; }
        copy.id = 'mdl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        copy.versionLabel = (copy.versionLabel || 'v1') + ' (imported)';
      }
      if (!copy.id) copy.id = 'mdl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      all.push(copy);
      byId[copy.id] = all.length - 1;
      added++;
    });

    writeAll(all);
    return { added: added, replaced: replaced };
  }

  return {
    KEY: KEY,
    available: available,
    list: list,
    get: get,
    save: save,
    remove: remove,
    findByDepartment: findByDepartment,
    setLastOpened: setLastOpened,
    getLastOpened: getLastOpened,
    exportBackup: exportBackup,
    importBackup: importBackup
  };
});
