Set-StrictMode -Version Latest

# Ensure the script runs from the api directory so the `app` module can be imported
Set-Location $PSScriptRoot

python -m uvicorn app:app --reload
