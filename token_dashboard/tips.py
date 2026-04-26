"""
Rule-based tips engine. Each rule inspects the SQLite DB and returns
zero or more tip dicts with keys: id, severity, title, detail.
"""

import json
import sqlite3


def _rule_repeated_file_reads(conn: sqlite3.Connection) -> list:
    """Flag tool inputs that reference the same file path many times per session."""
    tips = []
    rows = conn.execute(
        """
        SELECT session_id, tool_name, input_preview, COUNT(*) as cnt
        FROM tool_calls
        WHERE tool_name IN ('Read', 'View', 'read_file', 'view_file')
        GROUP BY session_id, input_preview
        HAVING cnt >= 4
        ORDER BY cnt DESC
        LIMIT 20
        """
    ).fetchall()

    for row in rows:
        try:
            preview = json.loads(row["input_preview"]) if row["input_preview"] else {}
            file_path = preview.get("file_path") or preview.get("path") or row["input_preview"]
        except (json.JSONDecodeError, TypeError):
            file_path = row["input_preview"]
        tips.append({
            "id": f"repeated_read:{row['session_id']}:{file_path}",
            "severity": "warning",
            "title": f"File read {row['cnt']}× in one session",
            "detail": (
                f"'{file_path}' was read {row['cnt']} times in session {row['session_id'][:8]}…"
                " — each re-read costs input tokens. Consider reading once and keeping the result."
            ),
        })
    return tips


def _rule_large_tool_results(conn: sqlite3.Connection) -> list:
    """Flag tool calls whose result exceeded 50 KB (≈ 12 k tokens)."""
    THRESHOLD = 50_000
    tips = []
    rows = conn.execute(
        """
        SELECT session_id, tool_name, result_size
        FROM tool_calls
        WHERE result_size > ?
        ORDER BY result_size DESC
        LIMIT 20
        """,
        (THRESHOLD,),
    ).fetchall()

    for row in rows:
        kb = row["result_size"] // 1024
        tips.append({
            "id": f"large_result:{row['session_id']}:{row['tool_name']}:{row['result_size']}",
            "severity": "warning",
            "title": f"{row['tool_name']} returned {kb} KB",
            "detail": (
                f"A '{row['tool_name']}' call returned {kb} KB of output in session "
                f"{row['session_id'][:8]}…. Filtering or truncating large results can "
                "save thousands of input tokens on follow-up turns."
            ),
        })
    return tips


def _rule_low_cache_hit_rate(conn: sqlite3.Connection) -> list:
    """Warn when the overall cache-read rate is below 25 %."""
    row = conn.execute(
        """
        SELECT
            SUM(input_tokens)       AS total_input,
            SUM(cache_read_tokens)  AS total_cr,
            SUM(cache_write_tokens) AS total_cw
        FROM sessions
        """
    ).fetchone()
    if not row or not row["total_input"]:
        return []

    total_input = row["total_input"] or 0
    total_cr = row["total_cr"] or 0
    eligible = total_input + total_cr
    if eligible == 0:
        return []
    hit_rate = total_cr / eligible

    if hit_rate < 0.25:
        pct = int(hit_rate * 100)
        return [{
            "id": "low_cache_hit_rate",
            "severity": "info",
            "title": f"Cache hit rate is {pct}%",
            "detail": (
                f"Only {pct}% of eligible tokens are served from cache. "
                "Longer, more stable system prompts and keeping sessions alive longer "
                "both increase cache utilisation."
            ),
        }]
    return []


def _rule_expensive_single_prompt(conn: sqlite3.Connection) -> list:
    """Flag turns where input+output alone is unusually large (> 100 k tokens)."""
    THRESHOLD = 100_000
    tips = []
    rows = conn.execute(
        """
        SELECT t.id, t.session_id, s.project, t.user_text,
               t.input_tokens + t.output_tokens AS total_tok
        FROM turns t
        JOIN sessions s ON s.session_id = t.session_id
        WHERE t.input_tokens + t.output_tokens > ?
        ORDER BY total_tok DESC
        LIMIT 10
        """,
        (THRESHOLD,),
    ).fetchall()

    for row in rows:
        snippet = (row["user_text"] or "")[:80].replace("\n", " ")
        ktok = row["total_tok"] // 1000
        tips.append({
            "id": f"expensive_prompt:{row['id']}",
            "severity": "warning",
            "title": f"Single prompt used {ktok}k tokens ({row['project']})",
            "detail": (
                f"Prompt '{snippet}...' consumed {ktok}k tokens. "
                "Large tool results piped back into context are often the cause. "
                "Try narrowing the scope of tool calls or summarising intermediate output."
            ),
        })
    return tips


def _rule_long_sessions(conn: sqlite3.Connection) -> list:
    """Warn on sessions with an unusually high turn count (> 60)."""
    THRESHOLD = 60
    tips = []
    rows = conn.execute(
        """
        SELECT session_id, project, turn_count
        FROM sessions
        WHERE turn_count > ?
        ORDER BY turn_count DESC
        LIMIT 10
        """,
        (THRESHOLD,),
    ).fetchall()

    for row in rows:
        tips.append({
            "id": f"long_session:{row['session_id']}",
            "severity": "info",
            "title": f"Session has {row['turn_count']} turns ({row['project']})",
            "detail": (
                f"Session {row['session_id'][:8]}… ran for {row['turn_count']} turns. "
                "Very long sessions accumulate context quickly. Starting fresh sessions "
                "for distinct sub-tasks can significantly reduce per-turn input costs."
            ),
        })
    return tips


RULES = [
    _rule_low_cache_hit_rate,
    _rule_expensive_single_prompt,
    _rule_large_tool_results,
    _rule_repeated_file_reads,
    _rule_long_sessions,
]


def generate_tips(conn: sqlite3.Connection) -> list:
    tips = []
    for rule in RULES:
        try:
            tips.extend(rule(conn))
        except Exception:
            pass
    # Deduplicate by id
    seen = set()
    out = []
    for tip in tips:
        if tip["id"] not in seen:
            seen.add(tip["id"])
            out.append(tip)
    return out
