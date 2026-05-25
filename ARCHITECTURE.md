# ARKI v2 — Headless Background AI Runtime

## 1. Overview

ARKI v2 is a headless Electron application. There is no persistent UI window, no React SPA, no
Vite dev server. The only visible affordance is a system tray icon.

When the user presses a hotkey, ARKI captures a screenshot, runs it through the OCR + AI
pipeline, and surfaces the result in a lightweight popup that auto-dismisses after 30 seconds.
Everything else happens silently in the background.

**Design philosophy:**
- Background-first. ARKI must never steal focus or interrupt the user's work.
- Local-first. Tesseract + Ollama run entirely offline; cloud providers are opt-in fallbacks.
- Fast. From keypress to popup in under 500 ms for local providers.
- Small. Total background footprint under 80 MB.

---

## 2. Architecture Diagram

```
 User presses Cmd+Shift+S
         │
         ▼
 ┌──────────────────┐
 │  HotkeyEngine    │  double-press detection (300ms window)
 │  (main process)  │  single → OCR only | double → OCR + AI
 └────────┬─────────┘
          │
          ▼
 ┌──────────────────┐
 │ CaptureService   │  desktopCapturer → PNG buffer
 │                  │  <50ms for fullscreen
 └────────┬─────────┘
          │
          ▼
 ┌──────────────────┐     HTTP POST /api/process
 │  BackendBridge   │ ──────────────────────────►  Python FastAPI
 │                  │                              OCR Pipeline
 │                  │ ◄──────────────────────────  AI Orchestrator
 └────────┬─────────┘
          │
          ▼
 ┌──────────────────┐
 │  PopupManager    │  pre-warmed BrowserWindow
 │                  │  positions near cursor
 │  popup/index.html│  vanilla HTML/CSS/JS
 └──────────────────┘
```

---

## 3. Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| UI strategy | Tray-only, popup on-demand | No persistent window = lower memory |
| Popup tech | Vanilla HTML/JS | <50ms open vs 200ms+ for React |
| Popup warm-up | Pre-warmed hidden window pool | Eliminates window creation latency |
| Backend comms | HTTP (not WebSocket) | Request/response = simpler for on-demand use |
| Double-press | Timer-based in HotkeyEngine | Native globalShortcut doesn't support it |
| OCR chain | Tesseract → EasyOCR → OpenAI Vision | Local-first, fallback to cloud |
| AI chain | Ollama → OpenAI → Claude | Local-first, cloud fallback |
| Config | ~/.arki/config.json + hot-reload | User-editable without restart |
| No React/Vite | Removed entirely | Zero renderer overhead in main process |
| LSUIElement | true in Info.plist | App hidden from Dock on macOS |
| asar | true | Faster startup, single-archive distribution |

---

## 4. Memory Footprint

| Component | Idle | Active |
|-----------|------|--------|
| Electron main process (no renderer) | 15–25 MB | 20–30 MB |
| Python backend (FastAPI, idle) | 40–60 MB | 60–80 MB |
| Python backend (with Tesseract loaded) | 80–120 MB | 100–140 MB |
| Popup window (when visible) | 20–30 MB | 20–30 MB |
| **Total (background, no popup)** | **~60–80 MB** | — |
| **Total (popup visible)** | — | **~80–110 MB** |

Ollama runs as a separate system process outside ARKI's memory envelope.

---

## 5. Event Flow

### Single press (OCR only)

```
1. HotkeyEngine receives globalShortcut callback for Cmd+Shift+S
2. HotkeyEngine starts 300ms timer
3. Timer expires without a second press → "single" event emitted
4. CaptureService.captureActiveWindow()
   - screenshotDelay=80ms wait (let OS repaint after hotkey UI)
   - desktopCapturer.getSources({ types: ['screen'] })
   - Returns PNG Buffer
5. BackendBridge.postCapture(imageBase64)
   - POST /api/capture  { image_base64, mime_type, analyze_with_ai: false }
   - Timeout: 30 000ms
6. Python OCR Pipeline
   - Decode base64 → PIL Image
   - Run Tesseract (primary)
   - If confidence < minConfidence → fallback to EasyOCR
   - Returns OCRResult { id, raw_text, cleaned_text, confidence, content_type }
7. PopupManager.show(ocrResult)
   - Pre-warmed BrowserWindow already exists (hidden)
   - Call popup window's loadURL with result data in query string
     (or postMessage via IPC)
   - Position window near current cursor coordinates
   - Show window (already rendered → instant)
8. Popup auto-dismisses after autoDismissMs (default 30 000ms)
   or on Escape keypress
```

