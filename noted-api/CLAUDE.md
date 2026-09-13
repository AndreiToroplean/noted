# Noted — API

Python / FastAPI backend. See the root `CLAUDE.md` for the domain model.

## Commands

```powershell
./run.ps1              # creates .venv if missing, installs deps, runs uvicorn --reload
python -m pytest       # tests
```

Serves on `http://127.0.0.1:8000`; interactive docs at `/docs`.

## Scope

This backend serves exactly one local user. That is a design constraint, not a temporary
state: there is no auth, no multi-tenancy, no horizontal scaling to plan for. Prefer the
simplest thing that is correct and durable over anything built for scale that will never
arrive.

## Conventions

**Validate at the edge.** Weeks are identified by the date of their Monday, as
`YYYY-MM-DD`, and a request naming any other day is a 400 — the invariant is enforced in
the route, so nothing downstream has to wonder. Keep that pattern: reject bad input where
it enters.

**Pydantic models for payloads**, not bare `dict`. The API should know the shape of a
journal week rather than passing an opaque blob through to storage.

**Tests** live in `tests/`, use `TestClient`, and point storage at a `tmp_path` fixture so
they never touch real data. Any new endpoint gets a test covering its success case and its
validation failures.

**Runtime data is not committed** — `data/` is gitignored, as are `.venv/` and caches.
