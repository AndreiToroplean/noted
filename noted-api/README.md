# Noted — API

FastAPI over a local SQLite file. See `CLAUDE.md` for conventions and the repo's `docs/specification.md` for what the model means.

## Run

```powershell
./run.ps1   # creates .venv if missing, installs deps, runs uvicorn --reload
```

Or by hand:

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app:app --reload
```

Serves on `http://127.0.0.1:8000`; interactive docs at `/docs`. The database is created at `data/noted.db` on first run, seeded from `seed.toml` with default hours per weekday and the category vocabulary. `python seed.py` builds or tops up that database without touching anything already in it.

To start from your own hours or categories, copy `seed.toml` to `seed-local.toml` and edit it. When that file is there it is read instead, whole, including by a `--reset` import.

## Endpoints

| Method  | Path                  | What                                              |
| ------- | --------------------- | ------------------------------------------------- |
| `GET`   | `/weeks`              | The Mondays that have anything stored, newest first |
| `GET`   | `/journal/{monday}`   | The week's seven days, entries and breaks          |
| `PUT`   | `/journal/{monday}`   | Replace that whole week                            |
| `GET`   | `/projects`           | Every declared project                             |
| `POST`  | `/projects`           | Declare one                                        |
| `PATCH` | `/projects/{id}`      | Change its colour or description                   |
| `GET`   | `/categories`         | The category vocabulary                            |
| `PUT`   | `/categories/{name}`  | Add or edit one                                    |
| `GET`   | `/settings`           | Default hours, one row per weekday                 |
| `PUT`   | `/settings/{weekday}` | Edit one weekday (0 = Monday)                      |
| `GET`   | `/overtime`           | Where the running overtime total counts from       |
| `PUT`   | `/overtime`           | Reset it                                           |

A week is addressed by the date of its Monday; any other date is a 400. There are no per-entry endpoints on purpose — the client sends the week back whole.

## Importing the old spreadsheet

```powershell
python importer.py "C:\path\to\Journal.ods" --reset
```

`--reset` wipes what a previous import wrote, so it is safe to run again after correcting the parsing.

Run from a terminal it asks about what it cannot decide: whether a project used without a `+` is a new one or a misspelling of an existing one. Answers are remembered in `importer-decisions.toml` and not asked twice; delete that file to be asked again. `--batch` never asks. Standing judgement calls can also be written by hand in `importer-rules.toml`. Both files are gitignored.

Days whose hours need a look — lunch written twice or not at all, or hours that disagree with the hand-written total — are listed in `data/import-report.txt`.

## Tests

```powershell
python -m pytest
```
