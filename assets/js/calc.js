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

  function newPosition(seed) {
    seed = seed || {};
    return {
      id: seed.id || 'pos_' + Math.random().toString(36).slice(2, 10),
      role: seed.role || '',
      assignee: seed.assignee || '',
      assigneeType: seed.assigneeType || 'title', // 'title' | 'person' | 'open'
      shift: seed.shift || '',
      qty: seed.qty === undefined ? 1 : seed.qty,
      hours: (seed.hours && seed.hours.slice(0, 7)) || emptyHours()
    };
  }

  function newModel(seed) {
    seed = seed || {};
    var today = new Date();
    var iso = today.toISOString().slice(0, 10);
    return {
      schemaVersion: 1,
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
      var hours = (p.hours || emptyHours()).map(n0);
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
        shift: p.shift,
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
    newPosition: newPosition,
    newModel: newModel,
    ptoFactor: ptoFactor,
    computeModel: computeModel
  };
});
