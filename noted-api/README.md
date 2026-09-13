# Noted — API

FastAPI over a local SQLite file. See `CLAUDE.md` for conventions and the repo's
`docs/specification.md` for what the model means.

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

Serves on `http://127.0.0.1:8000`; interactive docs at `/docs`. The database is created at
`data/noted.db` on first run, seeded with the default per-weekday hours.

## Endpoints

| Method  | Path                  | What                                              |
| ------- | --------------------- | ------------------------------------------------- |
| `GET`   | `/journal/{monday}`   | The week's seven days, entries and breaks          |
| `PUT`   | `/journal/{monday}`   | Replace that whole week                            |
| `GET`   | `/projects`           | Every declared project                             |
| `POST`  | `/projects`           | Declare one                                        |
| `PATCH` | `/projects/{id}`      | Change its colour or description                   |
| `GET`   | `/categories`         | The category vocabulary                            |
| `PUT`   | `/categories/{name}`  | Add or edit one                                    |
| `GET`   | `/settings`           | Default hours, one row per weekday                 |
| `PUT`   | `/settings/{weekday}` | Edit one weekday (0 = Monday)                      |

A week is addressed by the date of its Monday; any other date is a 400. There are no
per-entry endpoints on purpose — the client sends the week back whole.

## Tests

```powershell
python -m pytest
```