### Double press (OCR + AI)

```
Steps 1–6 identical to single press, except:
  - Step 3: second keypress detected within 300ms → "double" event emitted
  - Step 5: analyze_with_ai: true in request body

After OCR result returned (step 6):
7a. BackendBridge.postAnalyze(ocrResultId)
    - POST /api/analyze  { ocr_result_id, analysis_type: "explain", model: "mini" }
    - AI chain: Ollama (llama3.2) → OpenAI (gpt-4o-mini) on failure
    - Returns AIResponse { headline, content, code_blocks, latency_ms }
7b. PopupManager.show(ocrResult, aiResponse)
    - Same pre-warmed window
    - Two-panel layout: OCR text + AI analysis
    - Auto-dismiss after autoDismissMs
```

### Config hot-reload

```
1. fs.watch on ~/.arki/config.json
2. On change: read file, merge with default.json (defaults win for missing keys)
3. Emit 'config:updated' event on EventEmitter
4. HotkeyEngine re-registers shortcuts with new keybindings
5. PopupManager updates autoDismiss timer, width/height, theme
6. BackendBridge updates host/port/timeout
```

---

## 6. File Structure

```
ArkiOCR/
│
├── ARCHITECTURE.md               ← this document
├── .env                          ← local environment (gitignored)
├── .env.example                  ← template for new developers
├── .gitignore
│
├── config/
│   └── default.json              ← shipped defaults; merged with ~/.arki/config.json
│
├── backend/                      ← Python FastAPI service
│   ├── main.py                   ← FastAPI app, startup/shutdown lifecycle
│   ├── config.py                 ← Pydantic Settings (reads .env)
│   ├── requirements.txt
│   │
│   ├── api/
│   │   ├── routes.py             ← REST endpoints: /health /capture /analyze /session
│   │   ├── models.py             ← Pydantic request/response models
│   │   └── websocket.py          ← (legacy) WS handler — unused in v2, kept for compat
│   │
│   ├── ocr/
│   │   ├── interface.py          ← get_ocr_service() factory + abstract base class
│   │   └── providers/
│   │       ├── tesseract.py      ← pytesseract wrapper (primary)
│   │       ├── easyocr.py        ← easyocr wrapper (fallback)
│   │       └── openai_vision.py  ← GPT-4o Vision (cloud fallback)
│   │
│   ├── ai/
│   │   ├── interface.py          ← get_ai_service() factory + abstract base class
│   │   └── providers/
│   │       ├── ollama.py         ← local inference via Ollama HTTP API
│   │       ├── openai.py         ← OpenAI chat completions
│   │       └── claude.py         ← Anthropic messages API
│   │
│   └── session/
│       └── __init__.py           ← in-memory session (SQLite in Phase 2)
│
├── frontend/                     ← Electron (headless — no React, no Vite)
│   ├── package.json              ← v2: no React/Vite deps, headless only
│   │
│   ├── electron/                 ← all TypeScript compiled to dist/electron/
│   │   ├── tsconfig.json         ← compiles to dist/electron/, module=commonjs
│   │   ├── main.ts               ← app entry: tray, hotkeys, backend process
│   │   ├── hotkey-engine.ts      ← globalShortcut + double-press timer logic
│   │   ├── capture-service.ts    ← desktopCapturer → PNG Buffer
│   │   ├── capture-manager.ts    ← orchestrates capture → OCR → AI → popup
│   │   ├── backend-bridge.ts     ← HTTP client wrapping /api/* endpoints
│   │   ├── popup-manager.ts      ← pre-warmed BrowserWindow pool
│   │   ├── pipeline.ts           ← pipeline.run(event) orchestrator
│   │   └── preload.ts            ← contextBridge for popup renderer
│   │
│   ├── popup/                    ← vanilla HTML/CSS/JS (no bundler)
│   │   ├── index.html            ← popup shell (loaded by PopupManager)
│   │   ├── popup.css             ← dark/light theme variables
│   │   └── popup.js              ← receives IPC data, renders result
│   │
│   └── dist/                     ← compiled output (gitignored)
│       └── electron/
│
├── assets/                       ← tray icons, app icons
│   ├── tray-icon.png
│   ├── tray-icon@2x.png
│   └── icon.icns                 ← macOS app icon
│
└── data/                         ← runtime data (gitignored)
    └── sessions/                 ← SQLite session DBs (Phase 2)
```

