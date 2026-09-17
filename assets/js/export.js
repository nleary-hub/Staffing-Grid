/*
 * Export: Excel workbook (4 sheets) and PDF (formatted print report).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./calc.js'), require('./xlsx.js'));
  } else {
    root.SGExport = factory(root.SGCalc, root.SGXlsx);
  }
})(typeof self !== 'undefined' ? self : this, function (SGCalc, SGXlsx) {
  'use strict';

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function slug(s) {
    return String(s || 'department').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'department';
  }

  function fileBase(model) {
    return 'Staffing-Grid_' + slug(model.departmentName) + '_' + (model.versionDate || '') +
      (model.versionLabel ? '_' + slug(model.versionLabel) : '');
  }

  function assigneeLabel(p) {
    if (p.assigneeType === 'open') return p.assignee ? p.assignee + ' (open)' : 'Open position';
    return p.assignee || '—';
  }

  /* ---------------- Excel ---------------- */

  function buildWorkbook(model, r) {
    var unit = r.inputs.volumeUnit || 'Units';
    var over = r.variance.overWorked;
    var blank = [];

    /* Sheet 1: Summary */
    var summary = [];
    summary.push([{ v: 'CaroMont Health — Staffing Grid', s: 'title' }]);
    summary.push([{ v: (model.departmentName || 'Unnamed department') +
      (model.departmentCode ? '  (' + model.departmentCode + ')' : ''), s: 'bold' }]);
    summary.push([{ v: 'Version ' + (model.versionLabel || '') + ' · ' + (model.versionDate || '') +
      (model.preparedBy ? ' · Prepared by ' + model.preparedBy : ''), s: 'subtitle' }]);
    summary.push(blank);
    summary.push([{ v: 'Department', s: 'header' }, { v: 'Value', s: 'header' }]);
    [
      ['Facility / entity', model.facility || '—'],
      ['Cost center / dept #', model.departmentCode || '—'],
      ['Fiscal year', model.fiscalYear || '—'],
      ['Version date', model.versionDate || '—'],
      ['Version label', model.versionLabel || '—'],
      ['Prepared by', model.preparedBy || '—']
    ].forEach(function (row) { summary.push([{ v: row[0], s: 'label' }, { v: row[1], s: 'text' }]); });

    summary.push(blank);
    summary.push([{ v: 'Budget inputs', s: 'header' }, { v: 'Value', s: 'header' }]);
    [
      ['Volume unit', { v: unit, s: 'text' }],
      ['Annual budgeted volume', { v: r.budget.annualVolume, s: 'int' }],
      ['Average volume per day', { v: r.budget.avgDailyVolume, s: 'dec1' }],
      ['Worked hours per unit (WHpU)', { v: r.budget.whpu, s: 'dec2' }],
      ['Annual budgeted worked hours', { v: r.budget.workedHours, s: 'int' }],
      ['Annual budgeted paid hours', { v: r.budget.paidHours, s: 'int' }],
      ['FTE hours per year', { v: r.inputs.fteHours, s: 'int' }],
      ['PTO basis', { v: SGCalc.PTO_BASIS[model.budget.ptoBasis] || model.budget.ptoBasis, s: 'text' }],
      ['PTO as % of paid hours', { v: r.budget.ptoPctOfPaid, s: 'pct1' }],
      ['Budgeted PTO FTE', { v: r.budget.ptoFTE, s: 'dec2' }],
      ['Benefit gross-up factor (pFTE ÷ wFTE)', { v: r.budget.ptoFactor, s: 'dec2' }],
      ['Budgeted worked FTE (wFTE)' + (r.budget.wFTEIsOverride ? ' — entered' : ' — calculated'), { v: r.budget.wFTE, s: 'dec2' }],
      ['Budgeted paid FTE (pFTE)' + (r.budget.pFTEIsOverride ? ' — entered' : ' — calculated'), { v: r.budget.pFTE, s: 'dec2' }]
    ].forEach(function (row) { summary.push([{ v: row[0], s: 'label' }, row[1]]); });

    summary.push(blank);
    summary.push([{ v: 'Designed model vs budget', s: 'header' }, { v: 'Designed', s: 'header' },
      { v: 'Budget', s: 'header' }, { v: 'Variance', s: 'header' }, { v: '% of budget', s: 'header' }]);
    summary.push([
      { v: 'Worked FTE (wFTE)', s: 'label' },
      { v: r.designed.wFTE, s: over ? 'badNum' : 'goodNum' },
      { v: r.budget.wFTE, s: 'dec2' },
      { v: r.variance.wFTE, s: over ? 'badNum' : 'dec2' },
      { v: r.variance.wFTEPctOfBudget, s: 'pct1' }
    ]);
    summary.push([
      { v: 'Paid FTE (pFTE)', s: 'label' },
      { v: r.designed.pFTE, s: r.variance.overPaid ? 'badNum' : 'goodNum' },
      { v: r.budget.pFTE, s: 'dec2' },
      { v: r.variance.pFTE, s: r.variance.overPaid ? 'badNum' : 'dec2' },
      { v: r.variance.pFTEPctOfBudget, s: 'pct1' }
    ]);
    summary.push([
      { v: 'Annual worked hours', s: 'label' },
      { v: r.designed.annualWorkedHours, s: 'int' },
      { v: r.budget.workedHours, s: 'int' },
      { v: r.variance.workedHours, s: 'int' },
      { v: r.budget.workedHours ? r.designed.annualWorkedHours / r.budget.workedHours : 0, s: 'pct1' }
    ]);
    summary.push([
      { v: 'Scheduled hours per week', s: 'label' }, { v: r.designed.weeklyHours, s: 'dec1' },
      { v: '', s: 'text' }, { v: '', s: 'text' }, { v: '', s: 'text' }
    ]);
    summary.push([
      { v: 'Positions / headcount', s: 'label' }, { v: r.designed.headcount, s: 'dec1' },
      { v: '', s: 'text' }, { v: '', s: 'text' }, { v: '', s: 'text' }
    ]);
    summary.push(blank);
    summary.push([{ v: 'Budget status', s: 'label' },
      { v: over ? 'OVER BUDGETED wFTE by ' + r.variance.wFTE.toFixed(2) + ' FTE' : 'Within budgeted wFTE',
        s: over ? 'bad' : 'good' }]);
    summary.push([{ v: 'Projected productivity at budgeted volume', s: 'label' },
      { v: r.productivity.productivityIndex, s: 'pct1' }]);

    if (model.notes) {
      summary.push(blank);
      summary.push([{ v: 'Notes', s: 'header' }]);
      summary.push([{ v: model.notes, s: 'text' }]);
    }

    /* Sheet 2: Staffing grid */
    var gridHeader = [
      { v: 'Role', s: 'header' }, { v: 'Job title / person', s: 'header' },
      { v: 'Shift', s: 'header' }, { v: 'Qty', s: 'header' },
      { v: 'Unpaid break (min)', s: 'header' }
    ].concat(DAYS.map(function (d) { return { v: d + ' hrs', s: 'header' }; }))
      .concat([
        { v: 'Hrs/week per person', s: 'header' },
        { v: 'Total hrs/week', s: 'header' },
        { v: 'Annual worked hrs', s: 'header' },
        { v: 'wFTE', s: 'header' },
        { v: 'pFTE', s: 'header' }
      ]);
    var grid = [gridHeader];
    r.positions.forEach(function (p) {
      grid.push([
        { v: p.role || '—', s: 'text' },
        { v: assigneeLabel(p), s: 'text' },
        { v: p.shiftDisplay || '—', s: 'text' },
        { v: p.qty, s: 'dec1' },
        { v: p.entryMode === 'times' ? p.breakMinutes : '', s: 'dec1' }
      ].concat(p.hours.map(function (h) { return { v: h, s: 'dec1' }; }))
        .concat([
          { v: p.weeklyHoursPerPerson, s: 'dec1' },
          { v: p.weeklyHours, s: 'dec1' },
          { v: p.annualWorkedHours, s: 'int' },
          { v: p.wFTE, s: 'dec2' },
          { v: p.pFTE, s: 'dec2' }
        ]));
    });
    grid.push([
      { v: 'TOTAL', s: 'totalText' }, { v: '', s: 'totalText' }, { v: '', s: 'totalText' },
      { v: r.designed.headcount, s: 'totalNum1' }, { v: '', s: 'totalText' }
    ].concat(r.designed.dailyHours.map(function (h) { return { v: h, s: 'totalNum1' }; }))
      .concat([
        { v: '', s: 'totalText' },
        { v: r.designed.weeklyHours, s: 'totalNum1' },
        { v: r.designed.annualWorkedHours, s: 'totalNum1' },
        { v: r.designed.wFTE, s: 'totalNum2' },
        { v: r.designed.pFTE, s: 'totalNum2' }
      ]));
    grid.push(blank);
    grid.push([{ v: 'Budgeted wFTE', s: 'label' }, { v: r.budget.wFTE, s: 'dec2' },
      { v: 'Variance', s: 'label' }, { v: r.variance.wFTE, s: over ? 'badNum' : 'goodNum' }]);

    /* Sheet 3: Productivity by day */
    var byDay = [
      [{ v: 'Volume required for 100% productivity — by day of week', s: 'title' }],
      [{ v: 'Required ' + unit + ' = scheduled worked hours ÷ WHpU (' +
        (r.budget.whpu || 0).toFixed(2) + ')', s: 'subtitle' }],
      blank,
      [
        { v: 'Day', s: 'header' },
        { v: 'Scheduled worked hours', s: 'header' },
        { v: '8-hour equivalents', s: 'header' },
        { v: 'Required ' + unit + ' @100%', s: 'header' },
        { v: 'Budgeted avg ' + unit + '/day', s: 'header' },
        { v: 'Variance (required − budgeted)', s: 'header' }
      ]
    ];
    r.productivity.byDay.forEach(function (d) {
      var short = d.varianceUnits > 0.0005;
      byDay.push([
        { v: d.name, s: 'label' },
        { v: d.hours, s: 'dec1' },
        { v: d.eightHourEquivalents, s: 'dec1' },
        { v: d.requiredUnits, s: short ? 'badNum' : 'dec2' },
        { v: d.budgetedUnits, s: 'dec2' },
        { v: d.varianceUnits, s: short ? 'badNum' : 'goodNum' }
      ]);
    });
    byDay.push([
      { v: 'Week total', s: 'totalText' },
      { v: r.designed.weeklyHours, s: 'totalNum1' },
      { v: r.designed.weeklyHours / 8, s: 'totalNum1' },
      { v: r.productivity.requiredWeeklyVolume, s: 'totalNum2' },
      { v: r.budget.avgDailyVolume * 7, s: 'totalNum2' },
      { v: r.productivity.requiredWeeklyVolume - r.budget.avgDailyVolume * 7, s: 'totalNum2' }
    ]);
    byDay.push(blank);
    byDay.push([{ v: 'Annual ' + unit + ' required @ 100% productivity', s: 'label' },
      { v: r.productivity.requiredAnnualVolume, s: 'int' }]);
    byDay.push([{ v: 'Annual budgeted ' + unit, s: 'label' }, { v: r.productivity.budgetedAnnualVolume, s: 'int' }]);
    byDay.push([{ v: 'Gap (required − budgeted)', s: 'label' },
      { v: r.productivity.volumeGap, s: r.productivity.volumeGap > 0.5 ? 'badNum' : 'goodNum' }]);
    byDay.push([{ v: 'Projected productivity at budgeted volume', s: 'label' },
      { v: r.productivity.productivityIndex, s: 'pct1' }]);

    /* Sheet 4: Productivity by position */
    var byPos = [
      [{ v: 'Volume required for 100% productivity — per person, per day', s: 'title' }],
      [{ v: 'Each figure is the ' + unit.toLowerCase() + ' one person in that position must cover on that day.', s: 'subtitle' }],
      blank,
      [
        { v: 'Role', s: 'header' }, { v: 'Job title / person', s: 'header' }, { v: 'Shift', s: 'header' },
        { v: 'Qty', s: 'header' }
      ].concat(DAYS.map(function (d) { return { v: d, s: 'header' }; }))
        .concat([{ v: 'Per person / week', s: 'header' }, { v: 'Row total / week', s: 'header' }])
    ];
    r.productivity.byPosition.forEach(function (p) {
      byPos.push([
        { v: p.role || '—', s: 'text' },
        { v: assigneeLabel(p), s: 'text' },
        { v: p.shiftDisplay || '—', s: 'text' },
        { v: p.qty, s: 'dec1' }
      ].concat(p.dayUnits.map(function (u) { return { v: u, s: 'dec2' }; }))
        .concat([{ v: p.weeklyUnitsPerPerson, s: 'dec2' }, { v: p.weeklyUnitsForRow, s: 'dec2' }]));
    });
    byPos.push([
      { v: 'DEPARTMENT TOTAL', s: 'totalText' }, { v: '', s: 'totalText' }, { v: '', s: 'totalText' },
      { v: r.designed.headcount, s: 'totalNum1' }
    ].concat(r.productivity.byDay.map(function (d) { return { v: d.requiredUnits, s: 'totalNum2' }; }))
      .concat([{ v: '', s: 'totalText' }, { v: r.productivity.requiredWeeklyVolume, s: 'totalNum2' }]));

    /* Sheet 5: shift times behind the hours */
    var sched = [
      [{ v: 'Shift schedule — start and end time by day', s: 'title' }],
      [{ v: 'Hours are the clock span less the unpaid break. An end time at or before the start is an overnight shift.', s: 'subtitle' }],
      blank,
      [
        { v: 'Role', s: 'header' }, { v: 'Job title / person', s: 'header' },
        { v: 'Qty', s: 'header' }, { v: 'Unpaid break (min)', s: 'header' }
      ].concat(DAYS.map(function (d) { return { v: d, s: 'header' }; }))
        .concat([{ v: 'Hrs/week per person', s: 'header' }])
    ];
    r.positions.forEach(function (p) {
      sched.push([
        { v: p.role || '—', s: 'text' },
        { v: assigneeLabel(p), s: 'text' },
        { v: p.qty, s: 'dec1' },
        { v: p.entryMode === 'times' ? p.breakMinutes : '', s: 'dec1' }
      ].concat(DAYS.map(function (d, i) {
        if (p.entryMode !== 'times') {
          return { v: p.hours[i] ? p.hours[i] + ' hrs' : 'Off', s: 'text' };
        }
        return { v: p.dayLabels[i] || 'Off', s: 'text' };
      })).concat([{ v: p.weeklyHoursPerPerson, s: 'dec1' }]));
    });
    if (!r.positions.length) sched.push([{ v: 'No positions entered.', s: 'text' }]);

    return {
      title: 'Staffing Grid — ' + (model.departmentName || 'Department'),
      creator: 'CaroMont Staffing Grid Builder',
      sheets: [
        { name: 'Summary', orientation: 'portrait', cols: [{ width: 42 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 14 }], rows: summary },
        { name: 'Staffing Grid', freeze: 1, cols: [{ width: 24 }, { width: 26 }, { width: 16 }, { width: 7 }, { width: 11 }].concat(DAYS.map(function () { return { width: 8 }; }), [{ width: 12 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 10 }]), rows: grid },
        { name: 'Shift Schedule', freeze: 4, cols: [{ width: 24 }, { width: 26 }, { width: 7 }, { width: 11 }].concat(DAYS.map(function () { return { width: 13 }; }), [{ width: 16 }]), rows: sched },
        { name: 'Productivity by Day', cols: [{ width: 16 }, { width: 18 }, { width: 16 }, { width: 20 }, { width: 20 }, { width: 22 }], rows: byDay },
        { name: 'Productivity by Person', freeze: 4, cols: [{ width: 24 }, { width: 26 }, { width: 16 }, { width: 7 }].concat(DAYS.map(function () { return { width: 9 }; }), [{ width: 16 }, { width: 16 }]), rows: byPos }
      ]
    };
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function toExcel(model, computed) {
    var blob = SGXlsx.toBlob(buildWorkbook(model, computed));
    downloadBlob(blob, fileBase(model) + '.xlsx');
  }

  function toJson(model) {
    var blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
    downloadBlob(blob, fileBase(model) + '.json');
  }

  return {
    buildWorkbook: buildWorkbook,
    toExcel: toExcel,
    toJson: toJson,
    downloadBlob: downloadBlob,
    fileBase: fileBase,
    assigneeLabel: assigneeLabel
  };
});
