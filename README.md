# Noted (simple journal API)

Quick setup and run instructions ✅

1. Create a virtual environment and activate it:
   - Windows (PowerShell): `python -m venv .venv; .\.venv\Scripts\Activate.ps1`

2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Run the app (development, auto-reload):
   - PowerShell: `python -m uvicorn app:app --reload`
   - Or use the shipped `run.ps1` script: `./run.ps1`

4. Example requests:
   - GET an empty week:
     ```
     curl http://127.0.0.1:8000/journal/2026-02-09
     ```
   - POST (save) a week (store a full JSON object):
     ```
     curl -X POST http://127.0.0.1:8000/journal/2026-02-09 -H "Content-Type: application/json" -d "{\"note\": \"My note\"}"
     ```

Notes:
- This project uses Pydantic models to validate payloads and provides a simple file-backed store in `data/`.
- Add tests or CORS configuration as needed for your use case.
