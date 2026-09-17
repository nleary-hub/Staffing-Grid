# CaroMont Staffing Grid Builder

A single-page app for department managers to build, save, and share staffing
grids / FTE models. No login, no server, no install — open `index.html` and
start typing.

## Running it

**Simplest:** download or copy the folder and double-click `index.html`. It runs
straight from the file system in Chrome, Edge, Firefox or Safari.

**Shared:** drop the folder on any web server or intranet file share. There is
no build step, no package manager and no external CDN — every dependency is in
this repository.

```
python3 -m http.server 8080      # optional, if you prefer serving it
```

## What it does

**1 · Department & version** — department name, cost center, facility, prepared
by, fiscal year, version date and version label, plus free-text notes. Every
export and printout carries the version date.

**2 · Budget statistics** — annual budgeted volume and the volume unit (patient
days, visits, cases…), worked hours per unit (WHpU), FTE hours per year,
and PTO entered whichever way your budget expresses it:

| PTO basis | Meaning | pFTE = |
| --- | --- | --- |
| % of paid hours *(default)* | historical PTO usage as a share of paid hours | wFTE ÷ (1 − pct) |
| % of worked hours | PTO as a share of productive hours | wFTE × (1 + pct) |
| PTO as FTE | budgeted non-productive FTE | wFTE + PTO FTE |

Budgeted wFTE and pFTE are calculated from volume × WHpU, or you can type your
own figures to override them — leave them blank for auto. If you enter both,
their ratio becomes the benefit gross-up factor applied to the designed model,
which is shown in the derived stats so nothing is hidden.

**3 · Staffing grid** — one row per position. Each row is role-based (e.g.
"RN – Night") with a separate *Assigned to* field that can hold a job title, a
specific person's name, or be marked Open/TBD. Enter the worked (productive)
shift hours for each day of the week and a Qty for how many people fill that
position. Rows can be duplicated or removed. The grid calculates hours per
week, annual worked hours, wFTE and pFTE per row and in total.

**4 · Designed model vs budget** — designed wFTE/pFTE against budget, with the
variance, % of budget, and a banner at the top of the page that turns red the
moment the designed model exceeds the budgeted worked FTE.

**5 · Volume needed for 100% productivity** — two views, both driven by the
budgeted WHpU:

- *By day of week* — the scheduled worked hours each day ÷ WHpU = the volume
  that day must deliver to run at 100% productivity, next to the budgeted
  average per day and the variance.
- *Per person, per day* — what a single person in each position must cover on
  each day they are scheduled.

Plus the annual volume required versus budgeted, the gap, and the projected
productivity index (earned hours ÷ designed hours).

## Saving and loading

Models are saved in the browser's local storage on that computer, under
`caromont.staffingGrid.models.v1`.

- Every saved model has its own internal id. **Saving one department's model
  can never overwrite another's** — an overwrite only happens when you re-save
  the model you currently have open. Saving a new model whose department name
  already exists warns you and then creates an additional, separate record.
- **Save as new version** keeps the old record untouched, bumps the version
  label (v1 → v2) and stamps today's date.
- **Open saved…** lists every model with department, version, date, position
  count and wFTE vs budget, and lets you open, duplicate or delete.
- `Ctrl`/`Cmd` + `S` saves.

Local storage is per browser and per computer. To move models between machines
or to keep an off-machine copy, use **Backup file** (downloads every saved
model as JSON) and **Restore/Import**. Importing never clobbers an existing
record: a collision is stored as a new copy.

## Exports

- **Export Excel** — a real `.xlsx` with four sheets: *Summary*, *Staffing
  Grid*, *Productivity by Day*, *Productivity by Person*. Styled headers,
  frozen panes, column widths and number formats; over-budget figures are
  highlighted. Written by `assets/js/xlsx.js`, a small Office Open XML writer
  included here — no SheetJS, no CDN.
- **Export PDF** — opens the browser print dialog against a dedicated print
  layout (choose *Save as PDF* / *Microsoft Print to PDF*). Landscape letter,
  CaroMont header, the over/under-budget flag, the full grid and both
  productivity breakdowns, with the version date in the header and footer.

Both filenames carry the department and version date, e.g.
`Staffing-Grid_4-West-Med-Surg_2026-02-01_v3.xlsx`.

## Calculations

```
budgeted worked hours = annual volume × WHpU
budgeted wFTE         = budgeted worked hours ÷ FTE hours per year
budgeted pFTE         = budgeted wFTE × benefit gross-up factor

row hours/week        = Σ (hours for each day) × Qty
row wFTE              = row hours/week ÷ (FTE hours ÷ weeks per year)
row pFTE              = row wFTE × benefit gross-up factor

required volume (day) = worked hours scheduled that day ÷ WHpU
required volume (yr)  = designed annual worked hours ÷ WHpU
productivity index    = budgeted worked hours ÷ designed annual worked hours
```

The hours typed into the grid are **worked** hours — hours on the schedule. PTO
is therefore added on top, so paid FTE always sits at or above worked FTE, the
same way the budget is built.

## Branding

All CaroMont colors are CSS custom properties at the top of
`assets/css/app.css` (`--cm-blue`, `--cm-green`, …). The Excel palette is in the
`STYLES_XML` block of `assets/js/xlsx.js`. These are close approximations —
swap in the exact values from the CaroMont brand guide and both the app and the
exports follow.

## Tests

```
npm test          # or: node --test tests/*.test.js
```

21 tests cover the FTE and productivity math, each PTO basis, the override
behavior, the over-budget flag, department isolation in storage, and the
generated workbook.

## Files

```
index.html               app shell and layout
assets/css/app.css       branding, screen layout, print/PDF stylesheet
assets/js/calc.js        calculation engine (pure, unit-tested)
assets/js/xlsx.js        dependency-free .xlsx writer
assets/js/storage.js     saved-model library (localStorage) + backup/import
assets/js/export.js      workbook construction and downloads
assets/js/app.js         UI controller
tests/calc.test.js       unit tests
```
