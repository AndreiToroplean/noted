# Activates the API's Python environment, creating it first if it is missing, and brings it up
# to date with requirements.txt — which costs under a second when nothing has changed.
# Dot-source it, so the activation outlives the script: `. noted-api/venv.ps1`.

$venv = Join-Path $PSScriptRoot .venv

if (-not (Test-Path $venv)) {
  Write-Host 'Creating the Python environment...'
  python -m venv $venv
  if ($LASTEXITCODE) { throw 'Could not create the Python environment.' }
}

& (Join-Path $venv Scripts/python) -m pip install --quiet -r (Join-Path $PSScriptRoot requirements.txt)
if ($LASTEXITCODE) { throw 'Could not install the Python requirements.' }

. (Join-Path $venv Scripts/Activate.ps1)
