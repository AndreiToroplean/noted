# Noted

A personal work journal. One user (the repo owner), running it locally.

It replaces a Google Sheets file the owner kept for ~1.5 years: one sheet per week, one
column per day, and under each day a flat list of things accomplished that day. The app's
first goal is to do what that spreadsheet did, with a better UI — **not** to reimplement a
spreadsheet.

## Repo layout

A single git repository at the root, containing two projects:

| Path             | What                      |
| ---------------- | ------------------------- |
| `noted-api/`     | Python / FastAPI backend  |
| `noted-frontend/`| Angular frontend          |

Each has its own `CLAUDE.md` with project-specific conventions. `noted.code-workspace`
opens both as a multi-root VS Code workspace.

## Documentation

| Document | What it's for |
| -------- | ------------- |
| [docs/specification.md](docs/specification.md) | How Noted should work. Read it before building anything. |
| [docs/legacy-journal-format.md](docs/legacy-journal-format.md) | The spreadsheet being replaced. Read it before touching the importer. |

The specification is a working document: as a decision gets expressed in code, its section
there shrinks to a pointer at the code. Keep it that way rather than letting it drift into
a second, stale copy of the implementation.

## Domain model

Enough to read the code; the specification has the rest.

**Week** — a date range identified by its Monday. Not a stored object; days and entries are
stored, and a week is a query over them.

**Day** — a date, a status, an ordered list of entries, and the day's hours: arrival,
departure, and breaks. A day is "past" if its date is before today, which is what decides
whether its unfinished entries count as failed.

**Entry** — an ordered item under a day, created by typing

```
[CATEGORY] project: free text.
optional second line, kept as a note
```

The text is parsed **once**, at creation, and stored as fields — the raw string is never
kept. Editing shows the fields as plain text, never as syntax; syntax typed while editing
is read like a new line and overrides only the fields it names.

An entry is either a **task** or a **meta** entry: a bracketed annotation about the day
rather than about work done, like `[On site]`. Meta entries are excluded from time
calculations.

### Two tag systems

These are different things and must not be collapsed into one.

**Category** — `[T]`, `[M]`, … — what *kind* of thing the entry is. A small closed
vocabulary, each tag with a meaning and a hand-picked colour.

**Project** — `webApp:`, `refactor.A:` — what the entry was *for*. Open-ended, nesting as
a dot-separated path, declared with a `+` before the new segment (`+webApp:`,
`refactor.+A:`). A project's identity is its declaration rather than its path, so two
projects may share a name and entries must reference a surrogate id. Colours are sampled
once and stored, not derived from the name.

### Time

A day's hours are first-class fields, not text. Entry durations are the opposite: never
stored, always solved for on read against the day's known total, so the parts always sum to
the whole. See the specification before touching either.

## Conventions

**Commits** — Conventional Commits, with a capitalised subject and no trailing period.
Scope is the project where it applies:

```
feat(frontend): Add entry editor
fix(api): Reject weeks that are not a Monday
chore: Remove stray file from repo root
```

Use `feat`, `fix`, `refactor`, `chore`, `build`, `docs`, `test`. Omit the scope for
repo-wide changes. End the message body with:

```
- With help from Claude.
```

Commit in small, reviewable steps rather than one large change at the end.

**Branch** — work lands on `master`. The remote is `upstream`.

## Historical data

The owner's original spreadsheet is *not* in this repo and must not be committed to it —
it's personal data and it's large. A working copy lives outside the repo; ask for the path
if you need it. It is imported by a re-runnable script, not a one-way migration.

The owner also has a separate, older project that already parses those sheets; its
`parse_work_hours.py` is normative for anything time-related.
