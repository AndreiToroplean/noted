Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Serves the API for development, reloading on change. The `app` module is imported from here.
Set-Location $PSScriptRoot

. ./venv.ps1
python -m uvicorn app:app --reload
