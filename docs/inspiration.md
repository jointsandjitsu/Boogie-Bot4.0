# Inspiration & Prior Art

## What came before

Several tools exist for visualising LLM token usage:

- **LangSmith / Helicone / Braintrust** — hosted observability platforms.
  Powerful, but they require sending your prompt data to a third-party server.
  That's a non-starter for work involving confidential code or client data.

- **OpenAI usage dashboard** — shows aggregate monthly token counts, not
  per-prompt breakdowns, and only for OpenAI models.

- **Custom scripts** — many developers have written one-off scripts to `grep`
  or `jq` through Claude Code's JSONL files. They work, but you have to re-run
  them manually and the output is hard to scan.

## How this diverges

The Token Dashboard keeps everything local (no sign-in, no data upload) while
delivering the per-prompt granularity and visual layout that make expensive turns
obvious at a glance.

Key design choices that differ from generic observability tools:

1. **JSONL-native** — reads Claude Code's own on-disk format directly, so no
   instrumentation or proxy layer is needed.

2. **Deduplication by `message.id`** — the streaming write pattern Claude Code
   uses means each assistant turn appears 2–3 times in the file. Generic tools
   that sum every row overcount significantly.

3. **Turn grouping** — tool-call round-trips within one human prompt are
   aggregated into a single "turn" row. This matches how users think about cost
   ("that refactor prompt cost me X") rather than how the API charges ("that
   was 14 API calls").

4. **Rule-based tips** — simple heuristics over the local DB (repeated reads,
   large tool results, low cache-hit rate) surface actionable suggestions
   without any ML or external API.

5. **Zero dependencies** — the entire server and scanner run on Python's stdlib.
   No `pip install`, no virtualenv, no Node.js.
