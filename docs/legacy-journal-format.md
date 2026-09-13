# The legacy journal format

A specification of the Google Sheets / ODS workbook that Noted replaces, written for
whoever implements the importer.

It describes the format as it actually exists in the historical data, including the parts
that are inconsistent. Noted's own data model is deliberately *not* identical to this —
where the two differ, see [Mapping to Noted](#mapping-to-noted) at the end.

The normative implementation of the time syntax is the owner's separate journal-parsing
project (`parse_work_hours.py`). Where this document and that parser disagree, the parser
is right and this document is a bug.

---

## 1. Workbook structure

One workbook holds every week. Each **sheet is one week**, named `ddmmyy` for the Monday
that starts it — `310826` is the week of Monday 31 August 2026. Sheets are ordered most
recent first.

Three sheets are templates and carry no journal data: `TEMPLATE`, `TEMPLATE_SIMPLE`,
`TEMPLATE_SIMPLE_WE` (the `_WE` variant adds Saturday and Sunday). A sheet is a week if
and only if its name matches `^\d{6}$` and parses as a valid `ddmmyy` date.

## 2. Sheet layout

A week sheet is a fixed grid of three columns per day.

| Column         | Holds                                                      |
| -------------- | ---------------------------------------------------------- |
| `A` (day − 2)  | nothing; a narrow strip carrying the project's colour       |
| `B` (day − 1)  | the checkbox                                                |
| `C` (the day)  | the content                                                 |

| Row      | `A`            | `B`            | `C`                    |
| -------- | -------------- | -------------- | ---------------------- |
| 1        | —              | —              | `MONDAY`               |
| 2        | —              | day checkbox   | `31/08/26`             |
| 3, 4, …  | project colour | entry checkbox | `[L] Organize TODOs…`  |

- **Day columns** are at zero-based indices 2, 5, 8, 11, 14 (`C`, `F`, `I`, `L`, `O`), i.e.
  `range(2, ncols, 3)`. Weekend sheets extend the same pattern.
- The **checkbox column** for a day is its column minus one.
- The **project strip** is its column minus two — a narrow column carrying only colour.
- **Row 1** holds the uppercase day name, **row 2** the date `dd/mm/yy` and the day's own
  checkbox, and **rows 3 onward** the entries.
- Entries are contiguous from row 3 but the list is not padded: read down to the last
  non-empty cell in the column and stop.

Checkbox cells hold `1` (checked) or `0`. An empty content cell with an unchecked box is
just an unused row, not an unfinished task.

### The day checkbox

Row 2's checkbox marks the day as closed for editing. Its only effect is to enable the
"failed" styling below — until a day is closed, its unchecked entries are merely pending.

## 3. Cell content

A content cell holds one or two lines, separated by a newline inside the cell.

```
line 1    the entry itself
line 2    the note (optional)
```

Some cells have more than two lines; treat every line after the first as part of
the note.

## 4. Entry grammar

```
entry        = marker-entry | task-entry

task-entry   = *category [ project ] text
category     = "[" /[a-zA-Z]+/ "]"
project      = /[a-zA-Z0-9+.]+/ ":" SP
marker-entry = 1*( "[" ... "]" )          ; nothing outside the brackets
```

An entry is a **marker** if and only if its whole text matches `^(?:\[[^\][]*\])+$` — that
is, it consists of bracket groups and nothing else. This single test is what separates time
bookkeeping from real work, and it is the rule the spreadsheet itself used in its
conditional formatting. Everything else is a task.

Both prefixes on a task are optional, and when both are present the category comes first:

```
[T] atlas.2: Fix the export bug again by making the field optional.
[M] atlas.2: w/ the whole team, plan the next release.
    [1h30]
[CR] Review a colleague's PR.
Some entry with no prefixes at all.
```

### 4.1 Categories

A closed vocabulary describing what *kind* of thing the entry is. The meanings live in the
owner's head; the spreadsheet only ever used them for colour.

`S` has a defined colour but was never used.

### 4.2 Projects

An open vocabulary naming what the entry was *for*, letting work be traced across a project
that spans weeks. Written as a `path:` prefix after the category.

A project name is a **dot-separated path**, so projects form a hierarchy: `refactor` is a
project and `refactor.A` is a subproject of it. Segments are camelCase, and a subproject
segment is often just a letter or a digit — `atlas.2`, `deskApp.A`.

The spreadsheet defined this with two regexes of its own, which are the authority on the
syntax:

```
capture a project           ^(?:\[[a-zA-Z]+\])*? ?([a-zA-Z0-9+.]+):
capture a *new* project     ^(?:\[[a-zA-Z]+\])* ?([a-zA-Z0-9.]*?\+[a-zA-Z0-9.]*?): .*
```

The vocabulary was never normalised, and
the importer should not normalise it either.

#### Declaring a project with `+`

A project is **introduced** by putting a `+` immediately before the segment being created,
the first time it is used:

```
[T] +webApp: Start on the new front end.    declares the project "webApp"
[T] webApp: Carry on with it.               refers to it
[T] refactor.+A: Split out the parser.        declares subproject "A" under "refactor"
[T] refactor.A: Keep going.                   refers to it
```

This is why the regex permits a `+` anywhere in the label rather than only at the front:
its position says *which segment of the path is new*. `+foo.bar` would declare a new
top-level `foo`, while `foo.+bar` declares a new `bar` beneath an existing `foo`.

The `+` is not part of the name — the real path is the label with every `+` stripped out.

The important consequence, and the reason `+` exists at all: **a `+` starts a new project
even if that path has been used before.** Re-declaring `+webApp:` later does not continue
the old `webApp`; it begins a second, unrelated project that happens to share a name. So
a project's identity is *not* its path — it is the declaration, and entries belong to
whichever declaration most recently preceded them. An importer must resolve projects
chronologically, and must be prepared to emit two distinct projects with the same path.

A project used without ever having been declared is shown in **pure red**, which is the
spreadsheet's way of flagging a typo in a prefix.

#### Colour

Project colours were computed, not stored. The label is hashed:

```
hash = ( Σ  charCode(labelᵢ) × 6^(i−1) )  mod  1234577
R    = (hash × 139) mod 256
G    = (hash × 39)  mod 256
B    = (hash × 19)  mod 256
```

with `1234577`, `139`, `39` and `19` all chosen as primes, and `i` counting from 1. An
undeclared label bypasses this and gets `(255, 0, 0)`.

There is **no lightness or saturation constraint anywhere in this** — the three channels
are independent hashes, so the palette includes near-blacks that vanish against the dark
background and muddy mid-tones that are hard to tell apart. This is worth knowing precisely
so as not to reproduce it: see [Mapping to Noted](#mapping-to-noted).

#### Lettered subprojects

Two further regexes support the lettered form: `^[A-Z]$` matches a bare single-capital
segment, and `^(?:[A-Za-z]*\.)*[A-Z]?$` matches a path ending in one. A helper formula
offers the next letter automatically, so the subproject after `refactor.A` is suggested as
`refactor.+B`. Noted need not reproduce the auto-suggestion, but it explains the lettered
segments in the data.

### 4.3 Notes

The second line is usually prose: how the thing actually went, what failed, what a meeting
covered.

Some are instead a bracketed time fact about that entry:

| Form             | Meaning            |
| ---------------- | ------------------ |
| `[-> 17:30]`     | finished at        |
| `[1h30]`         | took               |
| `[2h]`           | took               |
| `[30m]`          | took               |
| `[9:00 -> 11:00]`| ran from…to        |

A further handful give a duration in words rather than numbers:

| Form                 |
| -------------------- |
| `[Hours]` / `[hours]`|
| `[Several hours]`    |
| `[All afternoon]`    |
| `[Hours and hours]`  |
| `[Hours on the write-up]` |

Case varies, and the last one carries trailing context. These say "much longer than
usual" without naming a figure, which is exactly how Noted treats them — see
[Mapping to Noted](#mapping-to-noted).

### 4.4 Meta entries

Not every bracket-only entry is about time. A large minority annotate the day itself, and
they come in three flavours.

**Day status**, always the first entry, conventionally uppercase, and making the day
non-working:

```
[PAID HOLIDAY]    [HOLIDAY]    [UNPAID OFF]
[SICK DAY]    [OFF]    [UNPAID HOLIDAY]
[BACK FROM A LONG BREAK]      [Back from a week away]
```

**Described deductions** — an interruption, with its cost in parentheses:

```
[Errand in town (-1h45)]
[Sort out some paperwork (-30m)]
[Phone calls (-30m)]
[Tidy the desk (-30m)]
[(-1h)]   [(-30m)]   [(-15m)]      ← the same thing, undescribed
```

Note the last row: a bare `[(-30m)]` is a deduction with no label, which is the same shape
as the `[-15m]` breaks in §5 but written with parentheses. Both occur. A parser should
treat any bracket entry containing a parenthesised duration as a deduction and take
whatever precedes the parenthesis as its description.

**Plain annotations**, carrying no time at all — context about the day:

```
[Back home]   [On site]   [In the other office, on site]   [Working from home]
[Breakfast meeting]     [Drinks after work]    [Cake for a birthday]
[Set up the new laptop]   [Rebind a keyboard shortcut]   [Draft a summary]
```

There is no syntactic marker separating these three: the distinction is whether the text
is a recognised status word, contains a parenthesised duration, or neither.

## 5. Time markers

Marker entries record the shape of the working day. Their position in the column matters.

| Form                        | Position | Meaning                                |
| --------------------------- | -------- | -------------------------------------- |
| `[-> 9:45]`                 | first    | arrival                                |
| `[-> 18:45]`                | last     | departure                              |
| `[# 1h30]`                  | middle   | noon break, as a duration              |
| `[# 12:45 -> 14:00]`        | middle   | noon break, as an explicit range       |
| `[#]`                       | middle   | noon break, of the default length      |
| `[# 0m]`                    | middle   | noon break **skipped**                 |
| `[-15m]`, `[-1h]`, `[20m]`  | middle   | another break, as a duration           |
| `[15:00 -> 15:20]`          | middle   | another break, as a range              |

### 5.1 Durations

```
duration = <n>"h"<n>["m"]   |   <n>"h"   |   <n>"m"
```

So `1h30`, `1h30m`, `2h`, `45m`. A leading `-` is decorative — `[-15m]` is a fifteen-minute
break, not a negative one.

### 5.2 Deltas and the `=>` override

Markers often carry parenthesised arithmetic the owner did by hand:

```
[-> 9:45 (-15m)]                arrival, 15 minutes of deficit
[# 1h30 (-30m)]                 break ran 30 minutes long
[-> 18:45 (+15m => -30m)]       left 15 minutes late; the day came to -30m overall
```

The value after `=>` is **the whole day's overtime**, and the reference parser treats it as
authoritative, short-circuiting the calculation entirely.

These numbers are derived, not data. Recompute them on import — but compare, and report any
day where the recomputed figure disagrees with the recorded one, because that is either a
typo in the original or a gap in the parsing.

### 5.3 Special days

If *every* non-empty entry in a day is a marker, the day is a special day: its text is kept
as a label and it counts as zero worked time.

```
[PAID HOLIDAY]      [HOLIDAY]      [Back from holiday]
[SICK DAY]      [OFF]
```

## 6. Computing a day

```
worked   = (departure − arrival) − noon_break − Σ other_breaks
delta    = worked − expected
```

Missing markers fall back to the defaults for that weekday:

| Day     | Arrival | Departure | Noon break | Expected |
| ------- | ------- | --------- | ---------- | -------- |
| Mon–Thu | 09:00   | 17:00     | 1h00       | 7h00     |
| Friday  | 09:00   | 16:00     | 1h00       | 6h00     |
| Sat/Sun | —       | —         | 0          | 0        |

A skipped noon break (`[# 0m]`) therefore yields an extra hour of overtime, which is why it
is usually written `[# 0m (+1h)]`.

If the departure is earlier than the arrival, the work ran past midnight: add 24 hours
before subtracting.

## 7. Colour

The colours are the format's real user interface, and they are entirely derived — every one
of them comes from a conditional-formatting rule, never from stored data. In priority
order:

1. **Failed** — the day is closed, the entry is unchecked, and its content is non-empty.
   Content goes `#681100`, checkbox `#980000`.
2. **Marker** — the content is bracket-only. Content `#662344`, checkbox `#9b0c56`.
3. **Category** — the checkbox takes the category's colour; `[D]` additionally greys the
   content to `#494949`.
4. **Project** — the narrow strip column takes a colour derived from the project name.

The default surfaces are `#312e2a` for content and `#2c2115` for the checkbox column.
Category colours are carried in the frontend's `src/styles.css` as `--checkbox-tag-*`.

Project colours were computed from the label rather than stored; see
[4.2](#42-projects) for the formula.

## 8. Known quirks

Things the importer will hit:

- **`=>` hides the departure.** In the reference parser, a marker containing `=>` is
  consumed as an overtime override and its departure time is never recorded. Since nearly
  every departure marker carries a `=>`, most days have no parsed departure and fall back
  to the explicit total. An importer that reads the time as well will produce *better* data
  than the reference, but will also diverge from it — hence the reconciliation report in
  §5.2.
- **Arrival is positional.** It is only recognised within the first few rows; a `[-> …]`
  lower down is read as a departure.
- **Last one wins.** Multiple departure markers overwrite each other.
- **Mojibake.** The export is UTF-8 but round-tripped through Latin-1 in places; expect
  damaged accented characters in names.
- **Empty rows in the middle.** A blank content cell between two entries is padding, not a
  gap in the day.

## Mapping to Noted

Noted keeps the entry grammar — it is good, and the owner's fingers already know it — but
promotes everything else out of text:

| Legacy                              | Noted                                        |
| ----------------------------------- | -------------------------------------------- |
| Sheet per week                       | Nothing; a week is a date range over entries |
| Day checkbox                         | Dropped — a day is closed once it is past    |
| Marker entries                       | Fields on the day: arrival, break, departure |
| `[# 1h30]` without placement         | A break with a duration and no start/end     |
| Hand-computed deltas                 | Always recomputed                            |
| Per-weekday schedule in parser code  | Editable settings, snapshot onto each day    |
| Conditional formatting               | The same rules, applied at render time       |
| `+path:` declaring a project         | A project record; undeclared use is refused  |
| Colour hashed from the label         | Sampled once and stored, editable by the user|
| Nowhere to say what a project *is*   | A description per project, shown in a drawer |
| `[Errand in town (-1h45)]`      | A break carrying a description               |
| `[Several hours]`                    | A weight in the day's time split, not a value|
| Day status as the first entry        | A status field on the day                    |
| Plain `[…]` annotations              | Meta entries, kept as entries                |
