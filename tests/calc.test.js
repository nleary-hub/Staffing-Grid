const test = require('node:test');
const assert = require('node:assert');
const SGCalc = require('../assets/js/calc.js');
const SGStore = require('../assets/js/storage.js');
const SGXlsx = require('../assets/js/xlsx.js');
const SGExport = require('../assets/js/export.js');

const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} to be within ${eps} of ${b}`);

function model(overrides = {}, positions = []) {
  const seed = Object.assign({ departmentName: '4 West Med-Surg' }, overrides);
  seed.budget = Object.assign({
    annualVolume: 10950, volumeUnit: 'Patient Days', whpu: 8,
    ptoBasis: 'paidPct', ptoValue: 10
  }, overrides.budget || {});
  const m = SGCalc.newModel(seed);
  m.positions = positions.map(SGCalc.newPosition);
  return m;
}

test('budget worked hours and wFTE come from volume x WHpU', () => {
  const r = SGCalc.computeModel(model());
  close(r.budget.workedHours, 87600);          // 10,950 x 8
  close(r.budget.wFTE, 87600 / 2080);
  close(r.budget.avgDailyVolume, 30);          // 10,950 / 365
});

test('PTO as % of paid hours grosses wFTE up to pFTE', () => {
  const r = SGCalc.computeModel(model());
  close(r.budget.ptoFactor, 1 / 0.9);
  close(r.budget.pFTE, r.budget.wFTE / 0.9);
  close(r.budget.ptoPctOfPaid, 0.1);           // round-trips back to 10%
});

test('PTO as % of worked hours uses the 1 + p factor', () => {
  const r = SGCalc.computeModel(model({ budget: { ptoBasis: 'workedPct', ptoValue: 10 } }));
  close(r.budget.ptoFactor, 1.1);
  close(r.budget.pFTE, r.budget.wFTE * 1.1);
});

test('PTO entered as FTE is added on top of budgeted wFTE', () => {
  const r = SGCalc.computeModel(model({ budget: { ptoBasis: 'ptoFTE', ptoValue: 4.5 } }));
  close(r.budget.pFTE, r.budget.wFTE + 4.5);
  close(r.budget.ptoFTE, 4.5);
});

test('a PTO percent may be entered as 10 or as 0.10', () => {
  const a = SGCalc.computeModel(model({ budget: { ptoValue: 10 } })).budget.pFTE;
  const b = SGCalc.computeModel(model({ budget: { ptoValue: 0.1 } })).budget.pFTE;
  close(a, b);
});

test('entered wFTE / pFTE override the calculated values and define the factor', () => {
  const r = SGCalc.computeModel(model({ budget: { budgetedWFTE: 40, budgetedPFTE: 46 } }));
  close(r.budget.wFTE, 40);
  close(r.budget.pFTE, 46);
  close(r.budget.ptoFactor, 46 / 40);
  close(r.budget.workedHours, 40 * 2080);
  assert.ok(r.budget.wFTEIsOverride && r.budget.pFTEIsOverride);
});

test('scheduled hours roll up to weekly hours, annual hours and FTE', () => {
  const r = SGCalc.computeModel(model({}, [
    { role: 'RN Day', qty: 6, hours: [12, 12, 12, 12, 12, 12, 12] }
  ]));
  const p = r.positions[0];
  close(p.weeklyHoursPerPerson, 84);
  close(p.weeklyHours, 504);                   // 84 x 6
  close(p.annualWorkedHours, 504 * 52);
  close(p.wFTE, 504 / 40);                     // 12.6
  close(r.designed.wFTE, 12.6);
  close(r.designed.pFTE, 12.6 / 0.9);
  close(r.designed.headcount, 6);
});

test('a 40-hour week for one person is exactly 1.0 wFTE', () => {
  const r = SGCalc.computeModel(model({}, [
    { role: 'Coordinator', qty: 1, hours: [0, 8, 8, 8, 8, 8, 0] }
  ]));
  close(r.designed.wFTE, 1);
});

test('daily hours total across every position', () => {
  const r = SGCalc.computeModel(model({}, [
    { qty: 2, hours: [8, 8, 0, 0, 0, 0, 0] },
    { qty: 1, hours: [4, 0, 12, 0, 0, 0, 0] }
  ]));
  assert.deepStrictEqual(r.designed.dailyHours, [20, 16, 12, 0, 0, 0, 0]);
});

test('over-budget flag fires only when designed wFTE exceeds budget', () => {
  const under = SGCalc.computeModel(model({ budget: { budgetedWFTE: 20 } }, [
    { qty: 10, hours: [8, 8, 8, 8, 8, 0, 0] }   // 400 hrs/wk = 10 wFTE
  ]));
  assert.strictEqual(under.variance.overWorked, false);
  close(under.variance.wFTE, -10);

  const over = SGCalc.computeModel(model({ budget: { budgetedWFTE: 5 } }, [
    { qty: 10, hours: [8, 8, 8, 8, 8, 0, 0] }
  ]));
  assert.strictEqual(over.variance.overWorked, true);
  close(over.variance.wFTE, 5);
  close(over.variance.wFTEPctOfBudget, 2);
});

test('an unset budget never trips the over-budget flag', () => {
  const r = SGCalc.computeModel(model({ budget: { annualVolume: '', whpu: '' } }, [
    { qty: 4, hours: [8, 8, 8, 8, 8, 0, 0] }
  ]));
  close(r.budget.wFTE, 0);
  assert.strictEqual(r.variance.overWorked, false);
  assert.strictEqual(r.variance.overPaid, false);
});

test('required volume per day = scheduled hours / WHpU', () => {
  const r = SGCalc.computeModel(model({ budget: { whpu: 8 } }, [
    { qty: 2, hours: [16, 0, 0, 0, 0, 0, 0] }   // 32 hrs on Sunday
  ]));
  const sun = r.productivity.byDay[0];
  close(sun.hours, 32);
  close(sun.requiredUnits, 4);                  // 32 / 8
  close(sun.budgetedUnits, 30);
  close(sun.varianceUnits, -26);
  close(sun.eightHourEquivalents, 4);
});

test('per-person required volume is per single person, not the whole row', () => {
  const r = SGCalc.computeModel(model({ budget: { whpu: 4 } }, [
    { role: 'Tech', qty: 3, hours: [12, 0, 0, 0, 0, 0, 0] }
  ]));
  const p = r.productivity.byPosition[0];
  close(p.dayUnits[0], 3);                      // 12 hrs / 4 WHpU, one person
  close(p.weeklyUnitsPerPerson, 3);
  close(p.weeklyUnitsForRow, 9);                // x 3 people
  close(r.productivity.byDay[0].requiredUnits, 9);
});

test('annual required volume and the productivity index agree', () => {
  const r = SGCalc.computeModel(model({ budget: { annualVolume: 10950, whpu: 8 } }, [
    { qty: 10, hours: [8, 8, 8, 8, 8, 8, 8] }   // 560 hrs/wk
  ]));
  close(r.designed.annualWorkedHours, 560 * 52);
  close(r.productivity.requiredAnnualVolume, (560 * 52) / 8);
  close(r.productivity.volumeGap, (560 * 52) / 8 - 10950);
  close(r.productivity.productivityIndex, 87600 / (560 * 52));
  close(r.productivity.requiredAvgDailyVolume, ((560 * 52) / 8) / 365);
});

test('a zero WHpU degrades to zero instead of Infinity', () => {
  const r = SGCalc.computeModel(model({ budget: { whpu: 0 } }, [
    { qty: 1, hours: [8, 8, 8, 8, 8, 0, 0] }
  ]));
  assert.ok(isFinite(r.productivity.requiredAnnualVolume));
  close(r.productivity.requiredAnnualVolume, 0);
  close(r.productivity.byDay[0].requiredUnits, 0);
});

test('blank and text hour entries are treated as zero', () => {
  const r = SGCalc.computeModel(model({}, [
    { qty: '2', hours: ['8', '', null, 'abc', 8, undefined, 0] }
  ]));
  close(r.positions[0].weeklyHoursPerPerson, 16);
  close(r.positions[0].weeklyHours, 32);
});

test('a non-2080 FTE definition flows through worked and paid FTE', () => {
  const r = SGCalc.computeModel(model({ budget: { fteHours: 1950, weeksPerYear: 52 } }, [
    { qty: 1, hours: [0, 7.5, 7.5, 7.5, 7.5, 7.5, 0] }
  ]));
  close(r.inputs.fteWeeklyHours, 37.5);
  close(r.designed.wFTE, 1);
  close(r.budget.wFTE, 87600 / 1950);
});

test('models saved for different departments do not overwrite each other', () => {
  const memory = {};
  global.window = { localStorage: {
    getItem: k => (k in memory ? memory[k] : null),
    setItem: (k, v) => { memory[k] = String(v); },
    removeItem: k => { delete memory[k]; }
  } };

  const a = SGStore.save(SGCalc.newModel({ departmentName: 'ICU' }));
  const b = SGStore.save(SGCalc.newModel({ departmentName: '4 West' }));
  assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(SGStore.list().length, 2);

  // Same department name, separate record -> both survive.
  const c = SGStore.save(SGCalc.newModel({ departmentName: 'ICU', versionLabel: 'v2' }));
  assert.strictEqual(SGStore.list().length, 3);
  assert.strictEqual(SGStore.findByDepartment('icu ', c.id).length, 1);

  // Re-saving the same id updates in place.
  const again = SGStore.save(Object.assign({}, a, { versionLabel: 'v9' }));
  assert.strictEqual(again.id, a.id);
  assert.strictEqual(SGStore.list().length, 3);
  assert.strictEqual(SGStore.get(a.id).versionLabel, 'v9');

  // Importing without replace keeps existing records intact.
  const res = SGStore.importBackup(SGStore.exportBackup(), false);
  assert.strictEqual(res.added, 3);
  assert.strictEqual(res.replaced, 0);
  assert.strictEqual(SGStore.list().length, 6);

  SGStore.remove(a.id);
  assert.strictEqual(SGStore.get(a.id), null);
  delete global.window;
});

test('workbook builds every sheet with the expected headline numbers', () => {
  const m = model({}, [{ role: 'RN', qty: 6, hours: [12, 12, 12, 0, 0, 0, 0] }]);
  const r = SGCalc.computeModel(m);
  const wb = SGExport.buildWorkbook(m, r);
  assert.deepStrictEqual(wb.sheets.map(s => s.name),
    ['Summary', 'Staffing Grid', 'Shift Schedule', 'Productivity by Day', 'Productivity by Person']);

  const bytes = SGXlsx.build(wb);
  // Local file header magic - a real ZIP/OOXML container.
  assert.deepStrictEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(bytes.length > 3000);

  const totalRow = wb.sheets[1].rows[wb.sheets[1].rows.length - 3];
  assert.strictEqual(totalRow[0].v, 'TOTAL');
  close(totalRow[totalRow.length - 2].v, r.designed.wFTE);
});

test('xlsx escapes XML-unsafe text in department names', () => {
  const m = model({ departmentName: 'Peds & <Neuro> "Unit"' }, []);
  const xml = Buffer.from(SGXlsx.build(SGExport.buildWorkbook(m, SGCalc.computeModel(m)))).toString('latin1');
  assert.ok(xml.includes('Peds &amp; &lt;Neuro&gt;'));
  assert.ok(!xml.includes('<Neuro>'));
});

test('export filenames are filesystem-safe and carry the version date', () => {
  const m = SGCalc.newModel({ departmentName: '4 West / Med-Surg', versionDate: '2026-02-01', versionLabel: 'v3' });
  assert.strictEqual(SGExport.fileBase(m), 'Staffing-Grid_4-West-Med-Surg_2026-02-01_v3');
});

/* ---------------- start / end shift times ---------------- */

function timed(times, extra = {}) {
  // breakMinutes pinned to 0 here so these cases measure the raw clock span;
  // the 30-minute default is covered by its own tests below.
  return Object.assign({ entryMode: 'times', qty: 1, breakMinutes: 0, times }, extra);
}
const T = (start, end) => ({ start, end });
const OFF = { start: '', end: '' };

test('a time is understood however the manager types it', () => {
  const cases = {
    '0700': 420, '700': 420, '7': 420, '7:00': 420, '07:00': 420,
    '7a': 420, '7am': 420, '7 AM': 420, '7:00 a.m.': 420,
    '1930': 1170, '19:30': 1170, '7:30p': 1170, '7:30 PM': 1170,
    '12a': 0, '12am': 0, '0000': 0, '12p': 720, '2400': 1440, '24:00': 1440
  };
  for (const [text, mins] of Object.entries(cases)) {
    assert.strictEqual(SGCalc.parseTime(text), mins, `parseTime(${JSON.stringify(text)})`);
  }
  for (const bad of ['', '   ', 'x', 'lunch', '25:00', '7:75', '13a', '99999', null, undefined]) {
    assert.strictEqual(SGCalc.parseTime(bad), null, `parseTime(${JSON.stringify(bad)}) should be null`);
  }
});

test('times normalise back to a 24-hour display', () => {
  assert.strictEqual(SGCalc.formatTime(SGCalc.parseTime('7a')), '07:00');
  assert.strictEqual(SGCalc.formatTime(SGCalc.parseTime('730p')), '19:30');
  assert.strictEqual(SGCalc.formatTime(1440), '24:00');
  assert.strictEqual(SGCalc.compactTime(SGCalc.parseTime('7:30 PM')), '1930');
  assert.strictEqual(SGCalc.shiftLabel('7a', '7:30p'), '0700-1930');
  assert.strictEqual(SGCalc.shiftLabel('7a', ''), '');
});

test('hours come from the clock span between start and end', () => {
  close(SGCalc.shiftHours('0700', '1930', 0), 12.5);
  close(SGCalc.shiftHours('0800', '1630', 0), 8.5);
  close(SGCalc.shiftHours('7a', '3:30p', 0), 8.5);
});

test('the unpaid break is deducted from the clock span', () => {
  close(SGCalc.shiftHours('0700', '1930', 30), 12);
  close(SGCalc.shiftHours('0800', '1630', 30), 8);
  close(SGCalc.shiftHours('0800', '1200', 0), 4);
  close(SGCalc.shiftHours('0800', '0815', 30), 0);   // break longer than the shift never goes negative
});

test('an end at or before the start is an overnight shift', () => {
  close(SGCalc.shiftHours('1900', '0730', 0), 12.5);
  close(SGCalc.shiftHours('1900', '0730', 30), 12);
  close(SGCalc.shiftHours('2300', '0700', 0), 8);
  close(SGCalc.shiftHours('0700', '0700', 0), 0);    // identical times are not a 24-hour shift
  close(SGCalc.shiftHours('0000', '2400', 0), 24);   // a full day is written 00:00-24:00
});

test('a missing or unreadable time scores zero hours', () => {
  close(SGCalc.shiftHours('0700', '', 0), 0);
  close(SGCalc.shiftHours('', '1930', 0), 0);
  close(SGCalc.shiftHours('lunch', '1930', 0), 0);
});

test('each day of the week can carry its own start and end time', () => {
  const r = SGCalc.computeModel(model({}, [timed([
    OFF,                    // Sun off
    T('0700', '1530'),      // Mon  8.0
    T('0700', '1930'),      // Tue 12.5
    T('1900', '0730'),      // Wed 12.5 overnight
    T('0900', '1300'),      // Thu  4.0
    T('0700', '1530'),      // Fri  8.0
    OFF                     // Sat off
  ])]));
  const p = r.positions[0];
  assert.deepStrictEqual(p.hours.map(h => Math.round(h * 100) / 100), [0, 8.5, 12.5, 12.5, 4, 8.5, 0]);
  close(p.weeklyHoursPerPerson, 46);
  assert.deepStrictEqual(p.dayLabels, ['', '0700-1530', '0700-1930', '1900-0730', '0900-1300', '0700-1530', '']);
  assert.deepStrictEqual(r.designed.dailyHours.map(h => Math.round(h * 100) / 100), [0, 8.5, 12.5, 12.5, 4, 8.5, 0]);
});

test('the unpaid break applies per scheduled day, not per week', () => {
  const r = SGCalc.computeModel(model({}, [timed(
    [OFF, T('0700', '1930'), T('0700', '1930'), T('0700', '1930'), OFF, OFF, OFF],
    { breakMinutes: 30, qty: 1 }
  )]));
  close(r.positions[0].weeklyHoursPerPerson, 36);   // 3 x 12.0, not 3 x 12.5 - 0.5
  close(r.designed.wFTE, 0.9);
});

test('three 12s a night with a break is 0.9 wFTE, and qty multiplies it', () => {
  const r = SGCalc.computeModel(model({}, [timed(
    [T('1900', '0730'), T('1900', '0730'), T('1900', '0730'), OFF, OFF, OFF, OFF],
    { breakMinutes: 30, qty: 6 }
  )]));
  close(r.positions[0].weeklyHoursPerPerson, 36);
  close(r.positions[0].weeklyHours, 216);
  close(r.designed.wFTE, 5.4);
});

test('a row can still be entered as plain hours', () => {
  const r = SGCalc.computeModel(model({}, [
    { entryMode: 'hours', qty: 2, hours: [0, 8, 8, 8, 8, 8, 0], breakMinutes: 45,
      times: [T('0700', '1930'), OFF, OFF, OFF, OFF, OFF, OFF] }
  ]));
  // hours mode ignores both the times and the break
  close(r.positions[0].weeklyHoursPerPerson, 40);
  close(r.designed.wFTE, 2);
  assert.deepStrictEqual(r.positions[0].dayLabels, ['', '', '', '', '', '', '']);
});

test('entry mode is inferred so models saved before times still open correctly', () => {
  const legacy = SGCalc.newPosition({ role: 'RN', qty: 3, hours: [0, 12, 12, 12, 0, 0, 0] });
  assert.strictEqual(legacy.entryMode, 'hours');
  assert.deepStrictEqual(legacy.times, SGCalc.emptyTimes());

  const withTimes = SGCalc.newPosition({ role: 'RN', times: [T('0700', '1930'), OFF, OFF, OFF, OFF, OFF, OFF] });
  assert.strictEqual(withTimes.entryMode, 'times');

  const blank = SGCalc.newPosition();
  assert.strictEqual(blank.entryMode, 'times');

  // A whole legacy model keeps its numbers unchanged.
  const legacyModel = model({}, []);
  legacyModel.positions = [{ id: 'p1', role: 'RN', qty: 6, hours: [12, 12, 12, 0, 0, 0, 0] }];
  close(SGCalc.computeModel(legacyModel).designed.wFTE, 5.4);
  close(SGCalc.computeModel(SGCalc.newModel(legacyModel)).designed.wFTE, 5.4);
});

test('an untyped shift label falls back to the most common time range', () => {
  const r = SGCalc.computeModel(model({}, [
    timed([OFF, T('0700', '1930'), T('0700', '1930'), T('0900', '1300'), OFF, OFF, OFF]),
    timed([OFF, T('0800', '1630'), OFF, OFF, OFF, OFF, OFF], { shift: 'Days' })
  ]));
  assert.strictEqual(r.positions[0].derivedShift, '0700-1930');
  assert.strictEqual(r.positions[0].shiftDisplay, '0700-1930');
  assert.strictEqual(r.positions[1].shiftDisplay, 'Days');   // a typed label always wins
});

test('per-day times flow through to the productivity breakdowns', () => {
  const r = SGCalc.computeModel(model({ budget: { whpu: 4 } }, [
    timed([OFF, T('0700', '1900'), T('0700', '1100'), OFF, OFF, OFF, OFF], { qty: 2 })
  ]));
  close(r.productivity.byDay[1].hours, 24);          // 12 hrs x 2 people
  close(r.productivity.byDay[1].requiredUnits, 6);   // 24 / 4
  close(r.productivity.byDay[2].requiredUnits, 2);   // 8 / 4
  close(r.productivity.byPosition[0].dayUnits[1], 3); // one person: 12 / 4
  assert.deepStrictEqual(r.productivity.byPosition[0].dayLabels[1], '0700-1900');
});

test('the workbook gains a shift schedule sheet showing the times', () => {
  const m = model({}, [timed([OFF, T('0700', '1930'), T('1900', '0730'), OFF, OFF, OFF, OFF], { breakMinutes: 30 })]);
  const wb = SGExport.buildWorkbook(m, SGCalc.computeModel(m));
  assert.deepStrictEqual(wb.sheets.map(s => s.name),
    ['Summary', 'Staffing Grid', 'Shift Schedule', 'Productivity by Day', 'Productivity by Person']);

  const rows = wb.sheets[2].rows;
  const body = rows[rows.length - 1];
  assert.strictEqual(body[3].v, 30);          // unpaid break
  assert.strictEqual(body[4].v, 'Off');       // Sunday
  assert.strictEqual(body[5].v, '0700-1930');
  assert.strictEqual(body[6].v, '1900-0730');
  close(body[11].v, 24);                      // 12 + 12 after the break

  const xml = Buffer.from(SGXlsx.build(wb)).toString('latin1');
  assert.ok(xml.includes('0700-1930'));
});

test('a new position row starts with a 30-minute unpaid break', () => {
  assert.strictEqual(SGCalc.DEFAULT_BREAK_MINUTES, 30);
  assert.strictEqual(SGCalc.newPosition().breakMinutes, 30);

  // so a 12-hour shift reads as 12.0 worked hours straight away
  const r = SGCalc.computeModel(model({}, [
    { entryMode: 'times', qty: 1, times: [OFF, T('0700', '1930'), OFF, OFF, OFF, OFF, OFF] }
  ]));
  close(r.positions[0].hours[1], 12);
  close(r.positions[0].breakMinutes, 30);
});

test('the break stays editable and an explicit value always wins', () => {
  for (const [entered, expected] of [[0, 0], [45, 45], ['20', 20], ['', 0]]) {
    assert.strictEqual(SGCalc.newPosition({ breakMinutes: entered }).breakMinutes, expected,
      `breakMinutes ${JSON.stringify(entered)}`);
  }
  // 0 means paid straight through, not "unset" - the default must not creep back
  const r = SGCalc.computeModel(model({}, [
    { entryMode: 'times', qty: 1, breakMinutes: 0, times: [OFF, T('0700', '1930'), OFF, OFF, OFF, OFF, OFF] }
  ]));
  close(r.positions[0].hours[1], 12.5);

  const long = SGCalc.computeModel(model({}, [
    { entryMode: 'times', qty: 1, breakMinutes: 60, times: [OFF, T('0700', '1930'), OFF, OFF, OFF, OFF, OFF] }
  ]));
  close(long.positions[0].hours[1], 11.5);
});

test('a saved model keeps the break it was saved with', () => {
  const saved = SGCalc.newModel({
    departmentName: 'Saved unit',
    positions: [{ id: 'p1', entryMode: 'times', qty: 1, breakMinutes: 0,
                  times: [OFF, T('0700', '1930'), OFF, OFF, OFF, OFF, OFF] }]
  });
  assert.strictEqual(saved.positions[0].breakMinutes, 0);
  close(SGCalc.computeModel(saved).positions[0].hours[1], 12.5);

  // reloading it again must not reintroduce the default
  assert.strictEqual(SGCalc.newModel(saved).positions[0].breakMinutes, 0);
});

test('a legacy hours-mode row is unaffected by the default break', () => {
  const legacy = SGCalc.newPosition({ role: 'RN', qty: 3, hours: [0, 12, 12, 12, 0, 0, 0] });
  assert.strictEqual(legacy.entryMode, 'hours');
  assert.strictEqual(legacy.breakMinutes, 30);   // carried, but unused in hours mode
  const r = SGCalc.computeModel(model({}, [legacy]));
  close(r.positions[0].weeklyHoursPerPerson, 36);
});
