/*
 * CaroMont Staffing Grid Builder - calculation engine
 *
 * Pure functions, no DOM. Loaded as a plain <script> in the browser (exposes
 * window.SGCalc) and require()-able from Node for the unit tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SGCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  var PTO_BASIS = {
    paidPct: 'PTO as % of paid hours',
    workedPct: 'PTO as % of worked hours',
    ptoFTE: 'Budgeted PTO expressed as FTE'
  };

  /* ---------- helpers ---------- */

  // Treat '', null, undefined and NaN as "not entered" so optional overrides
  // can be distinguished from a deliberate zero.
  function num(v, fallback) {
    if (v === '' || v === null || v === undefined) return fallback === undefined ? null : fallback;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    if (!isFinite(n)) return fallback === undefined ? null : fallback;
    return n;
  }

  function n0(v) {
    var x = num(v, 0);
    return x === null ? 0 : x;
  }

  function div(a, b) {
    return b ? a / b : 0;
  }

  function emptyHours() {
    return [0, 0, 0, 0, 0, 0, 0];
  }

  function emptyTimes() {
    var out = [];
    for (var i = 0; i < 7; i++) out.push({ start: '', end: '' });
    return out;
  }

  /**
   * Parse a clock time the way a manager would type it.
   * Accepts 0700, 700, 7, 7:00, 07:00, 19:30, 1930, 7a, 7am, 7:30p, 7:30 PM.
   * Returns minutes past midnight, or null when the text is not a time.
   * 24:00 / 2400 is accepted as end-of-day (1440) so a shift can end at midnight.
   */
  function parseTime(input) {
    if (input === null || input === undefined) return null;
    var s = String(input).trim().toLowerCase().replace(/\./g, '');
    if (!s) return null;

    var mer = null;
    var m = /(am|pm|a|p)$/.exec(s);
    if (m) { mer = m[1].charAt(0); s = s.slice(0, m.index); }
    s = s.replace(/\s+/g, '');
    if (!s) return null;

    var h, min;
    if (s.indexOf(':') >= 0) {
      var parts = s.split(':');
      if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1])) return null;
      h = parseInt(parts[0], 10);
      min = parseInt(parts[1], 10);
    } else {
      if (!/^\d{1,4}$/.test(s)) return null;
      if (s.length <= 2) { h = parseInt(s, 10); min = 0; }
      else { h = parseInt(s.slice(0, s.length - 2), 10); min = parseInt(s.slice(-2), 10); }
    }
    if (!isFinite(h) || !isFinite(min) || min > 59 || h < 0) return null;

    if (mer) {
      if (h < 1 || h > 12) return null;
      if (mer === 'a') h = (h === 12 ? 0 : h);
      else h = (h === 12 ? 12 : h + 12);
    }
    if (h === 24 && min === 0) return 1440;   // midnight at the end of the day
    if (h > 23) return null;
    return h * 60 + min;
  }

  /** Minutes past midnight -> "19:30" (24-hour), for normalising what was typed. */
  function formatTime(minutes) {
    if (minutes === null || minutes === undefined || !isFinite(minutes)) return '';
    var h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /** Minutes past midnight -> "1930", the compact form used on reports. */
  function compactTime(minutes) {
    return formatTime(minutes).replace(':', '');
  }

  /**
   * Worked hours for one day from its start and end time, minus the unpaid
   * break. An end at or before the start is read as an overnight shift, so
   * 1900-0730 is 12.5 clock hours.
   */
  function shiftHours(start, end, breakMinutes) {
    var s = parseTime(start), e = parseTime(end);
    if (s === null || e === null || s >= 1440) return 0;
    var span = e - s;
    if (span < 0) span += 1440;
    if (span === 0) return 0;
    span -= n0(breakMinutes);
    return span > 0 ? span / 60 : 0;
  }

  /** "0700-1930" for a day, or '' when that day has no usable pair of times. */
  function shiftLabel(start, end) {
    var s = parseTime(start), e = parseTime(end);
    if (s === null || e === null) return '';
    return compactTime(s) + '-' + compactTime(e);
  }

  function normalizeTimes(times) {
    var out = emptyTimes();
    if (!times) return out;
    for (var i = 0; i < 7; i++) {
      var t = times[i];
      if (!t) continue;
      out[i] = { start: t.start === null || t.start === undefined ? '' : String(t.start),
                 end: t.end === null || t.end === undefined ? '' : String(t.end) };
    }
    return out;
  }

  /**
   * Which side of a position row drives its hours.
   *
   * Models saved before start/end times existed carry hours only, so they are
   * read back in hours mode and nothing a manager entered is reinterpreted.
   * This has to be shared: raw stored models reach computeModel without ever
   * passing through newPosition (the saved-model list computes them directly).
   */
  function inferEntryMode(position) {
    if (!position) return 'times';
    if (position.entryMode === 'times' || position.entryMode === 'hours') return position.entryMode;
    var times = normalizeTimes(position.times);
    if (times.some(function (t) { return t.start || t.end; })) return 'times';
    var hours = position.hours || [];
    for (var i = 0; i < hours.length; i++) if (n0(hours[i]) > 0) return 'hours';
    return 'times';
  }

  function newPosition(seed) {
    seed = seed || {};
    var hours = (seed.hours && seed.hours.slice(0, 7)) || emptyHours();
    while (hours.length < 7) hours.push(0);
    var times = normalizeTimes(seed.times);
    var mode = inferEntryMode(seed);

    return {
      id: seed.id || 'pos_' + Math.random().toString(36).slice(2, 10),
      role: seed.role || '',
      assignee: seed.assignee || '',
      assigneeType: seed.assigneeType || 'title', // 'title' | 'person' | 'open'
      shift: seed.shift || '',
      qty: seed.qty === undefined ? 1 : seed.qty,
      entryMode: mode,                            // 'times' | 'hours'
      breakMinutes: seed.breakMinutes === undefined ? 0 : seed.breakMinutes,
      times: times,
      hours: hours
    };
  }

  function newModel(seed) {
    seed = seed || {};
    var today = new Date();
    var iso = today.toISOString().slice(0, 10);
    return {
      schemaVersion: 2,
      id: seed.id || 'mdl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      departmentName: seed.departmentName || '',
      departmentCode: seed.departmentCode || '',
      facility: seed.facility || '',
      preparedBy: seed.preparedBy || '',
      fiscalYear: seed.fiscalYear || String(today.getFullYear()),
      versionDate: seed.versionDate || iso,
      versionLabel: seed.versionLabel || 'v1',
      notes: seed.notes || '',
      budget: Object.assign({
        annualVolume: '',
        volumeUnit: 'Patient Days',
        whpu: '',
        fteHours: 2080,
        daysPerYear: 365,
        weeksPerYear: 52,
        ptoBasis: 'paidPct',
        ptoValue: '',
        budgetedWFTE: '',
        budgetedPFTE: ''
      }, seed.budget || {}),
      positions: (seed.positions || []).map(newPosition),
      createdAt: seed.createdAt || new Date().toISOString(),
      updatedAt: seed.updatedAt || new Date().toISOString()
    };
  }

  /* ---------- core computation ---------- */

  /**
   * PTO / benefit gross-up factor: pFTE = wFTE * factor.
   *
   * The scheduled hours in the grid are *worked* (productive) hours, so paid
   * FTE always sits at or above worked FTE. When the manager has typed both a
   * budgeted wFTE and a budgeted pFTE, their own numbers define the factor and
   * the PTO input becomes informational - that is surfaced in the UI.
   */
  function ptoFactor(budget, budgetedWFTE) {
    var basis = budget.ptoBasis || 'paidPct';
    var raw = num(budget.ptoValue, null);
    var overrideP = num(budget.budgetedPFTE, null);

    if (overrideP !== null && budgetedWFTE > 0) {
      return { factor: overrideP / budgetedWFTE, source: 'override' };
    }
    if (raw === null) return { factor: 1, source: 'none' };

    if (basis === 'ptoFTE') {
      if (budgetedWFTE > 0) return { factor: (budgetedWFTE + raw) / budgetedWFTE, source: basis };
      return { factor: 1, source: basis };
    }
    var pct = raw > 1 ? raw / 100 : raw; // accept 8 or 0.08
    if (basis === 'workedPct') return { factor: 1 + pct, source: basis };
    // default: % of paid hours
    if (pct >= 1) return { factor: 1, source: basis };
    return { factor: 1 / (1 - pct), source: basis };
  }

  function computeModel(model) {
    var b = Object.assign({}, (model && model.budget) || {});
    var fteHours = n0(b.fteHours) || 2080;
    var weeksPerYear = n0(b.weeksPerYear) || 52;
    var daysPerYear = n0(b.daysPerYear) || 365;
    var fteWeeklyHours = div(fteHours, weeksPerYear);
    var whpu = n0(b.whpu);
    var annualVolume = n0(b.annualVolume);

    /* --- budget side --- */
    var budgetWorkedHours = annualVolume * whpu;
    var calcWFTE = div(budgetWorkedHours, fteHours);
    var overrideW = num(b.budgetedWFTE, null);
    var budgetWFTE = overrideW !== null ? overrideW : calcWFTE;
    if (overrideW !== null) budgetWorkedHours = budgetWFTE * fteHours;

    var pf = ptoFactor(b, budgetWFTE);
    var overrideP = num(b.budgetedPFTE, null);
    var budgetPFTE = overrideP !== null ? overrideP : budgetWFTE * pf.factor;
    var budgetPaidHours = budgetPFTE * fteHours;
    var budgetPTOFTE = budgetPFTE - budgetWFTE;
    var budgetPTOHours = budgetPTOFTE * fteHours;
    var ptoPctOfPaid = div(budgetPTOHours, budgetPaidHours);

    /* --- designed side --- */
    var dailyHours = emptyHours();
    var positions = ((model && model.positions) || []).map(function (p) {
      var qty = n0(p.qty) || 0;
      var mode = inferEntryMode(p);
      var breakMinutes = n0(p.breakMinutes);
      var times = normalizeTimes(p.times);
      var rawHours = (p.hours || emptyHours());
      var hours = [], dayLabels = [];
      for (var di = 0; di < 7; di++) {
        if (mode === 'times') {
          hours.push(shiftHours(times[di].start, times[di].end, breakMinutes));
          dayLabels.push(shiftLabel(times[di].start, times[di].end));
        } else {
          hours.push(n0(rawHours[di]));
          dayLabels.push('');
        }
      }
      // With no shift label typed, fall back to the most common time range so
      // exports still say which shift the row is.
      var derivedShift = '';
      var counts = {};
      dayLabels.forEach(function (l) { if (l) counts[l] = (counts[l] || 0) + 1; });
      Object.keys(counts).forEach(function (l) {
        if (!derivedShift || counts[l] > counts[derivedShift]) derivedShift = l;
      });
      var weeklyPerPerson = hours.reduce(function (a, h) { return a + h; }, 0);
      var weeklyHours = weeklyPerPerson * qty;
      for (var d = 0; d < 7; d++) dailyHours[d] += hours[d] * qty;
      var annualWorkedHours = weeklyHours * weeksPerYear;
      var wFTE = div(weeklyHours, fteWeeklyHours);
      return {
        id: p.id,
        role: p.role || '',
        assignee: p.assignee || '',
        assigneeType: p.assigneeType || 'title',
        shift: p.shift || '',
        entryMode: mode,
        breakMinutes: breakMinutes,
        times: times,
        dayLabels: dayLabels,
        derivedShift: derivedShift,
        shiftDisplay: p.shift || derivedShift || '',
        qty: qty,
        hours: hours,
        weeklyHoursPerPerson: weeklyPerPerson,
        weeklyHours: weeklyHours,
        annualWorkedHours: annualWorkedHours,
        wFTE: wFTE,
        pFTE: wFTE * pf.factor,
        fteFactorPerPerson: div(weeklyPerPerson, fteWeeklyHours)
      };
    });

    var designedWeeklyHours = positions.reduce(function (a, p) { return a + p.weeklyHours; }, 0);
    var designedAnnualWorkedHours = designedWeeklyHours * weeksPerYear;
    var designedWFTE = div(designedWeeklyHours, fteWeeklyHours);
    var designedPFTE = designedWFTE * pf.factor;
    var headcount = positions.reduce(function (a, p) { return a + p.qty; }, 0);

    /* --- variance vs budget --- */
    var wVar = designedWFTE - budgetWFTE;       // positive = over budget
    var pVar = designedPFTE - budgetPFTE;
    var variance = {
      wFTE: wVar,
      pFTE: pVar,
      wFTEPctOfBudget: div(designedWFTE, budgetWFTE),
      pFTEPctOfBudget: div(designedPFTE, budgetPFTE),
      overWorked: budgetWFTE > 0 && wVar > 0.0005,
      overPaid: budgetPFTE > 0 && pVar > 0.0005,
      workedHours: designedAnnualWorkedHours - budgetWorkedHours
    };

    /* --- productivity: volume required to run the designed model at 100% --- */
    var budgetedDailyVolume = div(annualVolume, daysPerYear);
    var requiredAnnualVolume = div(designedAnnualWorkedHours, whpu);
    var byDay = DAYS.map(function (d, i) {
      var required = div(dailyHours[i], whpu);
      return {
        key: d,
        name: DAY_NAMES[i],
        hours: dailyHours[i],
        eightHourEquivalents: div(dailyHours[i], 8),
        requiredUnits: required,
        budgetedUnits: budgetedDailyVolume,
        varianceUnits: required - budgetedDailyVolume
      };
    });
    var byPosition = positions.map(function (p) {
      var dayUnits = p.hours.map(function (h) { return div(h, whpu); });
      return {
        id: p.id,
        role: p.role,
        assignee: p.assignee,
        assigneeType: p.assigneeType,
        shift: p.shift,
        shiftDisplay: p.shiftDisplay,
        dayLabels: p.dayLabels,
        qty: p.qty,
        hours: p.hours,
        dayUnits: dayUnits,
        weeklyUnitsPerPerson: dayUnits.reduce(function (a, u) { return a + u; }, 0),
        weeklyUnitsForRow: dayUnits.reduce(function (a, u) { return a + u; }, 0) * p.qty
      };
    });

    var productivity = {
      whpu: whpu,
      // earned hours / actual hours on the designed model
      productivityIndex: div(budgetWorkedHours, designedAnnualWorkedHours),
      requiredAnnualVolume: requiredAnnualVolume,
      requiredAvgDailyVolume: div(requiredAnnualVolume, daysPerYear),
      requiredWeeklyVolume: div(designedWeeklyHours, whpu),
      budgetedAnnualVolume: annualVolume,
      budgetedAvgDailyVolume: budgetedDailyVolume,
      volumeGap: requiredAnnualVolume - annualVolume,
      unitsPerWorkedFTE: div(annualVolume, designedWFTE),
      byDay: byDay,
      byPosition: byPosition
    };

    return {
      days: DAYS,
      dayNames: DAY_NAMES,
      inputs: {
        fteHours: fteHours,
        fteWeeklyHours: fteWeeklyHours,
        weeksPerYear: weeksPerYear,
        daysPerYear: daysPerYear,
        whpu: whpu,
        annualVolume: annualVolume,
        volumeUnit: b.volumeUnit || 'Units'
      },
      budget: {
        annualVolume: annualVolume,
        whpu: whpu,
        workedHours: budgetWorkedHours,
        calcWFTE: calcWFTE,
        wFTE: budgetWFTE,
        pFTE: budgetPFTE,
        paidHours: budgetPaidHours,
        ptoFTE: budgetPTOFTE,
        ptoHours: budgetPTOHours,
        ptoPctOfPaid: ptoPctOfPaid,
        ptoFactor: pf.factor,
        ptoFactorSource: pf.source,
        wFTEIsOverride: overrideW !== null,
        pFTEIsOverride: overrideP !== null,
        avgDailyVolume: budgetedDailyVolume
      },
      designed: {
        weeklyHours: designedWeeklyHours,
        annualWorkedHours: designedAnnualWorkedHours,
        annualPaidHours: designedPFTE * fteHours,
        wFTE: designedWFTE,
        pFTE: designedPFTE,
        ptoFTE: designedPFTE - designedWFTE,
        headcount: headcount,
        dailyHours: dailyHours,
        positionCount: positions.length
      },
      positions: positions,
      variance: variance,
      productivity: productivity
    };
  }

  return {
    DAYS: DAYS,
    DAY_NAMES: DAY_NAMES,
    PTO_BASIS: PTO_BASIS,
    num: num,
    emptyHours: emptyHours,
    emptyTimes: emptyTimes,
    inferEntryMode: inferEntryMode,
    parseTime: parseTime,
    formatTime: formatTime,
    compactTime: compactTime,
    shiftHours: shiftHours,
    shiftLabel: shiftLabel,
    newPosition: newPosition,
    newModel: newModel,
    ptoFactor: ptoFactor,
    computeModel: computeModel
  };
});
