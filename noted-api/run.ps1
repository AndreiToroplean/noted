Set-StrictMode -Version Latest

# Ensure the script runs from the api directory so the `app` module can be imported
Set-Location $PSScriptRoot

if (-not (Test-Path -Path .venv)) {
  Write-Host "Creating virtual environment..."
  python -m virtualenv .venv
  . .venv/Scripts/Activate.ps1
  pip install -r requirements.txt
} else {
  . .venv/Scripts/Activate.ps1
}

python -m uvicorn app:app --reload
