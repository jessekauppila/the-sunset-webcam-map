# Pi-Side Alignment Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-agnostic Pi-side alignment-tool logic — a render function for the HTML alignment page and a generator function for the MJPEG preview stream — with full unit-test coverage in the firmware repo, ready to be wired into spec E's setup web app whenever that lands.

**Architecture:** A single new module `setup_alignment.py` in the firmware repo exports two pure functions: `render_align_page() -> str` returns the static HTML+SVG for the alignment page, and `stream_mjpeg(frame_source, fps=4) -> Iterator[bytes]` produces multipart MJPEG bytes by polling a frame-source callable. Both are framework-agnostic — no Flask, no aiohttp, no FastAPI dependency. The eventual web-app integration (one task in spec E's firmware plan, not here) registers them as route handlers.

**Tech Stack:** Python 3.11+ in `sunset-cam-firmware` repo. pytest for tests (already configured in `pyproject.toml`). Standard library only — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md` (in the web-app repo at `the-sunset-webcam-map`).

**Working repo for this plan:** `/Users/jessekauppila/GitHub/sunset-cam-firmware`. All paths in this plan are relative to that root unless otherwise noted.

---

## Dependency note

This plan produces **functions** that the spec E firmware implementation will eventually call. Without spec E's setup web app, the functions land but aren't routed to URLs yet — that's deliberate. The functions are individually unit-testable; field verification (real Pi serving the page on real hardware) waits for spec E's web app to be built.

A separate hardware ticket tracks the molded ↑ UP arrow on the housing STL — also out of scope for this plan.

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/sunset_cam/setup_alignment.py` | `render_align_page()`, `stream_mjpeg(frame_source, fps=4)` |
| Create | `tests/test_setup_alignment.py` | Unit tests for both functions |

The module is small (target ~80 lines incl. the HTML template). Single responsibility: produce the alignment page content + stream bytes. No I/O, no framework binding, no global state.

---

## Task 1: Create `setup_alignment.py` skeleton + `render_align_page()`

**Files:**
- Create: `src/sunset_cam/setup_alignment.py`
- Create: `tests/test_setup_alignment.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_setup_alignment.py` with the following content:

```python
"""Tests for the Pi-side alignment tool's render + stream functions."""
from __future__ import annotations

from sunset_cam.setup_alignment import render_align_page


def test_render_align_page_returns_string():
    html = render_align_page()
    assert isinstance(html, str)
    assert html.startswith("<!doctype html>")


def test_render_align_page_includes_preview_image_pointing_at_mjpeg_route():
    html = render_align_page()
    # The page contains an <img> whose src is the MJPEG stream route.
    # The exact route path is part of the contract — downstream code
    # in spec E's web app must register the stream at this URL.
    assert 'src="/setup/preview.mjpg"' in html


def test_render_align_page_has_horizon_line_overlay():
    html = render_align_page()
    # A horizontal dashed line at the vertical center of the SVG overlay
    # (viewBox is 1600x900, so y=450 is center).
    assert '<line' in html
    assert 'y1="450"' in html
    assert 'y2="450"' in html
    assert 'stroke-dasharray' in html


def test_render_align_page_has_up_arrow_label():
    html = render_align_page()
    # Top-center label showing which way is up
    assert "UP" in html
    # The arrow character or an HTML-entity equivalent
    assert ("↑" in html) or ("&uarr;" in html)


def test_render_align_page_has_instructions():
    html = render_align_page()
    # Operator guidance text — at minimum mentions "horizon" and "mount"
    assert "horizon" in html.lower()
    assert "mount" in html.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'sunset_cam.setup_alignment'`

- [ ] **Step 3: Create the module + implement `render_align_page()`**

Create `src/sunset_cam/setup_alignment.py` with the following content:

```python
"""Pi-side alignment tool: framework-agnostic helpers.

Two public functions:
- ``render_align_page()`` returns the static HTML for the alignment page
  served at ``/setup/align``.
- ``stream_mjpeg(frame_source, fps)`` returns a generator producing
  multipart MJPEG bytes for ``/setup/preview.mjpg``.

Both are pure: no framework binding, no global state, no I/O beyond what
the caller provides via ``frame_source``. The eventual web-app integration
(in spec E's setup web app) registers these as route handlers.

Spec: docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md
(in the the-sunset-webcam-map repo).
"""
from __future__ import annotations

from typing import Callable, Iterator


_ALIGN_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Align your camera</title>
  <style>
    body { background: #000; color: #fff; font: 14px system-ui, sans-serif; margin: 0; padding: 0; }
    .preview-wrap { position: relative; width: 100%; max-width: 100vw; aspect-ratio: 16/9; margin: 0 auto; }
    .preview-wrap img { width: 100%; display: block; }
    .overlay { position: absolute; inset: 0; pointer-events: none; }
    .instructions { padding: 16px 20px; line-height: 1.55; max-width: 560px; margin: 0 auto; }
    .instructions ol { padding-left: 1.2em; }
  </style>
</head>
<body>
  <div class="preview-wrap">
    <img src="/setup/preview.mjpg" alt="camera preview" />
    <svg class="overlay" viewBox="0 0 1600 900" preserveAspectRatio="none">
      <line x1="0" y1="450" x2="1600" y2="450"
            stroke="#ffcc66" stroke-width="2" stroke-dasharray="12 6" opacity="0.85" />
      <text x="800" y="60" fill="#ffcc66" font-size="36" text-anchor="middle"
            font-family="system-ui, sans-serif">&uarr; UP</text>
    </svg>
  </div>
  <div class="instructions">
    <p>Rotate the camera housing until:</p>
    <ol>
      <li>The real horizon lines up with the dashed line.</li>
      <li>The &uarr; on screen points the same direction as the &uarr; molded on the housing.</li>
    </ol>
    <p>When both match, mount the camera in place. Then close this tab and return to setup.</p>
  </div>
</body>
</html>
"""


def render_align_page() -> str:
    """Return the static HTML for the alignment page.

    Pure function — no I/O, no parameters. Callers (the web app) wrap the
    return value in their framework's response object.
    """
    return _ALIGN_HTML


def stream_mjpeg(
    frame_source: Callable[[], bytes],
    fps: int = 4,
) -> Iterator[bytes]:
    """Generator producing multipart MJPEG bytes.

    Stub for Task 2 — placeholder body raises NotImplementedError so the
    Task 1 import test passes without prematurely defining the contract.
    """
    raise NotImplementedError("stream_mjpeg lands in Task 2")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/setup_alignment.py tests/test_setup_alignment.py
git commit -m "feat(setup-align): render_align_page() with overlay + instructions"
```

---

## Task 2: Implement `stream_mjpeg()` generator

**Files:**
- Modify: `src/sunset_cam/setup_alignment.py` (replace the stub body)
- Modify: `tests/test_setup_alignment.py` (add streaming tests)

The function produces a properly-formatted multipart/x-mixed-replace MJPEG stream by repeatedly calling a `frame_source` callable and yielding correctly-encoded bytes. Time pacing between frames is the caller's responsibility — Task 2 keeps the generator purely synchronous so unit tests can advance frames deterministically. Real-world rate limiting (sleep between frames) lands in a Task 3 helper or in the eventual web-app integration.

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_setup_alignment.py`:

```python
from sunset_cam.setup_alignment import stream_mjpeg, MJPEG_BOUNDARY


def test_mjpeg_boundary_is_exported_and_nontrivial():
    # The boundary string used in the multipart payload must also be the
    # one the web app advertises in its Content-Type header. Exporting it
    # so the web app can read the same value avoids drift.
    assert isinstance(MJPEG_BOUNDARY, str)
    assert len(MJPEG_BOUNDARY) >= 8


def test_stream_mjpeg_yields_three_frames_from_a_three_call_source():
    frames = [b"AAA", b"BBB", b"CCC"]
    call_index = {"i": 0}

    def source() -> bytes:
        i = call_index["i"]
        call_index["i"] += 1
        if i >= len(frames):
            raise StopIteration  # signals end of stream
        return frames[i]

    out = b"".join(stream_mjpeg(source))
    # Each frame is wrapped in a multipart part with the boundary
    assert out.count(f"--{MJPEG_BOUNDARY}".encode()) == 3
    # Each part declares Content-Type: image/jpeg
    assert out.count(b"Content-Type: image/jpeg") == 3
    # Each part contains the frame body bytes
    for frame in frames:
        assert frame in out


def test_stream_mjpeg_includes_content_length_per_part():
    def source() -> bytes:
        source.call_count = getattr(source, "call_count", 0) + 1
        if source.call_count > 1:
            raise StopIteration
        return b"X" * 17

    out = b"".join(stream_mjpeg(source))
    # The part announces its body length so clients can frame correctly
    assert b"Content-Length: 17" in out


def test_stream_mjpeg_terminates_on_source_stopiteration():
    def source() -> bytes:
        raise StopIteration

    # No frames produced — generator should complete cleanly without yielding
    chunks = list(stream_mjpeg(source))
    assert chunks == []


def test_stream_mjpeg_swallows_source_exception_and_stops():
    # A frame source that raises something other than StopIteration
    # (e.g., a transient camera error) should NOT crash the stream;
    # it should terminate cleanly as if EOF was reached.
    def source() -> bytes:
        raise RuntimeError("camera glitch")

    chunks = list(stream_mjpeg(source))
    assert chunks == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v`
Expected: the four new tests FAIL (the first because `MJPEG_BOUNDARY` doesn't exist, the others because `stream_mjpeg` raises `NotImplementedError`).

- [ ] **Step 3: Implement `stream_mjpeg()` + add `MJPEG_BOUNDARY` constant**

In `src/sunset_cam/setup_alignment.py`, replace the placeholder body of `stream_mjpeg` and add the `MJPEG_BOUNDARY` constant. The full updated file:

```python
"""Pi-side alignment tool: framework-agnostic helpers.

Two public functions:
- ``render_align_page()`` returns the static HTML for the alignment page
  served at ``/setup/align``.
- ``stream_mjpeg(frame_source, fps)`` returns a generator producing
  multipart MJPEG bytes for ``/setup/preview.mjpg``.

Both are pure: no framework binding, no global state, no I/O beyond what
the caller provides via ``frame_source``. The eventual web-app integration
(in spec E's setup web app) registers these as route handlers.

Spec: docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md
(in the the-sunset-webcam-map repo).
"""
from __future__ import annotations

from typing import Callable, Iterator


MJPEG_BOUNDARY = "sunsetcamframe"
"""The multipart boundary string. The web app must declare the same value
in the response's Content-Type header (``multipart/x-mixed-replace; boundary=sunsetcamframe``)
so clients frame parts correctly."""


_ALIGN_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Align your camera</title>
  <style>
    body { background: #000; color: #fff; font: 14px system-ui, sans-serif; margin: 0; padding: 0; }
    .preview-wrap { position: relative; width: 100%; max-width: 100vw; aspect-ratio: 16/9; margin: 0 auto; }
    .preview-wrap img { width: 100%; display: block; }
    .overlay { position: absolute; inset: 0; pointer-events: none; }
    .instructions { padding: 16px 20px; line-height: 1.55; max-width: 560px; margin: 0 auto; }
    .instructions ol { padding-left: 1.2em; }
  </style>
</head>
<body>
  <div class="preview-wrap">
    <img src="/setup/preview.mjpg" alt="camera preview" />
    <svg class="overlay" viewBox="0 0 1600 900" preserveAspectRatio="none">
      <line x1="0" y1="450" x2="1600" y2="450"
            stroke="#ffcc66" stroke-width="2" stroke-dasharray="12 6" opacity="0.85" />
      <text x="800" y="60" fill="#ffcc66" font-size="36" text-anchor="middle"
            font-family="system-ui, sans-serif">&uarr; UP</text>
    </svg>
  </div>
  <div class="instructions">
    <p>Rotate the camera housing until:</p>
    <ol>
      <li>The real horizon lines up with the dashed line.</li>
      <li>The &uarr; on screen points the same direction as the &uarr; molded on the housing.</li>
    </ol>
    <p>When both match, mount the camera in place. Then close this tab and return to setup.</p>
  </div>
</body>
</html>
"""


def render_align_page() -> str:
    """Return the static HTML for the alignment page.

    Pure function — no I/O, no parameters. Callers (the web app) wrap the
    return value in their framework's response object.
    """
    return _ALIGN_HTML


def stream_mjpeg(
    frame_source: Callable[[], bytes],
    fps: int = 4,
) -> Iterator[bytes]:
    """Yield multipart-encoded MJPEG bytes by polling ``frame_source``.

    The generator stops cleanly when ``frame_source()`` raises
    ``StopIteration`` (end-of-stream) or any other exception (transient
    camera error — terminate rather than poison the response).

    ``fps`` is informational only here — the generator does NOT sleep
    between frames. The caller (web app) is responsible for rate-limiting
    if needed, since synchronous-vs-async scheduling depends on the
    chosen framework.
    """
    boundary = MJPEG_BOUNDARY
    while True:
        try:
            frame = frame_source()
        except StopIteration:
            return
        except Exception:
            # Any other failure terminates the stream cleanly. Logging is
            # the caller's responsibility — we don't want to import logging
            # into this framework-agnostic module.
            return

        header = (
            f"--{boundary}\r\n"
            f"Content-Type: image/jpeg\r\n"
            f"Content-Length: {len(frame)}\r\n"
            f"\r\n"
        ).encode("ascii")
        yield header
        yield frame
        yield b"\r\n"
```

- [ ] **Step 4: Run all module tests**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest tests/test_setup_alignment.py -v`
Expected: 9/9 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/setup_alignment.py tests/test_setup_alignment.py
git commit -m "feat(setup-align): stream_mjpeg() generator + MJPEG_BOUNDARY constant"
```

---

## Task 3: Smoke test — full firmware test suite green

The alignment module is fully covered by its own tests, but verify nothing else in the firmware regressed (the module is additive so this should be a fast pass).

- [ ] **Step 1: Run the entire firmware test suite**

Run: `cd /Users/jessekauppila/GitHub/sunset-cam-firmware && python -m pytest -v`
Expected: ALL pre-existing tests PASS + the 9 new alignment tests PASS.

If any pre-existing test fails, it's a pre-existing baseline issue, NOT caused by this plan — note it in the task report but don't try to fix it as part of this plan.

- [ ] **Step 2: Document the public API in the module docstring (already done in Task 2)**

Verify the module docstring at the top of `src/sunset_cam/setup_alignment.py` accurately describes the contract (route paths, boundary string, sync vs async expectations). If the actual implementation drifted, update the docstring. No commit needed unless drift was found.

- [ ] **Step 3: No new commits if no drift**

If Step 2 produced no edits, this task closes with no commit. Otherwise:

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git add src/sunset_cam/setup_alignment.py
git commit -m "docs(setup-align): keep docstring aligned with implementation"
```

---

## Task 4: Integration note for downstream specs

The functions land; the actual route registration belongs to spec E's setup web app. Two specs need a one-line update so that the next implementer doesn't lose this thread.

**Files:**
- Modify: `docs/superpowers/specs/2026-05-15-wifi-onboarding-and-provisioning-design.md` (in the `the-sunset-webcam-map` repo)
- Modify: `docs/superpowers/specs/2026-05-16-cloud-wizard-frontend-design.md` (in the `the-sunset-webcam-map` repo)

- [ ] **Step 1: Add an integration note to spec E**

In the `the-sunset-webcam-map` repo, open `docs/superpowers/specs/2026-05-15-wifi-onboarding-and-provisioning-design.md`. Find the section where the setup web app's routes are listed (search for `iwlist` or `Submit`). Append the following paragraph at the end of that section:

```markdown
**Alignment-tool integration (sub-project C).** The setup web app must also register two routes from `sunset_cam.setup_alignment`:

- `GET /setup/align` → response body = `render_align_page()`, `Content-Type: text/html; charset=utf-8`.
- `GET /setup/preview.mjpg` → response body streams from `stream_mjpeg(frame_source=capture.capture_jpeg)`, `Content-Type: multipart/x-mixed-replace; boundary=sunsetcamframe` (use `setup_alignment.MJPEG_BOUNDARY`).

These functions are framework-agnostic and pre-tested; this spec is responsible only for the framework wiring.
```

- [ ] **Step 2: Add an integration note to spec F**

In the same repo, open `docs/superpowers/specs/2026-05-16-cloud-wizard-frontend-design.md`. Append a one-paragraph section at the end of the "What it does" section (after the numbered list of screens):

```markdown
**Screen 4 alignment-tool link (sub-project C).** Screen 4 renders a single button "Open the alignment tool" that opens `http://<pi-local-ip>:<setup-port>/setup/align` in a new browser tab (`target="_blank"`). The Pi's local IP + port are surfaced by the same setup-status polling spec E uses for the WiFi-handoff transition. The button is followed by a "Continue" button that advances the wizard with no state from the alignment tool — the alignment step is a one-way side trip with no protocol payload.
```

- [ ] **Step 3: Commit both edits in one commit in the web-app repo**

```bash
cd /Users/jessekauppila/GitHub/the-sunset-webcam-map
git add docs/superpowers/specs/2026-05-15-wifi-onboarding-and-provisioning-design.md \
        docs/superpowers/specs/2026-05-16-cloud-wizard-frontend-design.md
git commit -m "docs(specs): wire alignment-tool integration notes into E + F"
```

- [ ] **Step 4: Push the web-app commit**

If working on a feature branch in the web-app repo, push to origin:

```bash
cd /Users/jessekauppila/GitHub/the-sunset-webcam-map
git push
```

If working directly on `main` (matches the user's pattern for doc updates), confirm with the user before pushing — this updates two PR-relevant specs that other branches may be reading.

---

## Task 5: Hardware-side tracking note

The molded ↑ UP arrow on the housing is not implementable in code. It's a hardware/STL change tracked by a separate hardware spec. Make sure that ticket exists.

- [ ] **Step 1: Check for an existing hardware tracking doc**

Run: `cd /Users/jessekauppila/GitHub/the-sunset-webcam-map && find docs -iname "*hardware*" -o -iname "*housing*" -o -iname "*enclosure*" -o -iname "*stl*" 2>/dev/null`

- [ ] **Step 2: If nothing exists, create a hardware-tracking stub**

If the previous command returned no matches, create `docs/hardware/2026-05-17-housing-up-arrow-stub.md` (note: hardware docs go in `docs/hardware/`, not `docs/superpowers/specs/` — the latter is for software specs only):

```markdown
# Housing UP-Arrow Marker — Hardware Stub

Status: Stub — 2026-05-17
Owner: Jesse Kauppila
Triggered by: software spec `docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md`

## What

Add a molded or recessed ↑ UP arrow to the camera housing's front face, above the lens.

## Requirements (from the software spec §5.3)

- Top-center of the front face, ≥3mm above the lens cutout, ≥3mm from the top edge
- Relief or recess, 8–12mm tall, depth/height ≥0.4mm so it survives weathering
- Same material as the housing — no painted/printed labels (they weather poorly)
- Either a flat ▲ triangle or stylized ↑ acceptable; pick one design and apply consistently
- Must remain visible when mounted with any reasonable tape/screw fixture

## Why

The software alignment tool relies on operators reading this physical marker to know which way to mount the housing. Without it, the on-screen "↑ UP" label has no anchor in the real world.

## Becomes a real spec when

Someone picks up the housing STL to apply the change. The STL update is one CAD edit; this stub becomes a real spec when it's time to schedule that work.
```

If hardware docs already exist somewhere, add the marker requirements to the appropriate existing doc instead.

- [ ] **Step 3: Commit (if a file was created)**

```bash
cd /Users/jessekauppila/GitHub/the-sunset-webcam-map
git add docs/hardware/2026-05-17-housing-up-arrow-stub.md
git commit -m "docs(hardware): stub for housing UP-arrow marker (C dependency)"
git push
```

---

## Task 6: Push the firmware commits

The firmware commits from Tasks 1–3 live in `/Users/jessekauppila/GitHub/sunset-cam-firmware`. Push them to origin so future spec-E implementers can pick them up.

- [ ] **Step 1: Identify the firmware branch state**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git branch --show-current
git log origin/main..HEAD --oneline
```

- [ ] **Step 2: Create a feature branch if currently on main, otherwise reuse**

If the current branch is `main`, do not push directly. Create a feature branch first:

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git checkout -b feat/setup-alignment-module
```

If the current branch is already a feature branch with the Task 1–3 commits, skip this step.

- [ ] **Step 3: Push the branch**

```bash
cd /Users/jessekauppila/GitHub/sunset-cam-firmware
git push -u origin HEAD
```

- [ ] **Step 4: Open a PR (manual)**

The plan does not auto-create the PR. The implementer opens it with the title `feat(setup-align): framework-agnostic alignment-tool functions` and a body summarizing: "Two pure functions (HTML render + MJPEG generator) plus 9 unit tests. Framework-agnostic — landing now so spec E's setup web app can register them as routes when it's built." Link to the spec at `docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md` in the web-app repo.

---

## Self-review

Mapping the spec to tasks:

| Spec section | Task(s) |
|---|---|
| §5.1 Architecture (two routes served by Pi web app) | 1, 2 produce the handlers; 4 wires them via spec E |
| §5.2 Alignment page (HTML structure, SVG overlay) | 1 (`render_align_page` with 5 unit tests) |
| §5.2 MJPEG stream | 2 (`stream_mjpeg` with 4 unit tests + boundary constant) |
| §5.3 Hardware UP arrow | 5 (hardware stub doc) |
| §5.4 F integration (screen 4 link) | 4 step 2 (spec F note) |
| §6 No new protocol fields | Confirmed — no protocol code in this plan |
| §7.1 Unit testing | 1, 2 |
| §7.2 Manual testing | Deferred to spec E's web-app field-testing — noted explicitly in plan header |
| §8 Risks | MJPEG latency: handled by the `fps` parameter being caller-controlled; rate limiting is caller's responsibility |
| §10 Open question (concurrent encoders) | Sidestepped: in setup mode the production capture loop is idle, so `frame_source=capture.capture_jpeg` has exclusive picamera2 access. Documented in stream_mjpeg's docstring. |

No spec section maps to "nothing" — every requirement that's implementable in software has a task. Hardware (§5.3) is correctly scoped out to a separate ticket.

**Open dependency:** Task 4 step 2 updates F's stub spec doc, but F is doc-only today. When F's implementation plan is written, that plan should reference this integration note. No coordination needed in the meantime.
