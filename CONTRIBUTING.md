# Contributing

## Prerequisites

- Python 3.8 or newer
- No `pip install` — the dashboard is stdlib-only

## Running locally

```bash
# Populate the DB from your real sessions
python3 cli.py scan --verbose

# Serve the dashboard
python3 cli.py dashboard
```

To point at a scratch directory instead of your real sessions:

```bash
python3 cli.py dashboard --projects-dir /path/to/test-projects --db /tmp/test.db
```

## Running tests

```bash
python3 -m unittest discover tests
```

All tests must pass before opening a PR.

## Code style

- stdlib only — do not add any `pip` dependencies
- Python 3.8 compatible (no walrus operator, no structural pattern matching)
- No external references in `web/` (no CDN URLs for fonts, JS, or CSS)
- Keep each module focused: `scanner.py` writes, `server.py` reads and serves,
  `tips.py` generates tips

## File layout

See `CLAUDE.md` for the full architecture overview.

## PR checklist

- [ ] `python3 -m unittest discover tests` passes
- [ ] No new external network calls (grep for `https://` in `token_dashboard/` and `web/`)
- [ ] `pricing.json` updated if new model prices changed
- [ ] `docs/KNOWN_LIMITATIONS.md` updated if you're aware of new rough edges
