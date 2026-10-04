# Noted — API

Python / FastAPI backend. See the root `CLAUDE.md` for the domain model.

## Commands

```powershell
./run.ps1              # creates .venv if missing, installs deps, runs uvicorn --reload
python -m pytest       # tests
python -m pyright      # types, configured by pyrightconfig.json
```

Keep `python -m pyright` clean. It is the same check the editor runs, so an error left in place is one the owner sees every time the file is open.

Serves on `http://127.0.0.1:8000`; interactive docs at `/docs`.

## Scope

This backend serves exactly one local user. That is a design constraint, not a temporary state: there is no auth, no multi-tenancy, no horizontal scaling to plan for. Prefer the simplest thing that is correct and durable over anything built for scale that will never arrive.

## Conventions

**Validate at the edge.** Weeks are identified by the date of their Monday, as `YYYY-MM-DD`, and a request naming any other day is a 400 — the invariant is enforced in the route, so nothing downstream has to wonder. Keep that pattern: reject bad input where it enters.

**Layout.** `models.py` is the stored schema (SQLModel tables), `schemas.py` is what crosses the wire, `db.py` owns the engine, `seed.toml` holds the content a new database starts with and `seed.py` reads it, `importer.py` reads the old spreadsheet, `app.py` the routes. The two model layers are deliberately separate: a week is written back whole, so entries arrive without ids — their order in the list *is* their position — and come back with ids on read.

**The database** is one SQLite file at `data/noted.db` (beside the exe once packaged), gitignored, and never committed. What *is* committed is `seed.toml`: the default hours and the category vocabulary a new database starts from. `seed.py` reads it on first open and by hand via `python seed.py`, and only ever fills in what is missing, so it never overwrites an edit. Anything a user is expected to change belongs there rather than in the code that reads it. A gitignored `seed-local.toml` beside the database is read *instead* of it, whole — a replacement, not a list of exceptions.

**The importer** is re-runnable: `--reset` wipes what it wrote and starts again, because getting the legacy parsing right takes several passes. Judgement calls — two spellings of one project, a path that was new without saying so — go in `importer-rules.toml`; answers given interactively are remembered in `importer-decisions.toml`. Both are gitignored: they belong to one journal, not to the app.

The importer asks rather than guesses, but only when a person is there: `Resolver(ask=None)` is the non-interactive mode and must never invent an answer — it leaves the spreadsheet's own reading standing and counts what it skipped.

There are no migrations yet; while the schema is still moving, delete the database file and let it rebuild.

**Tests** live in `tests/`, use `TestClient`, and point `db.DATABASE_PATH` at a `tmp_path` fixture so they never touch real data. Tests come before the code they describe. Any new endpoint gets a test covering its success case and its validation failures.

Test the behaviour, not the seed data: its values are the user's to change. Assert that seeding fills gaps, is idempotent, and leaves edits alone, and compare a day's hours against `seed.load()` or what `/settings` reports rather than against a literal. An autouse fixture in `conftest.py` keeps any `seed-local.toml` out of the tests.
