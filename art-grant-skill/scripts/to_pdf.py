"""Convert a .docx to .pdf using LibreOffice headless.

LibreOffice is the default because it works cross-platform without requiring
MS Word. Install on Mac with:

    brew install --cask libreoffice

Usage:

    python3 art-grant-skill/scripts/to_pdf.py path/to/file.docx
    python3 art-grant-skill/scripts/to_pdf.py path/to/file.docx --outdir path/to/output

If no --outdir is given, the PDF is written next to the .docx.

Alternative backends (not used by default):

- docx2pdf (pip install docx2pdf):
      On Mac it shells out to Microsoft Word. Requires Word installed.
      On Linux it uses LibreOffice under the hood.
      On Windows it uses Word via COM.
      Use if you prefer a one-line Python call AND have Word/LibreOffice.
- pandoc: can write PDF via LaTeX, but layout differs from Word's renderer
  and the LaTeX toolchain is heavy. Not recommended for grant apps that
  were designed to look like a Word doc.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


LIBREOFFICE_CANDIDATES = [
    "soffice",  # on PATH if user did brew install --cask libreoffice + added to PATH
    "libreoffice",  # linux convention
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",  # Mac default install
    "/usr/bin/libreoffice",
    "/usr/local/bin/soffice",
]


def find_libreoffice() -> str | None:
    """Return the first resolvable LibreOffice executable, or None."""
    for candidate in LIBREOFFICE_CANDIDATES:
        if shutil.which(candidate):
            return candidate
        if Path(candidate).is_file():
            return candidate
    return None


def docx_to_pdf(docx_path: Path, outdir: Path | None = None) -> Path:
    """Convert a .docx to .pdf. Returns the output PDF path."""
    docx_path = docx_path.resolve()
    if not docx_path.is_file():
        raise FileNotFoundError(f"Input file not found: {docx_path}")
    if docx_path.suffix.lower() != ".docx":
        raise ValueError(f"Expected a .docx file, got: {docx_path}")

    if outdir is None:
        outdir = docx_path.parent
    outdir = outdir.resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    soffice = find_libreoffice()
    if soffice is None:
        raise RuntimeError(
            "LibreOffice not found. Install with:\n"
            "    brew install --cask libreoffice   (Mac)\n"
            "    apt install libreoffice           (Debian/Ubuntu)\n"
            "\n"
            "Or see to_pdf.py for alternative backends (docx2pdf, pandoc)."
        )

    # `soffice --headless --convert-to pdf` writes to outdir with same basename.
    result = subprocess.run(
        [
            soffice,
            "--headless",
            "--convert-to", "pdf",
            "--outdir", str(outdir),
            str(docx_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"LibreOffice conversion failed (exit {result.returncode}):\n"
            f"stdout: {result.stdout}\n"
            f"stderr: {result.stderr}"
        )

    output_pdf = outdir / (docx_path.stem + ".pdf")
    if not output_pdf.is_file():
        raise RuntimeError(
            f"LibreOffice reported success but no PDF at expected path:\n"
            f"    {output_pdf}\n"
            f"stdout: {result.stdout}"
        )
    return output_pdf


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert a .docx to .pdf using LibreOffice headless."
    )
    parser.add_argument("docx", type=Path, help="Input .docx file")
    parser.add_argument(
        "--outdir",
        type=Path,
        default=None,
        help="Output directory (default: same as input)",
    )
    args = parser.parse_args()

    try:
        pdf_path = docx_to_pdf(args.docx, args.outdir)
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"Wrote {pdf_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
