"""Render an SVG into a multi-size .ico with headless Edge and the standard library.

    python svg_to_ico.py <input.svg> <output.ico> [--keep <dir>]

Each size is rendered as a PNG by Edge and the PNGs are packed into the .ico as
they are, which Windows has read since Vista. `--keep` leaves the PNGs in <dir>
so they can be looked at.
"""

import argparse
import shutil
import struct
import subprocess
import tempfile
import time
from pathlib import Path

SIZES = [16, 24, 32, 48, 64, 256]
EDGE = [
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
]


def edge() -> Path:
    for path in EDGE:
        if path.exists():
            return path
    raise SystemExit("Microsoft Edge was not found.")


def render(browser: Path, svg: Path, size: int, work: Path) -> bytes:
    # Sized in pixels, not viewport units: Edge's viewport does not always
    # match the window, and a 100vw image came out shifted at 256.
    page = work / f"{size}.html"
    page.write_text(
        "<style>html,body{margin:0;background:transparent;overflow:hidden}"
        f"img{{display:block;width:{size}px;height:{size}px}}</style>"
        f'<img src="{svg.as_uri()}">'
    )
    png = work / f"{size}.png"
    # Runs fail now and then without saying why; a fresh profile per attempt
    # keeps a lingering Edge process from holding the last one's lock.
    for attempt in range(3):
        subprocess.run(
            [
                str(browser),
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--default-background-color=00000000",
                f"--user-data-dir={work / f'profile-{size}-{attempt}'}",
                f"--window-size={size},{size}",
                f"--screenshot={png}",
                page.as_uri(),
            ],
            capture_output=True,
            timeout=60,
        )
        if png.exists():
            data = png.read_bytes()
            if struct.unpack(">II", data[16:24]) == (size, size):
                return data
            png.unlink()
        time.sleep(2)
    raise SystemExit(f"Edge did not render the {size}px image.")


def pack(images: dict[int, bytes]) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    offset = len(header) + 16 * len(images)
    for size, data in images.items():
        # A dimension of 256 is written as 0.
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return header + entries + b"".join(images.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("svg", type=Path)
    parser.add_argument("ico", type=Path)
    parser.add_argument("--keep", type=Path, help="leave the rendered PNGs here")
    args = parser.parse_args()

    browser = edge()
    work = Path(tempfile.mkdtemp(prefix="svg-to-ico-"))
    try:
        images = {size: render(browser, args.svg.resolve(), size, work) for size in SIZES}
        args.ico.write_bytes(pack(images))
        if args.keep:
            args.keep.mkdir(parents=True, exist_ok=True)
            for size in SIZES:
                shutil.copy(work / f"{size}.png", args.keep / f"{size}.png")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"Wrote {args.ico} ({', '.join(map(str, SIZES))} px)")


if __name__ == "__main__":
    main()
