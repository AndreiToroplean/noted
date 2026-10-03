"""Noted as one program: the API and the built frontend on one local address.

This is what the packaged exe runs; `build.ps1` at the repo root makes it. In
development the two still run apart, uvicorn here and `ng serve` in the frontend.
"""

import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

import app as api

PORT = 8040


def create(frontend: Path) -> FastAPI:
    # The API's own docs come along with its routes.
    root = FastAPI(title="Noted", docs_url=None, redoc_url=None, openapi_url=None)
    root.include_router(api.app.router)
    # Mounted last, so it only answers what no API route claimed. The frontend
    # has no routes of its own, so it needs no fallback to index.html.
    root.mount("/", StaticFiles(directory=frontend, html=True))
    return root


def frontend_dir() -> Path:
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        return Path(bundle) / "frontend"
    return Path(__file__).parent.parent / "noted-frontend" / "dist" / "noted-frontend" / "browser"


def main():
    url = f"http://127.0.0.1:{PORT}"
    threading.Timer(1, webbrowser.open, [url]).start()
    uvicorn.run(create(frontend_dir()), host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()
