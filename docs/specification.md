# Noted — specification

What Noted should do, written for whoever implements it.

This is a working document. It records decisions made in conversation that aren't yet
expressed in code; as each one lands, the corresponding section here can shrink to a
pointer at the code that now embodies it. It is not a design doc and not a tutorial —
where a decision had a reason that isn't obvious, the reason is stated, and otherwise not.

The format Noted replaces is specified separately in
[legacy-journal-format.md](legacy-journal-format.md).

---

## 1. Scope

A personal work journal for a single user running it locally. No auth, no multi-tenancy,
no sync. That's a constraint to design to, not a stage to grow out of.

**v1 contains** the week view and entry editor, the projects drawer, and the settings
screen. **v1 does not contain** stats, search, or filtering by project — they're the real
payoff of structured data, but nothing else depends on them, so they come after.

## 2. Data model

```
entry     id, date, position, kind, done, category, project_id, text, note,
          explicit_minutes?, explicit_end?, approx_weight?
project   id, path, colour, description, declared_on
category  name, meaning, colour
day       date, status, arrival?, departure?, expected_minutes
break     id, date, position, is_noon, description?,
          start? + end?   |   minutes?
settings  weekday, arrival, break_start, break_end, departure
```

Notes on the shape:

- There is no week table. A week is a date range, so "which weeks exist" is a query.
- `project.id` is a surrogate. It must be, because a project's identity is its declaration
  and two projects can share a path — see §4.
- A break carries **either** `start`/`end` **or** `minutes`, never both. Imported days
  usually record how long the noon break was but not when it happened.
- `entry.explicit_*` and `break.*` are the only timing ever stored. Everything else about
  duration is computed on read — see §6.

## 3. Entries

An entry belongs to a day and has a position in it. Two kinds:

**Task** — the normal case. Carries a category, optionally a project, text, and optionally
a note.

**Meta** — a bracketed annotation about the day rather than about work done: `[On site]`,
`[Working from home]`, `[Back home]`. They keep their place in the day's flow and are
excluded from time distribution.

### 3.1 Creating an entry

Entries are created by typing the raw syntax, exactly as in the spreadsheet:

```
[CATEGORY] project: free text.
```

The text is parsed **once**, at creation, and stored as fields. The raw string is not kept.

The API reads it, with the importer's grammar, so a line means what it meant in the
spreadsheet. See `parse` in `noted-api/app.py`.

### 3.2 Editing an entry

Editing opens the entry's text and note in place, as plain text — the fields are never
written back out as syntax. What is typed there is read as a new line would be, and laid
over the entry: anything the line names (a category, a project, a break) replaces what the
entry had, and anything it leaves out stays. So `[M] ` typed at the head of the text
changes the category, and a break's syntax turns the entry into a break. See `retype` in
`services/app-data.ts`. The category can also be picked from its tag.

This is the important half of the decision. Raw text is a fast path *into* the app, not the
storage format: nothing is ever serialised back into syntax, so there is no round-trip to
keep lossless.

### 3.3 Notes

The note is a second line, shown dimmed beneath the entry whenever it is non-empty — never
hidden behind an affordance. Many entries have one, and they carry most of the
day's texture, so they're worth the vertical space.

## 4. Projects

A project says what an entry was *for*, so work can be traced across weeks. Written as a
`path:` prefix after the category.

**Paths nest.** `refactor.A` is a subproject of `refactor`, to arbitrary depth.

**Declaration.** A project is introduced by putting `+` immediately before the segment
being created — `+webApp:` declares a new top-level project, `refactor.+A:` declares a
new subproject under an existing one. The `+` is not part of the name.

**Identity is the declaration, not the path.** Declaring `+webApp:` a second time begins
a second, unrelated project that merely shares a name. This is why entries reference a
surrogate id and never the string.

**An undeclared project is refused.** Writing `webApp:` when no such project has been
declared fails to save, with the fix offered inline: declare it. This is stricter than the
spreadsheet, which merely coloured the row red, and it's deliberate — `refactr:` and
`refactor:` silently becoming two projects is exactly the failure to prevent.

**Colour and description.** Each project carries both, stored. The colour is sampled once
at declaration and then kept, so the user can overrule it. Sample with constrained
lightness and chroma so every project reads against the dark surface and no two land too
close together; the spreadsheet hashed the three RGB channels independently and produced
near-blacks and muddy near-duplicates, which is the failure to avoid.

**The drawer.** A panel listing every project with its colour and description — the legend
the user consults to remember what a prefix meant, and where a colour can be changed.

## 5. Categories

A small curated vocabulary saying what *kind* of thing an entry is. Each carries a meaning
and a hand-picked colour. Unlike projects, the set is closed and the colours are chosen,
not sampled.

The vocabulary a new database starts with is seed data, in `noted-api/seed.py` — a starting
point, not a fixed list. **The settings screen is where categories are edited**: name,
meaning and colour, and adding or removing one. The meanings start empty because the
spreadsheet never recorded them; filling them in is the first thing that screen is for.

## 6. Time

### 6.1 The day

A day records **arrival** and **departure**, presented as the header and footer of the day
column rather than as entries.

**Breaks** are their own records. Each is either a start/end pair (the default) or a bare
duration, may carry a description, and one of them is flagged as the **noon break** —
that flag is what distinguishes lunch from an ad-hoc pause.

