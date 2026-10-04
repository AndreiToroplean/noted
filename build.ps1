Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Builds dist/Noted.exe: the API, the built frontend and Python, in one file.
# The database is created beside the exe on first run.

Set-Location $PSScriptRoot

Push-Location noted-frontend
npm install
if ($LASTEXITCODE) { throw 'Installing the frontend packages failed.' }
npm run build
if ($LASTEXITCODE) { throw 'Frontend build failed.' }
Pop-Location

. noted-api/venv.ps1

$frontend = Resolve-Path noted-frontend/dist/noted-frontend/browser
pyinstaller noted-api/noted.py `
  --name Noted `
  --onefile `
  --noconfirm `
  --paths noted-api `
  --icon "$(Resolve-Path noted-api/noted.ico)" `
  --add-data "${frontend};frontend" `
  --add-data "$(Resolve-Path noted-api/seed.toml);." `
  --distpath dist `
  --workpath build `
  --specpath build
if ($LASTEXITCODE) { throw 'Packaging failed.' }