---

## 7. Hotkeys

### Default keybindings

| Action | Default hotkey | Behavior |
|--------|----------------|----------|
| Capture (OCR only) | `Cmd+Shift+S` | Single press: capture active window, run OCR, show popup |
| Capture + AI | `Cmd+Shift+S` (double press) | Two presses within 300ms: OCR + AI analysis |
| Capture fullscreen | `Cmd+Shift+F` | Capture entire display regardless of active window |
| Dismiss popup | `Escape` | Close popup immediately |

### Double-press detection

The `HotkeyEngine` maintains a timestamp of the last keypress. On each invocation of the
`globalShortcut` callback:

```
lastPressedAt = null

on hotkey fired:
  now = Date.now()
  if lastPressedAt != null and (now - lastPressedAt) <= thresholdMs (300ms):
    emit 'hotkey:double'
    lastPressedAt = null        ← reset so triple press is not double again
  else:
    schedule timeout(thresholdMs):
      if no second press arrived: emit 'hotkey:single'
    lastPressedAt = now
```

The user can disable double-press via `config.doublePress.enabled = false`, in which case every
press immediately triggers `hotkey:single` (OCR only).

---

## 8. Configuration Reference

Config is resolved by merging `config/default.json` (shipped) with `~/.arki/config.json`
(user-override). User values take precedence. Missing user keys fall back to defaults.

```jsonc
{
  // ── Hotkeys ──────────────────────────────────────────────────────────────
  "hotkeys": {
    "capture":           "CommandOrControl+Shift+S",  // main capture trigger
    "captureFullscreen": "CommandOrControl+Shift+F",  // full display capture
    "dismiss":           "Escape"                     // close popup
  },

  // ── Double-press ─────────────────────────────────────────────────────────
  "doublePress": {
    "enabled":     true,   // false = single press always triggers OCR-only
    "thresholdMs": 300     // window in ms to register a double press
  },

  // ── Screen capture ────────────────────────────────────────────────────────
  "capture": {
    "mode":            "active-window",  // "active-window" | "fullscreen"
    "screenshotDelay": 80               // ms to wait before screenshot (OS repaint)
  },

  // ── OCR pipeline ──────────────────────────────────────────────────────────
  "ocr": {
    "provider":          "tesseract",    // primary provider
    "fallbackProviders": ["easyocr"],    // tried in order if primary fails/low-confidence
    "language":          "eng",          // BCP-47 or Tesseract lang code
    "minConfidence":     0.3             // below this → try next provider
  },

  // ── AI pipeline ───────────────────────────────────────────────────────────
  "ai": {
    "provider":        "ollama",       // "ollama" | "openai" | "claude"
    "model":           "llama3.2",     // model identifier for primary provider
    "fallbackProvider": "openai",      // used when primary unavailable
    "fallbackModel":   "gpt-4o-mini",  // model for fallback provider
    "maxTokens":       500,
    "temperature":     0.3,
    "systemPrompt":    ""              // optional override; empty = built-in prompt
  },

  // ── Popup window ──────────────────────────────────────────────────────────
  "popup": {
    "autoDismissMs": 30000,      // 0 = never auto-dismiss
    "position":      "cursor",   // "cursor" | "top-right" | "top-left" | "center"
    "theme":         "dark",     // "dark" | "light" | "system"
    "width":         420,        // px
    "maxHeight":     580         // px; popup scrolls if content exceeds
  },

  // ── Backend bridge ────────────────────────────────────────────────────────
  "backend": {
    "host":    "127.0.0.1",
    "port":    8000,
    "timeout": 30000            // ms; applies per HTTP request
  }
}
```

---

## 9. Backend API

Base URL: `http://{backend.host}:{backend.port}/api`

