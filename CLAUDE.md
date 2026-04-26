# Token Dashboard — Architecture & Conventions

## What this is

A local-only analytics dashboard that reads Claude Code's JSONL session files
(`~/.claude/projects/`) and renders per-prompt cost analytics, cache breakdowns,
tool heatmaps, and rule-based optimisation tips in a browser UI.

**No data leaves the machine.** There are no network calls, no telemetry, and
no external font/JS CDN references anywhere in the codebase.

## Directory structure

```
cli.py                  CLI entry point (scan / today / stats / tips / dashboard)
pricing.json            Per-model token rates and plan definitions
token_dashboard/
  __init__.py
  scanner.py            JSONL parser + SQLite writer
  server.py             stdlib HTTP server — static files + /api/* routes
  tips.py               Rule-based tips engine
web/
  index.html            Single-page UI (hash router, 7 tabs)
  app.js                Vanilla JS — API calls, SVG charts, routing
  style.css             Dark theme CSS
docs/
  KNOWN_LIMITATIONS.md
  inspiration.md
tests/                  unittest-based test suite (run: python3 -m unittest discover tests)
```

## Data flow

```
cli.py → scanner.py → SQLite DB  (write path)
browser → server.py → SQLite DB  (read path, /api/* routes)
server.py → web/                 (static files)
```

## Scanner

`token_dashboard/scanner.py` walks `~/.claude/projects/**/*.jsonl`. Each file
represents one Claude Code session. The path encodes metadata:

```
~/.claude/projects/<project-slug>/<session-id>.jsonl
```

Claude Code streams assistant responses and writes each message 2–3 times while
it generates. The scanner deduplicates by `message.id` (keeping the **last**
occurrence, which has the final token counts) before storing anything.

Sessions are grouped into **turns**: a turn starts at each human-typed user
message and encompasses all the assistant responses and tool-call round-trips
that follow until the next human message.

The SQLite cache lives at `~/.claude/token-dashboard.db` (or the path set via
`TOKEN_DASHBOARD_DB`). The file-index table (`file_index`) stores each JSONL
file's mtime; the scanner skips files that haven't changed since the last scan.

## Server

`token_dashboard/server.py` uses `http.server.HTTPServer` — no third-party
framework. Each thread gets its own SQLite connection via `threading.local`.

API routes (all GET unless noted):

| Route | Description |
|---|---|
| `GET /api/overview` | All-time totals, daily chart data, top tools, recent sessions |
| `GET /api/prompts` | Turns ranked by total token count |
| `GET /api/sessions` | Session list (optionally filtered by `?project=`) |
| `GET /api/sessions/<id>` | Turn-by-turn session detail |
| `GET /api/projects` | Per-project aggregates |
| `GET /api/skills` | Skill invocation counts (user messages starting with `/`) |
| `GET /api/tips` | Rule-based suggestions |
| `GET /api/settings` | Current plan + pricing data |
| `POST /api/settings` | Persist setting changes (e.g. `{"plan":"max"}`) |
| `GET /api/events` | Server-Sent Events stream — sends `{"type":"refresh"}` every 30 s |

Static files are served from `web/`. Path traversal is blocked.

## Frontend

Single HTML page (`web/index.html`) with a hash-based tab router.

Charts are rendered as inline SVG — no charting library dependency. Utility
functions `svgLineChart`, `svgBarChart`, `svgDonut` in `web/app.js`.

The SSE connection (`/api/events`) marks all tab caches stale every 30 s and
re-fetches the currently visible tab automatically.

## Pricing

`pricing.json` contains per-million-token rates for each model and plan
definitions. Edit directly to update prices or add new models. The `plan`
setting stored in SQLite controls which plan the cost estimates use.

## Conventions

- **stdlib only** — no `pip install` anywhere in the dashboard code.
- Python 3.8+ compatibility (no walrus operators, no `match`, etc.).
- All DB writes go through `scanner.py`; `server.py` is read-only except for
  the settings table.
- `INSERT OR IGNORE` on turns (keyed by `message_id`) prevents double-counting
  if a session file is re-processed while it's still being written.
- Costs are computed at query time from raw token counts, not stored, so
  changing the plan in Settings reflects immediately without a re-scan.