Arrival and departure can be marked as they happen, with buttons in the day column: see
`offersArrival` / `offersLeaving` in `components/day/day.ts`. Leaving sets the departure,
so a day that ends there needs nothing more; coming back turns the time away into a break
and puts the departure back to the default. A departure earlier than its arrival is the
next morning's. A day with one of the two and not the other is flagged in red, the departure only
once the day is no longer going on: see `missingArrival` / `missingDeparture`.

Breaks are created either by typing the bracket syntax inline, like an entry, or with an
*add break* button and its keyboard shortcut. However they're created, they render as
breaks — a divider in the day's flow — not as tasks.

A break **keeps its place among the entries**, because that is a fact about the day: lunch
came after the morning's work and before the afternoon's. So a day is one ordered list of
items, each either an entry or a break, and a position identifies a place in the day
rather than a place among things of one kind. See `DayIn` / `DayOut` in `schemas.py`.

### 6.2 Defaults

Default hours are **per weekday**, because Friday is short:

| Day     | Arrival | Break         | Departure | Expected    |
| ------- | ------- | ------------- | --------- | ----------- |
| Mon–Thu | 09:00   | 12:00 → 13:00 | 17:00     | 7h00        |
| Friday  | 09:00   | 12:00 → 13:00 | 16:00     | 6h00        |
| Sat/Sun | —       | —             | —         | non-working |

The settings screen shows a row per weekday plus a control to copy one day's values across
the whole week. It also holds the category list (§5) and the overtime baseline (§6.3) —
everything seeded rather than authored.

Defaults are **snapshot onto each day as it is created**, never read live, and the expected
duration is stored per day. Changing a setting must not rewrite days already recorded.

### 6.3 Computing worked time

```
worked = (departure − arrival) − Σ breaks
delta  = worked − expected
```

A day's delta is always this computation — there is no way to file one by hand. To
correct a day, correct its arrival, departure or breaks.

Deltas are shown per day, per week, and as a running total. The running total counts from
a resettable baseline — a figure accumulated over years is only useful if one bad day
can be corrected out of it. Stored as `OvertimeBaseline`, behind `GET`/`PUT /overtime`.

### 6.4 How long an entry took

The day's total is always known, explicitly or by default. So entry durations are not
stored and not guessed individually — they're **solved for on read**, against that total.

An entry may specify its timing in several ways, all optional:

| The entry says      | Written            | Effect                                  |
| ------------------- | ------------------ | --------------------------------------- |
| how long it took    | `[1h30]`           | fixed duration                          |
| when it finished    | `[-> 17:30]`       | anchors its end on the timeline         |
| when it ran         | `[9:00 -> 11:00]`  | fixed, both ends anchored               |
| that it took a while| `[Several hours]`  | a weight, not a value                   |
| nothing             |                    | a weight of 1                           |

The resolution, in order:

1. Remove meta entries and breaks; they aren't work.
2. Fix every entry that states a duration or a full range.
3. Anchor every entry that states an end time: it runs from the previous entry's end to
   that anchor.
4. Subtract all fixed durations from the day's worked time to get the remainder.
5. Divide the remainder among the entries that stated nothing, in proportion to their
   weight — an unmarked entry weighs 1, `[hours]` weighs several, `[several hours]` more.

The exact weights are a tuning detail, not a contract. What matters is that the durations
always sum to the day's actual worked time: nothing is invented and nothing is lost.

If the fixed durations already exceed the day's worked time, that's a contradiction in the
data and should be surfaced rather than silently absorbed.

## 7. Days

A day has a **status** — working, or one of the non-working kinds the spreadsheet recorded
as a first entry: paid holiday, holiday, unpaid, sick, off. Non-working days expect zero.

**A past day with no entries is an error and is flagged.** It should not be possible to
have simply forgotten: at minimum a day carries a meta entry saying what happened. Empty
past days are excluded from totals rather than counted as a full deficit — forgetting to
write a day down must not look like owing a full day.

## 8. The week view

Five day columns. **Saturday and Sunday appear only when they have content**, with a
button and shortcut to enable the weekend for a given week.

### Visual states

The colour rules are the whole visual language, in priority order:

1. **Failed** — the day is past, the entry is not done, and it has text. Red.
2. **Time** — arrival, breaks, departure. Magenta.
3. **Task** — the category colours one part of the row, the project another.

The chrome colours — surfaces, and the failed and time states — are CSS custom properties
in the frontend's `styles.css`. Category and project colours are not: they are the user's
data, stored and editable, and a new database starts with the ones in `noted-api/seed.py`.

## 9. Importing the history

The historical weeks are imported **early**, right after the backend exists, so the UI
is designed against real entries rather than a handful of invented ones.
`noted-api/importer.py` does the reading; what it does not yet do is hours.

The import is **iterative and re-runnable**. Getting the legacy parsing right will take
several passes, so it must be safe to wipe and re-import rather than being a one-way door.

Hours are recomputed rather than trusted. Where a recomputed total disagrees with the
hand-written one, the import **stops and asks**: it shows that day's entries and markers in
readable form alongside both figures, and the user chooses. Disagreements are signal — they
mean either a slip in the original or a gap in the parser, and the second is worth fixing
before importing again.
