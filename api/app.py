from fastapi import FastAPI, HTTPException
from datetime import date
from pathlib import Path
import json

app = FastAPI()

DATA_DIR = Path("data")
DATA_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/journal/{week}")
def load_week(week: str):
    validate_week(week)

    path = DATA_DIR / f"{week}.json"

    if not path.exists():
        # Return an empty JSON object when there is no data for the week
        return {}

    return json.loads(path.read_text(encoding="utf-8"))


@app.post("/journal/{week}")
def save_week(week: str, payload: dict):
    validate_week(week)

    # Expect a top-level JSON object (mapping) for each week
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object.")

    path = DATA_DIR / f"{week}.json"

    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    return {"ok": True}


def validate_week(week: str) -> bool:
    try:
        d = date.fromisoformat(week)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid week format. Use YYYY-MM-DD."
        )

    # Ensure the provided date is a Monday (weekday() == 0)
    if d.weekday() != 0:
        raise HTTPException(
            status_code=400, detail="Week must be a Monday (YYYY-MM-DD)."
        )

    return True


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
