# Known Limitations

## Skills token counts are partial

Skills (user messages starting with `/`) spawn subagent work that may run in
separate sessions. The dashboard attributes tokens to the skill's own turn only;
any downstream sessions started by that skill are counted separately under the
project that owns them, not under the originating skill invocation.

This means the "total tokens" figure on the Skills tab is a lower bound — the
true cost of a skill invocation may be higher.

## Streaming duplicates in very new sessions

Claude Code writes assistant messages multiple times as they stream. The scanner
deduplicates by `message.id` and keeps the last occurrence. If you scan while a
session is actively being written, you may see slightly inflated counts for the
in-flight message; they correct themselves on the next 30-second refresh.

## mtime-based incremental scanning

The scanner skips files whose `mtime` matches the cached value. If you manually
touch or copy a JSONL file without changing its content, it will be re-scanned
(harmlessly, since `INSERT OR IGNORE` prevents double-counting turns). Conversely,
if a file's mtime somehow doesn't update when its content changes, the new data
will be missed until the mtime changes. Deleting `~/.claude/token-dashboard.db`
and re-scanning always produces a correct result.

## Cost estimates vs. actual bills

The dashboard computes costs from token counts using the rates in `pricing.json`.
These match Anthropic's published API prices as of the file's last update, but
prices change. Edit `pricing.json` directly to keep estimates accurate.

Pro / Max / Max-20x plans are not billed per-token; the "estimated cost" for
those plans shows what you would have paid at API rates — useful for gauging
whether your subscription is cost-effective.

## Windows path separators

The scanner uses `pathlib.Path.rglob` which handles both `/` and `\`. Project
slugs extracted from directory names may contain URL-encoded characters on some
systems (Claude Code encodes project paths). These are displayed as-is.

## Concurrent dashboard instances

Two instances of the dashboard server fighting over the same SQLite file will
cause `database is locked` errors. Run only one instance at a time.

## Large JSONL files

Very long sessions (hundreds of turns with large tool results) can be slow to
parse on first scan. Subsequent scans skip unchanged files.
