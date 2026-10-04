# Noted

A simple way to record your workday.

Write down what you do as you do it, and over the weeks Noted turns it into a record of your working life: what you worked on, and where the hours went. Everything stays on your machine.

It's one take on how a workday is worth keeping. Try it, and see if it fits yours.

## Running it

You need Windows, Python and Node.js.

**To use it**, build the portable app, then run `dist\Noted.exe`. It opens in your browser and keeps its journal in `noted.db`, beside the exe.

```powershell
./build.ps1
```

**To work on it**, run the API and the frontend side by side, then open `http://localhost:4200`:

```powershell
./noted-api/run.ps1                              # API on port 8000
cd noted-frontend; npm install; npm start        # in a second terminal
```