All requests from Electron are localhost-only. CORS is restricted to `null` origin
(file:// Electron renderer) in production.

### GET /api/health

Returns service status. Called by `main.ts` on startup to confirm backend is ready.

**Response 200:**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "timestamp": "2026-05-24T10:00:00Z",
  "services": {
    "ocr": "ok",
    "ai": "ok",
    "database": "ok"
  }
}
```

`status` is `"ok"` only when all services are `"ok"`. Otherwise `"degraded"`.

---

### POST /api/capture

Submit a screenshot for OCR processing.

**Request:**
```json
{
  "image_base64": "<base64-encoded PNG>",
  "mime_type": "image/png",
  "ocr_provider": "auto",
  "analyze_with_ai": false
}
```

- `ocr_provider`: `"tesseract"` | `"easyocr"` | `"openai_vision"` | `"auto"` (default)
- `analyze_with_ai`: reserved for future combined endpoint; use `POST /api/analyze` separately

**Response 200:**
```json
{
  "id": "uuid",
  "timestamp": "2026-05-24T10:00:01Z",
  "raw_text": "...",
  "cleaned_text": "...",
  "content_type": "code",
  "detected_language": "python",
  "confidence": 0.91,
  "processing_ms": 145,
  "provider": "tesseract",
  "error": null
}
```

`content_type` values: `"code"` | `"math"` | `"text"` | `"table"` | `"mixed"` | `"unknown"`

---

### POST /api/analyze

Run AI analysis on a previously obtained OCR result.

**Request:**
```json
{
  "ocr_result_id": "<uuid from /capture>",
  "analysis_type": "explain",
  "context": "optional free-text user context (max 500 chars)",
  "model": "mini"
}
```

- `analysis_type`: `"explain"` | `"solve"` | `"optimize"` | `"translate"`
- `model`: `"mini"` (fast/cheap) | `"full"` (deep reasoning)

**Response 200:**
```json
{
  "id": "uuid",
  "timestamp": "2026-05-24T10:00:02Z",
  "type": "explanation",
  "headline": "Recursive Fibonacci implementation in Python",
  "content": "This function...",
  "supporting_points": ["Point 1", "Point 2"],
  "code_blocks": [
    { "language": "python", "code": "...", "explanation": "..." }
  ],
  "suggested_follow_up": "Would you like an iterative version?",
  "provider": "ollama",
  "model": "llama3.2",
  "input_tokens": 210,
  "output_tokens": 180,
  "latency_ms": 312,
  "session_cost_usd": 0.0,
  "error": null
}
```

Returns `429` when `session.total_cost_usd >= ai_cost_max_usd`.

---

### GET /api/session

Returns current session counters.

**Response 200:**
```json
{
  "id": "uuid",
  "started_at": "2026-05-24T09:00:00Z",
  "capture_count": 12,
  "ai_call_count": 4,
  "total_cost_usd": 0.0031,
  "cost_alert_threshold": 0.30,
  "cost_max_threshold": 0.50
}
```

---

### DELETE /api/session

Clears session counters and all in-memory OCR results.

**Response 204** (no body)

---

## 10. Development Setup

### Prerequisites

- Node.js 20+
- Python 3.11+
- Tesseract 5.x (`brew install tesseract` on macOS)
- Ollama (`brew install ollama`) with `ollama pull llama3.2`

### Steps

```bash
# 1. Clone and enter the repo
cd /path/to/ArkiOCR

# 2. Install Python dependencies
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Start the Python backend
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# 4. In a second terminal — install Electron deps
cd frontend
npm install

# 5. Compile TypeScript and launch Electron
npm run dev
# This runs: tsc -p electron/tsconfig.json --watch
# and then:  electron dist/electron/main.js
```

### Environment

Copy `.env.example` to `.env` in the project root and fill in any API keys needed for cloud
providers. For fully local operation (Tesseract + Ollama) no keys are required.

### Useful dev flags

```bash
# Open Electron DevTools for the popup window
ARKI_DEV_TOOLS=1 npm run start

# Force OCR provider for testing
OCR_PROVIDER=easyocr npm run start

# Skip Ollama health check (useful when Ollama is not running)
AI_PROVIDER=openai npm run start
```
