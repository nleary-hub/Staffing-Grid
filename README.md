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
specific person's name, or be marked Open/TBD, plus a Qty for how many people
fill that position.

Each day of the week has its own **start and end time**, and the worked hours
for that day are calculated from them — so a position can work different hours
on different days. Times can be typed however you write them: `0700`, `700`,
`7`, `7:00`, `7a`, `7 AM`, `19:30`, `1930`, `7:30p`. They tidy up to 24-hour
form when you leave the box.

- An end time at or before the start is read as an **overnight shift**, so
  `1900`–`0730` is 12.5 hours.
- **Unpaid break (min)** is deducted from every day that has a shift and
  starts at **30 minutes** on a new row, so `0700`–`1930` comes to 12.0 worked
  hours rather than 12.5. Change it per row, or set it to 0 for shifts paid
  straight through. A saved model always keeps the break it was saved with.
- A blank day is a day off.
- The `⇉` row button copies the first day's times across all seven days.
- *Hours from* can be switched from **Times** to **Hours** on any row to type
  hours in directly — useful for a position with no fixed clock schedule.
  Models saved before shift times existed open in Hours mode with their
  numbers untouched.
- The *Shift label* column is optional; left blank, reports fall back to the
  row's most common time range (e.g. `0700-1930`).

Rows can be duplicated or removed, and **reordered** by dragging the `⋮⋮`
handle at the left of each row — or by focusing a handle and pressing the up /
down arrow keys. Order is presentation only; it never changes a total.

The **Columns** button hides any column you don't use — Type, Shift label,
Hours from, Unpaid break, individual days, or any calculated column. The choice
is saved with the model, so each department's grid reopens the way it was left,
and *Show all* brings everything back. Hiding a column changes the on-screen
view only: every total, FTE figure and export still uses all the data.

The grid calculates hours per week, annual worked hours, wFTE and pFTE per row
and in total.

**4 · Designed model vs budget** — designed wFTE/pFTE against budget, with the
variance, % of budget, and a banner at the top of the page that turns red the
moment the designed model exceeds the budgeted worked FTE.

**5 · Volume needed for 100% productivity** — two views, both driven by the
budgeted WHpU:

- *By day of week* — the scheduled worked hours each day ÷ WHpU = the volume
  that day must deliver to run at 100% productivity, next to that day's
  budgeted volume and the variance.

  **Spread budgeted volume** controls how the week's budgeted volume is
  divided across the days:

  - *Proportional to the hours scheduled each day* (default) — each day gets
    the share of the week's volume that matches its share of the scheduled
    hours, so a day staffed twice as heavily is expected to carry twice the
    volume. Comparing a heavily staffed Monday against a flat daily average
    otherwise makes every busy day look short and every quiet day generous.
  - *Evenly across every day* — the flat annual volume ÷ days per year, which
    is how a budget is usually quoted.

  Either way the seven days add up to the same week, and neither setting
  changes a required-volume figure, an FTE or an annual total — only how the
  budgeted side is apportioned.
- *Per person, per day* — what a single person in each position must cover on
  each day they are scheduled.

Plus the annual volume required versus budgeted, the gap, and the projected
productivity index (earned hours ÷ designed hours). Both productivity tables
have their own **Columns** picker, saved with the model like the grid's.

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

- **Export Excel** — a real `.xlsx` with five sheets: *Summary*, *Staffing
  Grid*, *Shift Schedule* (each day's start and end time behind the hours),
  *Productivity by Day*, *Productivity by Person*. Styled headers, frozen
  panes, column widths and number formats; over-budget figures are
  highlighted. Written by `assets/js/xlsx.js`, a small Office Open XML writer
  included here — no SheetJS, no CDN.
- **Export PDF** — opens the browser print dialog against a dedicated print
  layout (choose *Save as PDF* / *Microsoft Print to PDF*). Landscape letter,
  CaroMont header, the over/under-budget flag, the full grid with each day's
  time range printed under its hours, both productivity breakdowns, and a note
  of any unpaid breaks — with the version date in the header and footer.

Both filenames carry the department and version date, e.g.
`Staffing-Grid_4-West-Med-Surg_2026-02-01_v3.xlsx`.

## Calculations

```
day hours             = (end time − start time) − unpaid break
                        (end ≤ start rolls to the next day)

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

48 tests cover the FTE and productivity math, time parsing in every accepted
format, overnight shifts and unpaid breaks, each PTO basis, the override
behavior, the over-budget flag, department isolation in storage, backward
compatibility with models saved before shift times, row reordering, hidden
columns, both ways of spreading budgeted volume, and the generated workbook.

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
