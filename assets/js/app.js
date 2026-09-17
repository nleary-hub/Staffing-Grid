/*
 * CaroMont Staffing Grid Builder - UI controller.
 */
(function () {
  'use strict';

  var DAYS = SGCalc.DAYS;
  var state = {
    model: SGCalc.newModel(),
    computed: null,
    dirty: false,
    savedId: null   // set once the open model exists in the library
  };

  /* ---------- small helpers ---------- */
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function fmt(n, dec) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: dec === undefined ? 2 : dec,
      maximumFractionDigits: dec === undefined ? 2 : dec
    });
  }
  function pct(n, dec) {
    if (!isFinite(n)) return '—';
    return fmt(n * 100, dec === undefined ? 1 : dec) + '%';
  }
  function signed(n, dec) {
    if (!isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + fmt(n, dec);
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function prettyDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function prettyStamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  var toastTimer;
  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2800);
  }

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  }
  function setPath(obj, path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var target = keys.reduce(function (o, k) { if (!o[k]) o[k] = {}; return o[k]; }, obj);
    target[last] = value;
  }

  function markDirty(dirty) {
    state.dirty = dirty;
    $('#save-state').textContent = dirty ? 'Unsaved changes' : (state.savedId ? 'All changes saved' : 'No unsaved changes');
    $('#save-state').style.color = dirty ? 'var(--danger)' : '';
  }

  /* ---------- field binding ---------- */
  function bindFields() {
    $$('[data-bind]').forEach(function (input) {
      var path = input.getAttribute('data-bind');
      var ev = input.tagName === 'SELECT' || input.type === 'date' ? 'change' : 'input';
      input.addEventListener(ev, function () {
        setPath(state.model, path, input.value);
        markDirty(true);
        recompute();
      });
    });
  }

  function fillFields() {
    $$('[data-bind]').forEach(function (input) {
      var v = getPath(state.model, input.getAttribute('data-bind'));
      input.value = v === null || v === undefined ? '' : v;
    });
    updatePtoLabel();
  }

  function updatePtoLabel() {
    var basis = state.model.budget.ptoBasis;
    var label = $('#pto-label'), hint = $('#pto-hint');
    if (basis === 'ptoFTE') {
      label.textContent = 'Budgeted PTO (FTE)';
      hint.textContent = 'Non-productive FTE carried in the budget, e.g. 4.6';
    } else if (basis === 'workedPct') {
      label.textContent = 'PTO % of worked hours';
      hint.textContent = 'Enter 11 for 11%.';
    } else {
      label.textContent = 'PTO % of paid hours';
      hint.textContent = 'Enter 11 for 11%. Historical usage works well here.';
    }
  }

  /* ---------- staffing grid ---------- */
  function renderGrid() {
    var body = $('#grid-body');
    body.innerHTML = '';

    if (!state.model.positions.length) {
      body.appendChild(el('tr', { class: 'empty-row' }, [
        el('td', { colspan: '18', text: 'No positions yet — choose "+ Add position" to start building the grid.' })
      ]));
    }

    state.model.positions.forEach(function (pos, index) {
      var computedRow = (state.computed && state.computed.positions[index]) || {};
      var tr = el('tr');

      tr.appendChild(el('td', {}, [el('input', {
        value: pos.role || '', placeholder: 'e.g. RN – Night',
        oninput: function (e) { pos.role = e.target.value; touchRow(); }
      })]));

      tr.appendChild(el('td', {}, [el('input', {
        value: pos.assignee || '', placeholder: 'Job title or person',
        oninput: function (e) { pos.assignee = e.target.value; touchRow(); }
      })]));

      var sel = el('select', {
        onchange: function (e) { pos.assigneeType = e.target.value; touchRow(); }
      }, [
        el('option', { value: 'title', text: 'Job title' }),
        el('option', { value: 'person', text: 'Person' }),
        el('option', { value: 'open', text: 'Open/TBD' })
      ]);
      sel.value = pos.assigneeType || 'title';
      tr.appendChild(el('td', {}, [sel]));

      tr.appendChild(el('td', {}, [el('input', {
        value: pos.shift || '', placeholder: 'e.g. 0700-1930',
        oninput: function (e) { pos.shift = e.target.value; touchRow(); }
      })]));

      tr.appendChild(el('td', { class: 'num' }, [el('input', {
        type: 'number', step: 'any', min: '0', value: pos.qty,
        oninput: function (e) { pos.qty = e.target.value; touchRow(); }
      })]));

      DAYS.forEach(function (d, i) {
        tr.appendChild(el('td', { class: 'day-cell' }, [el('input', {
          type: 'number', step: 'any', min: '0', value: pos.hours[i] || 0,
          'aria-label': d + ' hours',
          oninput: function (e) { pos.hours[i] = e.target.value; touchRow(); }
        })]));
      });

      tr.appendChild(el('td', { class: 'calc', text: fmt(computedRow.weeklyHoursPerPerson, 1) }));
      tr.appendChild(el('td', { class: 'calc', text: fmt(computedRow.weeklyHours, 1) }));
      tr.appendChild(el('td', { class: 'calc', text: fmt(computedRow.annualWorkedHours, 0) }));
      tr.appendChild(el('td', { class: 'calc', text: fmt(computedRow.wFTE, 2) }));
      tr.appendChild(el('td', { class: 'calc', text: fmt(computedRow.pFTE, 2) }));

      tr.appendChild(el('td', {}, [el('div', { class: 'row-actions' }, [
        el('button', {
          type: 'button', class: 'icon', title: 'Duplicate position', text: '⧉',
          onclick: function () {
            var copy = SGCalc.newPosition(JSON.parse(JSON.stringify(pos)));
            copy.id = 'pos_' + Math.random().toString(36).slice(2, 10);
            state.model.positions.splice(index + 1, 0, copy);
            markDirty(true); recompute(); renderGrid();
          }
        }),
        el('button', {
          type: 'button', class: 'icon ghost-danger', title: 'Remove position', text: '✕',
          onclick: function () {
            state.model.positions.splice(index, 1);
            markDirty(true); recompute(); renderGrid();
          }
        })
      ])]));

      body.appendChild(tr);
    });

    renderGridFoot();
  }

  // Recompute on cell edit without rebuilding inputs (keeps focus & caret).
  function touchRow() {
    markDirty(true);
    recompute();
    refreshGridCalcCells();
  }

  function refreshGridCalcCells() {
    var rows = $$('#grid-body tr');
    rows.forEach(function (tr, i) {
      var c = state.computed && state.computed.positions[i];
      if (!c) return;
      var cells = tr.querySelectorAll('td.calc');
      if (cells.length < 5) return;
      cells[0].textContent = fmt(c.weeklyHoursPerPerson, 1);
      cells[1].textContent = fmt(c.weeklyHours, 1);
      cells[2].textContent = fmt(c.annualWorkedHours, 0);
      cells[3].textContent = fmt(c.wFTE, 2);
      cells[4].textContent = fmt(c.pFTE, 2);
    });
    renderGridFoot();
  }

  function renderGridFoot() {
    var r = state.computed;
    var foot = $('#grid-foot');
    foot.innerHTML = '';
    if (!r) return;
    var tr = el('tr');
    tr.appendChild(el('td', { colspan: '4', text: 'TOTAL — ' + r.designed.positionCount + ' position row(s)' }));
    tr.appendChild(el('td', { class: 'num', text: fmt(r.designed.headcount, 1) }));
    r.designed.dailyHours.forEach(function (h) { tr.appendChild(el('td', { class: 'num', text: fmt(h, 1) })); });
    tr.appendChild(el('td', { class: 'num', text: '' }));
    tr.appendChild(el('td', { class: 'num', text: fmt(r.designed.weeklyHours, 1) }));
    tr.appendChild(el('td', { class: 'num', text: fmt(r.designed.annualWorkedHours, 0) }));
    tr.appendChild(el('td', { class: 'num' + (r.variance.overWorked ? ' flag-bad' : ''), text: fmt(r.designed.wFTE, 2) }));
    tr.appendChild(el('td', { class: 'num' + (r.variance.overPaid ? ' flag-bad' : ''), text: fmt(r.designed.pFTE, 2) }));
    tr.appendChild(el('td', { text: '' }));
    foot.appendChild(tr);
  }

  /* ---------- stat strips ---------- */
  function statCard(k, v, s, cls) {
    return el('div', { class: 'stat' + (cls ? ' ' + cls : '') }, [
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v', text: v }),
      s ? el('div', { class: 's', text: s }) : null
    ]);
  }

  function renderBudgetStats() {
    var r = state.computed, unit = r.inputs.volumeUnit || 'units';
    var box = $('#budget-stats');
    box.innerHTML = '';
    [
      statCard('Budgeted worked hours', fmt(r.budget.workedHours, 0), r.budget.wFTEIsOverride ? 'from entered wFTE' : fmt(r.budget.annualVolume, 0) + ' × ' + fmt(r.budget.whpu, 2) + ' WHpU'),
      statCard('Budgeted wFTE', fmt(r.budget.wFTE, 2), r.budget.wFTEIsOverride ? 'entered' : 'calculated'),
      statCard('Budgeted pFTE', fmt(r.budget.pFTE, 2), r.budget.pFTEIsOverride ? 'entered' : 'calculated'),
      statCard('Budgeted PTO FTE', fmt(r.budget.ptoFTE, 2), pct(r.budget.ptoPctOfPaid) + ' of paid hours'),
      statCard('Benefit gross-up', '× ' + fmt(r.budget.ptoFactor, 3), 'pFTE ÷ wFTE'),
      statCard('Avg ' + unit + ' / day', fmt(r.budget.avgDailyVolume, 1), fmt(r.inputs.daysPerYear, 0) + ' days per year')
    ].forEach(function (c) { box.appendChild(c); });
  }

  function renderVariance() {
    var r = state.computed;
    var box = $('#variance-stats');
    box.innerHTML = '';
    [
      statCard('Designed wFTE', fmt(r.designed.wFTE, 2), 'budget ' + fmt(r.budget.wFTE, 2), r.variance.overWorked ? 'bad' : 'good'),
      statCard('wFTE variance', signed(r.variance.wFTE, 2), r.variance.overWorked ? 'over budget' : 'under / at budget', r.variance.overWorked ? 'bad' : 'good'),
      statCard('Designed pFTE', fmt(r.designed.pFTE, 2), 'budget ' + fmt(r.budget.pFTE, 2), r.variance.overPaid ? 'bad' : 'good'),
      statCard('pFTE variance', signed(r.variance.pFTE, 2), r.variance.overPaid ? 'over budget' : 'under / at budget', r.variance.overPaid ? 'bad' : 'good'),
      statCard('Scheduled hrs / week', fmt(r.designed.weeklyHours, 1), fmt(r.designed.headcount, 1) + ' people'),
      statCard('Projected productivity', pct(r.productivity.productivityIndex), 'at budgeted volume')
    ].forEach(function (c) { box.appendChild(c); });

    var body = $('#variance-body');
    body.innerHTML = '';
    function row(label, designed, budget, variance, ratio, overFlag, dec) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: label }));
      tr.appendChild(el('td', { class: 'num' + (overFlag ? ' flag-bad' : ''), text: fmt(designed, dec) }));
      tr.appendChild(el('td', { class: 'num', text: fmt(budget, dec) }));
      tr.appendChild(el('td', { class: 'num' + (overFlag ? ' flag-bad' : ' flag-good'), text: signed(variance, dec) }));
      tr.appendChild(el('td', { class: 'num', text: pct(ratio) }));
      body.appendChild(tr);
    }
    row('Worked FTE (wFTE)', r.designed.wFTE, r.budget.wFTE, r.variance.wFTE, r.variance.wFTEPctOfBudget, r.variance.overWorked, 2);
    row('Paid FTE (pFTE)', r.designed.pFTE, r.budget.pFTE, r.variance.pFTE, r.variance.pFTEPctOfBudget, r.variance.overPaid, 2);
    row('Annual worked hours', r.designed.annualWorkedHours, r.budget.workedHours, r.variance.workedHours,
      r.budget.workedHours ? r.designed.annualWorkedHours / r.budget.workedHours : 0, r.variance.overWorked, 0);
    row('Annual paid hours', r.designed.annualPaidHours, r.budget.paidHours, r.designed.annualPaidHours - r.budget.paidHours,
      r.budget.paidHours ? r.designed.annualPaidHours / r.budget.paidHours : 0, r.variance.overPaid, 0);
  }

  function renderFlag() {
    var r = state.computed;
    var zone = $('#flag-zone');
    zone.innerHTML = '';

    if (!r.budget.wFTE) {
      zone.appendChild(el('div', { class: 'banner info' }, [
        el('span', { class: 'dot', text: '●' }),
        el('div', {}, [
          el('span', { text: 'Budget not set — enter annual volume and WHpU (or a budgeted wFTE) to enable the over-budget check.' })
        ])
      ]));
      return;
    }

    var over = r.variance.overWorked;
    var msg = over
      ? 'OVER BUDGET — the designed model is ' + fmt(r.variance.wFTE, 2) + ' wFTE above the budgeted ' + fmt(r.budget.wFTE, 2) + ' wFTE.'
      : 'Within budget — the designed model is ' + fmt(Math.abs(r.variance.wFTE), 2) + ' wFTE ' +
        (r.variance.wFTE === 0 ? 'exactly at' : 'under') + ' the budgeted ' + fmt(r.budget.wFTE, 2) + ' wFTE.';
    var detail = 'Designed ' + fmt(r.designed.wFTE, 2) + ' wFTE / ' + fmt(r.designed.pFTE, 2) + ' pFTE · ' +
      pct(r.variance.wFTEPctOfBudget) + ' of budgeted worked FTE · ' +
      (r.variance.overPaid ? 'paid FTE also over budget by ' + fmt(r.variance.pFTE, 2) : 'paid FTE within budget');

    zone.appendChild(el('div', { class: 'banner ' + (over ? 'over' : 'ok') }, [
      el('span', { class: 'dot', text: over ? '▲' : '✔' }),
      el('div', {}, [
        el('span', { text: msg }),
        el('span', { class: 'detail', text: detail })
      ])
    ]));
  }

  /* ---------- productivity ---------- */
  function renderProductivity() {
    var r = state.computed, p = r.productivity, unit = r.inputs.volumeUnit || 'units';

    var box = $('#prod-stats');
    box.innerHTML = '';
    var short = p.volumeGap > 0.5;
    [
      statCard('Annual ' + unit + ' needed', fmt(p.requiredAnnualVolume, 0), 'for 100% productivity', short ? 'bad' : 'good'),
      statCard('Budgeted annual ' + unit, fmt(p.budgetedAnnualVolume, 0), 'from budget inputs'),
      statCard('Gap', signed(p.volumeGap, 0), short ? 'volume short of the model' : 'budget covers the model', short ? 'bad' : 'good'),
      statCard(unit + ' / day needed', fmt(p.requiredAvgDailyVolume, 1), 'budget avg ' + fmt(r.budget.avgDailyVolume, 1)),
      statCard(unit + ' / week needed', fmt(p.requiredWeeklyVolume, 1), fmt(r.designed.weeklyHours, 1) + ' hrs ÷ ' + fmt(p.whpu, 2) + ' WHpU'),
      statCard('Productivity index', pct(p.productivityIndex), 'earned ÷ designed hours', p.productivityIndex < 1 ? 'bad' : 'good')
    ].forEach(function (c) { box.appendChild(c); });

    $('#th-required-day').textContent = 'Required ' + unit + ' @ 100%';
    $('#th-budgeted-day').textContent = 'Budgeted avg ' + unit + ' / day';

    var body = $('#prod-day-body');
    body.innerHTML = '';
    p.byDay.forEach(function (d) {
      var over = d.varianceUnits > 0.0005;
      var tr = el('tr');
      tr.appendChild(el('td', { text: d.name }));
      tr.appendChild(el('td', { class: 'num', text: fmt(d.hours, 1) }));
      tr.appendChild(el('td', { class: 'num', text: fmt(d.eightHourEquivalents, 1) }));
      tr.appendChild(el('td', { class: 'num', text: fmt(d.requiredUnits, 2) }));
      tr.appendChild(el('td', { class: 'num', text: fmt(d.budgetedUnits, 2) }));
      tr.appendChild(el('td', { class: 'num ' + (over ? 'flag-bad' : 'flag-good'), text: signed(d.varianceUnits, 2) }));
      body.appendChild(tr);
    });
    var foot = $('#prod-day-foot');
    foot.innerHTML = '';
    var weekBudget = r.budget.avgDailyVolume * 7;
    var ftr = el('tr');
    ftr.appendChild(el('td', { text: 'Week total' }));
    ftr.appendChild(el('td', { class: 'num', text: fmt(r.designed.weeklyHours, 1) }));
    ftr.appendChild(el('td', { class: 'num', text: fmt(r.designed.weeklyHours / 8, 1) }));
    ftr.appendChild(el('td', { class: 'num', text: fmt(p.requiredWeeklyVolume, 2) }));
    ftr.appendChild(el('td', { class: 'num', text: fmt(weekBudget, 2) }));
    ftr.appendChild(el('td', { class: 'num', text: signed(p.requiredWeeklyVolume - weekBudget, 2) }));
    foot.appendChild(ftr);

    var pbody = $('#prod-person-body');
    pbody.innerHTML = '';
    if (!p.byPosition.length) {
      pbody.appendChild(el('tr', { class: 'empty-row' }, [el('td', { colspan: '13', text: 'Add positions to see the per-person breakdown.' })]));
    }
    p.byPosition.forEach(function (pos) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: pos.role || '—' }));
      tr.appendChild(el('td', { text: SGExport.assigneeLabel(pos) }));
      tr.appendChild(el('td', { text: pos.shift || '—' }));
      tr.appendChild(el('td', { class: 'num', text: fmt(pos.qty, 1) }));
      pos.dayUnits.forEach(function (u) { tr.appendChild(el('td', { class: 'num', text: u ? fmt(u, 2) : '—' })); });
      tr.appendChild(el('td', { class: 'num calc', text: fmt(pos.weeklyUnitsPerPerson, 2) }));
      tr.appendChild(el('td', { class: 'num calc', text: fmt(pos.weeklyUnitsForRow, 2) }));
      pbody.appendChild(tr);
    });
    var pfoot = $('#prod-person-foot');
    pfoot.innerHTML = '';
    var ptr = el('tr');
    ptr.appendChild(el('td', { colspan: '3', text: 'DEPARTMENT TOTAL' }));
    ptr.appendChild(el('td', { class: 'num', text: fmt(r.designed.headcount, 1) }));
    p.byDay.forEach(function (d) { ptr.appendChild(el('td', { class: 'num', text: fmt(d.requiredUnits, 2) })); });
    ptr.appendChild(el('td', { class: 'num', text: '' }));
    ptr.appendChild(el('td', { class: 'num', text: fmt(p.requiredWeeklyVolume, 2) }));
    pfoot.appendChild(ptr);
  }

  /* ---------- header ---------- */
  function renderHeader() {
    $('#hdr-dept').textContent = state.model.departmentName || 'New model';
    var bits = [];
    bits.push(state.model.versionLabel ? 'Version ' + state.model.versionLabel : 'Version —');
    bits.push(prettyDate(state.model.versionDate));
    bits.push(state.savedId ? 'saved ' + prettyStamp(state.model.updatedAt) : 'not yet saved');
    $('#hdr-version').textContent = bits.join(' · ');
  }

  /* ---------- master render ---------- */
  function recompute() {
    state.computed = SGCalc.computeModel(state.model);
    renderFlag();
    renderBudgetStats();
    renderVariance();
    renderProductivity();
    renderHeader();
    updatePtoLabel();
  }

  function renderAll() {
    fillFields();
    recompute();
    renderGrid();
  }

  /* ---------- library ---------- */
  function openLibrary() {
    $('#library-modal').classList.add('open');
    $('#lib-storage-note').textContent = SGStore.available()
      ? 'Saved in this browser on this computer. Use "Backup file" to move models between machines.'
      : 'Browser storage is unavailable — saving is disabled. Use "Backup file" instead.';
    renderLibrary();
  }
  function closeLibrary() { $('#library-modal').classList.remove('open'); }

  function renderLibrary() {
    var filter = ($('#lib-filter').value || '').trim().toLowerCase();
    var list = SGStore.list().filter(function (m) {
      if (!filter) return true;
      return (String(m.departmentName || '') + ' ' + String(m.departmentCode || '') + ' ' + String(m.versionLabel || ''))
        .toLowerCase().indexOf(filter) >= 0;
    });
    var box = $('#lib-list');
    box.innerHTML = '';

    if (!list.length) {
      box.appendChild(el('div', { class: 'hint', text: filter ? 'No saved models match that filter.' : 'No saved models yet. Build a model and choose Save.' }));
      return;
    }

    list.forEach(function (m) {
      var r = SGCalc.computeModel(m);
      var over = r.variance.overWorked;
      box.appendChild(el('div', { class: 'lib-item' + (m.id === state.savedId ? ' current' : '') }, [
        el('div', { class: 'lib-main' }, [
          el('div', { class: 'lib-dept', text: (m.departmentName || 'Untitled department') + (m.departmentCode ? '  ·  ' + m.departmentCode : '') }),
          el('div', { class: 'lib-meta', text:
            'Version ' + (m.versionLabel || '—') + ' · ' + prettyDate(m.versionDate) +
            ' · ' + (m.positions || []).length + ' positions · ' +
            fmt(r.designed.wFTE, 2) + ' wFTE vs ' + fmt(r.budget.wFTE, 2) + ' budgeted' + (over ? '  ⚠ over budget' : '') +
            ' · last saved ' + prettyStamp(m.updatedAt) })
        ]),
        el('button', { type: 'button', class: 'primary', text: 'Open', onclick: function () { loadModel(m.id); } }),
        el('button', { type: 'button', text: 'Duplicate', onclick: function () { duplicateModel(m.id); } }),
        el('button', { type: 'button', class: 'ghost-danger', text: 'Delete', onclick: function () { deleteModel(m); } })
      ]));
    });
  }

  function confirmDiscard() {
    if (!state.dirty) return true;
    return window.confirm('This model has unsaved changes. Discard them?');
  }

  function loadModel(id) {
    if (!confirmDiscard()) return;
    var m = SGStore.get(id);
    if (!m) { toast('That model could not be found.', true); return; }
    state.model = SGCalc.newModel(m);
    state.model.id = m.id;
    state.savedId = m.id;
    SGStore.setLastOpened(m.id);
    markDirty(false);
    renderAll();
    closeLibrary();
    toast('Opened ' + (m.departmentName || 'model'));
  }

  function duplicateModel(id) {
    if (!confirmDiscard()) return;
    var m = SGStore.get(id);
    if (!m) return;
    var copy = SGCalc.newModel(m);
    copy.id = 'mdl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    copy.versionLabel = nextVersionLabel(m.versionLabel);
    copy.versionDate = new Date().toISOString().slice(0, 10);
    copy.createdAt = new Date().toISOString();
    state.model = copy;
    state.savedId = null;
    markDirty(true);
    renderAll();
    closeLibrary();
    toast('Copy created — choose Save to store it');
  }

  function deleteModel(m) {
    if (!window.confirm('Delete the saved model for "' + (m.departmentName || 'Untitled') + '" (version ' + (m.versionLabel || '—') + ')?\n\nThis cannot be undone.')) return;
    SGStore.remove(m.id);
    if (state.savedId === m.id) state.savedId = null;
    renderLibrary();
    renderHeader();
    markDirty(state.dirty);
    toast('Model deleted');
  }

  function nextVersionLabel(label) {
    var m = /^v(\d+)(.*)$/i.exec(String(label || '').trim());
    if (m) return 'v' + (parseInt(m[1], 10) + 1) + m[2];
    return (label ? label + ' ' : '') + '(copy)';
  }

  /* ---------- save ---------- */
  function requireDepartment() {
    if (String(state.model.departmentName || '').trim()) return true;
    toast('Enter a department name before saving.', true);
    var f = $('#f-departmentName');
    f.focus();
    return false;
  }

  function save(asNew) {
    if (!SGStore.available()) {
      toast('Browser storage is blocked — use "Backup file" to keep this model.', true);
      return;
    }
    if (!requireDepartment()) return;

    if (asNew || !state.savedId) {
      if (asNew) {
        state.model.id = 'mdl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        state.model.versionLabel = nextVersionLabel(state.model.versionLabel);
        state.model.versionDate = new Date().toISOString().slice(0, 10);
        state.model.createdAt = new Date().toISOString();
        fillFields();
      } else {
        // First save of a brand-new model: warn if this department already has one,
        // but never overwrite it - a new record is always created.
        var existing = SGStore.findByDepartment(state.model.departmentName, state.model.id);
        if (existing.length) {
          var ok = window.confirm(
            existing.length + ' saved model(s) already exist for "' + state.model.departmentName + '".\n\n' +
            'Saving now creates an additional, separate version. The existing model(s) are not touched.\n\nContinue?');
          if (!ok) return;
        }
      }
    }

    var saved = SGStore.save(state.model);
    state.model.updatedAt = saved.updatedAt;
    state.model.createdAt = saved.createdAt;
    state.savedId = saved.id;
    markDirty(false);
    renderHeader();
    toast(asNew ? 'Saved as new version ' + (saved.versionLabel || '') : 'Saved');
  }

  function newModel() {
    if (!confirmDiscard()) return;
    state.model = SGCalc.newModel();
    state.model.positions = [SGCalc.newPosition()];   // start with one blank row to type into
    state.savedId = null;
    SGStore.setLastOpened('');
    markDirty(false);
    renderAll();
    toast('New model started');
  }

  /* ---------- print report ---------- */
  function buildPrintReport() {
    var m = state.model, r = state.computed, unit = r.inputs.volumeUnit || 'Units';
    var over = r.variance.overWorked;

    function kv(k, v) { return '<div><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }

    var html = '';
    html += '<div class="pr-head">' +
      '<div class="pr-mark">CM</div>' +
      '<div><h1 class="pr-title">' + esc(m.departmentName || 'Untitled department') + ' — Staffing Grid</h1>' +
      '<p class="pr-sub">CaroMont Health' + (m.facility ? ' · ' + esc(m.facility) : '') +
      (m.departmentCode ? ' · Cost center ' + esc(m.departmentCode) : '') +
      (m.fiscalYear ? ' · ' + esc(m.fiscalYear) : '') + '</p></div>' +
      '<div class="pr-meta"><strong>Version ' + esc(m.versionLabel || '—') + '</strong>' +
      'Version date: ' + esc(prettyDate(m.versionDate)) + '<br>' +
      'Prepared by: ' + esc(m.preparedBy || '—') + '<br>' +
      'Printed: ' + esc(prettyStamp(new Date().toISOString())) + '</div>' +
      '</div>';

    html += '<div class="pr-flag ' + (over ? 'over' : 'ok') + '">' +
      (over
        ? '▲ OVER BUDGET — designed model is ' + fmt(r.variance.wFTE, 2) + ' wFTE above the budgeted ' + fmt(r.budget.wFTE, 2) + ' wFTE (' + pct(r.variance.wFTEPctOfBudget) + ' of budget).'
        : '✔ Within budgeted wFTE — designed ' + fmt(r.designed.wFTE, 2) + ' vs budgeted ' + fmt(r.budget.wFTE, 2) + ' wFTE (' + pct(r.variance.wFTEPctOfBudget) + ' of budget).') +
      '</div>';

    html += '<h3>Budget statistics</h3><div class="kv">' +
      kv('Annual budgeted ' + unit, fmt(r.budget.annualVolume, 0)) +
      kv('Worked hours per unit', fmt(r.budget.whpu, 2)) +
      kv('Budgeted worked hours', fmt(r.budget.workedHours, 0)) +
      kv('Budgeted paid hours', fmt(r.budget.paidHours, 0)) +
      kv('Budgeted wFTE', fmt(r.budget.wFTE, 2)) +
      kv('Budgeted pFTE', fmt(r.budget.pFTE, 2)) +
      kv('Budgeted PTO FTE', fmt(r.budget.ptoFTE, 2)) +
      kv('PTO % of paid hours', pct(r.budget.ptoPctOfPaid)) +
      kv('FTE hours / year', fmt(r.inputs.fteHours, 0)) +
      kv('Avg ' + unit + ' / day', fmt(r.budget.avgDailyVolume, 1)) +
      kv('Designed wFTE', fmt(r.designed.wFTE, 2)) +
      kv('Designed pFTE', fmt(r.designed.pFTE, 2)) +
      '</div>';

    html += '<h3>Designed model vs budget</h3><table><thead><tr>' +
      '<th style="text-align:left">Measure</th><th>Designed</th><th>Budget</th><th>Variance</th><th>% of budget</th>' +
      '</tr></thead><tbody>';
    [
      ['Worked FTE (wFTE)', r.designed.wFTE, r.budget.wFTE, r.variance.wFTE, r.variance.wFTEPctOfBudget, 2, r.variance.overWorked],
      ['Paid FTE (pFTE)', r.designed.pFTE, r.budget.pFTE, r.variance.pFTE, r.variance.pFTEPctOfBudget, 2, r.variance.overPaid],
      ['Annual worked hours', r.designed.annualWorkedHours, r.budget.workedHours, r.variance.workedHours,
        r.budget.workedHours ? r.designed.annualWorkedHours / r.budget.workedHours : 0, 0, r.variance.overWorked],
      ['Annual paid hours', r.designed.annualPaidHours, r.budget.paidHours, r.designed.annualPaidHours - r.budget.paidHours,
        r.budget.paidHours ? r.designed.annualPaidHours / r.budget.paidHours : 0, 0, r.variance.overPaid]
    ].forEach(function (row) {
      html += '<tr><td>' + row[0] + '</td>' +
        '<td class="num' + (row[6] ? ' bad' : '') + '">' + fmt(row[1], row[5]) + '</td>' +
        '<td class="num">' + fmt(row[2], row[5]) + '</td>' +
        '<td class="num' + (row[6] ? ' bad' : '') + '">' + signed(row[3], row[5]) + '</td>' +
        '<td class="num">' + pct(row[4]) + '</td></tr>';
    });
    html += '</tbody></table>';

    html += '<h3>Staffing grid — worked hours by day</h3><table><thead><tr>' +
      '<th style="text-align:left">Role</th><th style="text-align:left">Assigned to</th><th style="text-align:left">Shift</th><th>Qty</th>' +
      DAYS.map(function (d) { return '<th>' + d + '</th>'; }).join('') +
      '<th>Hrs/wk pp</th><th>Total hrs/wk</th><th>Annual hrs</th><th>wFTE</th><th>pFTE</th></tr></thead><tbody>';
    r.positions.forEach(function (p) {
      html += '<tr><td>' + esc(p.role || '—') + '</td><td>' + esc(SGExport.assigneeLabel(p)) + '</td>' +
        '<td>' + esc(p.shift || '—') + '</td><td class="num">' + fmt(p.qty, 1) + '</td>' +
        p.hours.map(function (h) { return '<td class="num">' + (h ? fmt(h, 1) : '—') + '</td>'; }).join('') +
        '<td class="num">' + fmt(p.weeklyHoursPerPerson, 1) + '</td>' +
        '<td class="num">' + fmt(p.weeklyHours, 1) + '</td>' +
        '<td class="num">' + fmt(p.annualWorkedHours, 0) + '</td>' +
        '<td class="num">' + fmt(p.wFTE, 2) + '</td>' +
        '<td class="num">' + fmt(p.pFTE, 2) + '</td></tr>';
    });
    if (!r.positions.length) html += '<tr><td colspan="16">No positions entered.</td></tr>';
    html += '</tbody><tfoot><tr><td colspan="3">TOTAL</td><td class="num">' + fmt(r.designed.headcount, 1) + '</td>' +
      r.designed.dailyHours.map(function (h) { return '<td class="num">' + fmt(h, 1) + '</td>'; }).join('') +
      '<td class="num"></td><td class="num">' + fmt(r.designed.weeklyHours, 1) + '</td>' +
      '<td class="num">' + fmt(r.designed.annualWorkedHours, 0) + '</td>' +
      '<td class="num">' + fmt(r.designed.wFTE, 2) + '</td>' +
      '<td class="num">' + fmt(r.designed.pFTE, 2) + '</td></tr></tfoot></table>';

    var p = r.productivity;
    html += '<div class="page-break"></div>';
    html += '<h3>Volume required for 100% productivity — by day of week</h3>' +
      '<p class="pr-sub">Required ' + esc(unit) + ' = scheduled worked hours ÷ budgeted WHpU (' + fmt(p.whpu, 2) + ').</p>' +
      '<table><thead><tr><th style="text-align:left">Day</th><th>Scheduled worked hours</th><th>8-hour equivalents</th>' +
      '<th>Required ' + esc(unit) + '</th><th>Budgeted avg ' + esc(unit) + '/day</th><th>Variance</th></tr></thead><tbody>';
    p.byDay.forEach(function (d) {
      var shortDay = d.varianceUnits > 0.0005;
      html += '<tr><td>' + d.name + '</td><td class="num">' + fmt(d.hours, 1) + '</td>' +
        '<td class="num">' + fmt(d.eightHourEquivalents, 1) + '</td>' +
        '<td class="num' + (shortDay ? ' bad' : '') + '">' + fmt(d.requiredUnits, 2) + '</td>' +
        '<td class="num">' + fmt(d.budgetedUnits, 2) + '</td>' +
        '<td class="num' + (shortDay ? ' bad' : '') + '">' + signed(d.varianceUnits, 2) + '</td></tr>';
    });
    var weekBudget = r.budget.avgDailyVolume * 7;
    html += '</tbody><tfoot><tr><td>Week total</td><td class="num">' + fmt(r.designed.weeklyHours, 1) + '</td>' +
      '<td class="num">' + fmt(r.designed.weeklyHours / 8, 1) + '</td>' +
      '<td class="num">' + fmt(p.requiredWeeklyVolume, 2) + '</td>' +
      '<td class="num">' + fmt(weekBudget, 2) + '</td>' +
      '<td class="num">' + signed(p.requiredWeeklyVolume - weekBudget, 2) + '</td></tr></tfoot></table>';

    html += '<div class="kv" style="margin-top:8px">' +
      kv('Annual ' + unit + ' needed @100%', fmt(p.requiredAnnualVolume, 0)) +
      kv('Annual budgeted ' + unit, fmt(p.budgetedAnnualVolume, 0)) +
      kv('Gap', signed(p.volumeGap, 0)) +
      kv('Projected productivity', pct(p.productivityIndex)) +
      '</div>';

    html += '<h3>Volume required for 100% productivity — per person, per day</h3>' +
      '<p class="pr-sub">Each figure is the ' + esc(unit.toLowerCase()) + ' one person in that position must cover on that day.</p>' +
      '<table><thead><tr><th style="text-align:left">Role</th><th style="text-align:left">Assigned to</th>' +
      '<th style="text-align:left">Shift</th><th>Qty</th>' +
      DAYS.map(function (d) { return '<th>' + d + '</th>'; }).join('') +
      '<th>Per person / wk</th><th>Row total / wk</th></tr></thead><tbody>';
    p.byPosition.forEach(function (pos) {
      html += '<tr><td>' + esc(pos.role || '—') + '</td><td>' + esc(SGExport.assigneeLabel(pos)) + '</td>' +
        '<td>' + esc(pos.shift || '—') + '</td><td class="num">' + fmt(pos.qty, 1) + '</td>' +
        pos.dayUnits.map(function (u) { return '<td class="num">' + (u ? fmt(u, 2) : '—') + '</td>'; }).join('') +
        '<td class="num">' + fmt(pos.weeklyUnitsPerPerson, 2) + '</td>' +
        '<td class="num">' + fmt(pos.weeklyUnitsForRow, 2) + '</td></tr>';
    });
    if (!p.byPosition.length) html += '<tr><td colspan="13">No positions entered.</td></tr>';
    html += '</tbody><tfoot><tr><td colspan="3">DEPARTMENT TOTAL</td><td class="num">' + fmt(r.designed.headcount, 1) + '</td>' +
      p.byDay.map(function (d) { return '<td class="num">' + fmt(d.requiredUnits, 2) + '</td>'; }).join('') +
      '<td class="num"></td><td class="num">' + fmt(p.requiredWeeklyVolume, 2) + '</td></tr></tfoot></table>';

    if (m.notes) html += '<h3>Notes &amp; assumptions</h3><div class="pr-notes">' + esc(m.notes) + '</div>';

    html += '<div class="pr-foot">CaroMont Health · Staffing Grid Builder · ' +
      esc(m.departmentName || 'Untitled department') + ' · Version ' + esc(m.versionLabel || '—') +
      ' dated ' + esc(prettyDate(m.versionDate)) + ' · Internal planning document.</div>';

    $('#print-report').innerHTML = html;
  }

  function exportPdf() {
    buildPrintReport();
    var prevTitle = document.title;
    document.title = SGExport.fileBase(state.model);
    window.setTimeout(function () {
      window.print();
      window.setTimeout(function () { document.title = prevTitle; }, 500);
    }, 60);
  }

  /* ---------- wiring ---------- */
  function wire() {
    bindFields();

    $('#btn-add-row').addEventListener('click', function () {
      state.model.positions.push(SGCalc.newPosition());
      markDirty(true); recompute(); renderGrid();
    });
    $('#btn-add-5').addEventListener('click', function () {
      for (var i = 0; i < 5; i++) state.model.positions.push(SGCalc.newPosition());
      markDirty(true); recompute(); renderGrid();
    });
    $('#btn-clear-rows').addEventListener('click', function () {
      if (!state.model.positions.length) return;
      if (!window.confirm('Remove all ' + state.model.positions.length + ' positions from this model?')) return;
      state.model.positions = [];
      markDirty(true); recompute(); renderGrid();
    });

    $('#btn-new').addEventListener('click', newModel);
    $('#btn-open').addEventListener('click', openLibrary);
    $('#btn-save').addEventListener('click', function () { save(false); });
    $('#btn-save-as').addEventListener('click', function () { save(true); });
    $('#lib-filter').addEventListener('input', renderLibrary);
    $$('[data-close-modal]').forEach(function (b) { b.addEventListener('click', closeLibrary); });
    $('#library-modal').addEventListener('click', function (e) { if (e.target === this) closeLibrary(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLibrary();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
    });

    $('#btn-excel').addEventListener('click', function () {
      try {
        SGExport.toExcel(state.model, state.computed);
        toast('Excel workbook downloaded');
      } catch (err) {
        toast('Excel export failed: ' + err.message, true);
      }
    });
    $('#btn-pdf').addEventListener('click', exportPdf);
    $('#btn-export-json').addEventListener('click', function () {
      SGExport.downloadBlob(new Blob([SGStore.exportBackup()], { type: 'application/json' }),
        'CaroMont-Staffing-Models-Backup_' + new Date().toISOString().slice(0, 10) + '.json');
      toast('Backup file downloaded');
    });
    $('#btn-import-json').addEventListener('click', function () { $('#file-import').click(); });
    $('#file-import').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var res = SGStore.importBackup(String(reader.result), false);
          toast('Imported ' + res.added + ' model(s)');
          openLibrary();
        } catch (err) {
          toast('Import failed: not a valid backup file', true);
        }
        e.target.value = '';
      };
      reader.readAsText(file);
    });

    $$('.tabs button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.tabs button').forEach(function (b) { b.classList.remove('active'); });
        $$('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        $('#' + btn.getAttribute('data-tab')).classList.add('active');
      });
    });

    window.addEventListener('beforeunload', function (e) {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
    window.addEventListener('beforeprint', function () {
      if (!$('#print-report').innerHTML) buildPrintReport();
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    wire();
    var last = SGStore.available() ? SGStore.getLastOpened() : '';
    var m = last ? SGStore.get(last) : null;
    if (m) {
      state.model = SGCalc.newModel(m);
      state.model.id = m.id;
      state.savedId = m.id;
    } else {
      state.model.positions = [SGCalc.newPosition()];
    }
    renderAll();
    markDirty(false);
    if (!SGStore.available()) {
      toast('Browser storage is blocked — saving is disabled in this browser.', true);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
