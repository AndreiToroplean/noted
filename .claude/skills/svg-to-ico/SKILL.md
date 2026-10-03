---
name: svg-to-ico
description: Convert an SVG into a multi-size Windows .ico (16–256 px) using headless Edge and the Python standard library, with no image tools installed. Use when an .ico is needed from an SVG — such as regenerating noted-api/noted.ico, the exe's icon, after noted-frontend/public/favicon.svg changes.
---

# SVG to ICO

```bash
python .claude/skills/svg-to-ico/svg_to_ico.py <input.svg> <output.ico> --keep <scratch dir>
```

The script renders each size with headless Edge and packs the PNGs into the .ico
unconverted. It needs only Edge and Python, so nothing gets installed.

## Steps

1. Run the script with `--keep` pointing at the scratchpad, not the repo.
2. **Look at the PNGs** with the Read tool, at least `256.png` and `16.png`. A render
   can succeed and still be wrong (shifted, cropped, or with an opaque background instead
   of transparent corners), and only looking will show it.
3. To check an icon inside a built exe, extract it and look at that too:

   ```bash
   powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; [System.Drawing.Icon]::ExtractAssociatedIcon('<exe>').ToBitmap().Save('<png>')"
   ```

## In this repo

`noted-api/noted.ico` is generated from `noted-frontend/public/favicon.svg` and committed;
`build.ps1` passes it to PyInstaller. Regenerate it whenever the favicon changes, then
rerun `build.ps1`.
