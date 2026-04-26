"""
Scans ~/.claude/projects/ JSONL session files and populates a local SQLite cache.

Claude Code writes each assistant response 2-3 times while streaming; we
deduplicate by message.id, keeping only the final (most complete) occurrence.
"""

import json
import os
import sqlite3
import time
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS file_index (
    path    TEXT PRIMARY KEY,
    mtime   REAL NOT NULL,
    size    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id          TEXT PRIMARY KEY,
    project             TEXT NOT NULL,
    start_time          TEXT,
    end_time            TEXT,
    turn_count          INTEGER DEFAULT 0,
    input_tokens        INTEGER DEFAULT 0,
    output_tokens       INTEGER DEFAULT 0,
    cache_write_tokens  INTEGER DEFAULT 0,
    cache_read_tokens   INTEGER DEFAULT 0,
    primary_model       TEXT
);

CREATE TABLE IF NOT EXISTS turns (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id          TEXT NOT NULL,
    turn_index          INTEGER NOT NULL,
    timestamp           TEXT,
    user_text           TEXT,
    message_id          TEXT UNIQUE,
    input_tokens        INTEGER DEFAULT 0,
    output_tokens       INTEGER DEFAULT 0,
    cache_write_tokens  INTEGER DEFAULT 0,
    cache_read_tokens   INTEGER DEFAULT 0,
    model               TEXT,
    tool_names          TEXT
);

CREATE TABLE IF NOT EXISTS tool_calls (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    turn_id         INTEGER,
    tool_name       TEXT NOT NULL,
    input_preview   TEXT,
    result_size     INTEGER DEFAULT 0,
    timestamp       TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);
"""


def open_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def _model_rates(model: str, pricing: dict) -> dict:
    """Return per-million-token rates for a model, with a Sonnet fallback."""
    models = pricing.get("models", {})
    if model in models:
        return models[model]
    # Prefix/suffix match
    for key, rates in models.items():
        if model.startswith(key) or key.startswith(model):
            return rates
    return {"input": 3.0, "output": 15.0, "cache_write": 3.75, "cache_read": 0.3}


def compute_cost(
    input_tok: int,
    output_tok: int,
    cache_write_tok: int,
    cache_read_tok: int,
    model: str,
    pricing: dict,
) -> float:
    r = _model_rates(model or "", pricing)
    return (
        input_tok * r["input"] / 1_000_000
        + output_tok * r["output"] / 1_000_000
        + cache_write_tok * r["cache_write"] / 1_000_000
        + cache_read_tok * r["cache_read"] / 1_000_000
    )


# ---------------------------------------------------------------------------
# JSONL parsing helpers
# ---------------------------------------------------------------------------

def _is_human_message(entry: dict) -> bool:
    """True when this user entry is typed by a human (not auto-sent tool results)."""
    if entry.get("type") != "user":
        return False
    content = entry.get("message", {}).get("content", "")
    if isinstance(content, str):
        return bool(content.strip())
    if isinstance(content, list):
        return not all(
            isinstance(item, dict) and item.get("type") == "tool_result"
            for item in content
        )
    return True


def _extract_user_text(entry: dict) -> str:
    content = entry.get("message", {}).get("content", "")
    if isinstance(content, str):
        return content[:1000]
    if isinstance(content, list):
        parts = [
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ]
        return " ".join(parts)[:1000]
    return ""


def _parse_jsonl(path: str) -> list:
    """
    Read a JSONL session file; deduplicate assistant messages by message.id
    (keeping the last occurrence, which has the final token counts).
    Returns ordered list of user/assistant entries.
    """
    raw: list = []
    last_idx_by_msg_id: dict = {}

    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                etype = entry.get("type", "")
                if etype not in ("user", "assistant"):
                    continue

                if etype == "assistant":
                    msg_id = entry.get("message", {}).get("id", "")
                    if msg_id:
                        last_idx_by_msg_id[msg_id] = len(raw)

                raw.append(entry)
    except OSError:
        return []

    out = []
    for i, entry in enumerate(raw):
        if entry.get("type") == "assistant":
            msg_id = entry.get("message", {}).get("id", "")
            if msg_id and last_idx_by_msg_id.get(msg_id) != i:
                continue  # skip non-final duplicate
        out.append(entry)
    return out


# ---------------------------------------------------------------------------
# Session processing
# ---------------------------------------------------------------------------

def _process_session(path: str, session_id: str, project: str, conn: sqlite3.Connection, pricing: dict) -> None:
    entries = _parse_jsonl(path)
    if not entries:
        return

    # Group into turns: a turn starts at each human-typed message.
    turns: list = []
    current: list = []
    for entry in entries:
        if _is_human_message(entry) and current:
            turns.append(current)
            current = [entry]
        else:
            current.append(entry)
    if current:
        turns.append(current)

    session_input = session_output = session_cw = session_cr = 0
    session_model = None
    start_time = end_time = None
    turn_rows: list = []
    tool_rows: list = []

    for turn_idx, turn_entries in enumerate(turns):
        human = turn_entries[0] if _is_human_message(turn_entries[0]) else None
        user_text = _extract_user_text(human) if human else ""

        ts = (human or turn_entries[0]).get("timestamp", "")
        if ts:
            if start_time is None:
                start_time = ts
            end_time = ts

        turn_input = turn_output = turn_cw = turn_cr = 0
        turn_model = None
        turn_tools: list = []
        last_msg_id = None

        for entry in turn_entries:
            if entry.get("type") != "assistant":
                continue
            msg = entry.get("message", {})
            usage = msg.get("usage", {})
            turn_input += usage.get("input_tokens", 0)
            turn_output += usage.get("output_tokens", 0)
            turn_cw += usage.get("cache_creation_input_tokens", 0)
            turn_cr += usage.get("cache_read_input_tokens", 0)
            turn_model = msg.get("model") or turn_model
            last_msg_id = msg.get("id") or last_msg_id

            for block in msg.get("content", []):
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    name = block.get("name", "unknown")
                    turn_tools.append(name)
                    preview = json.dumps(block.get("input", {}))[:300]
                    tool_rows.append([session_id, None, name, preview, 0, ts])

        # Capture tool result sizes from user entries in this turn
        for entry in turn_entries:
            if entry.get("type") != "user":
                continue
            content = entry.get("message", {}).get("content", [])
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "tool_result":
                        result = item.get("content", "")
                        if isinstance(result, list):
                            result = json.dumps(result)
                        size = len(str(result))
                        # Attach size to the most recent matching tool row
                        for row in reversed(tool_rows):
                            if row[4] == 0 and row[0] == session_id:
                                row[4] = size
                                break

        session_input += turn_input
        session_output += turn_output
        session_cw += turn_cw
        session_cr += turn_cr
        if turn_model:
            session_model = turn_model

        turn_rows.append({
            "session_id": session_id,
            "turn_index": turn_idx,
            "timestamp": ts,
            "user_text": user_text,
            "message_id": last_msg_id,
            "input_tokens": turn_input,
            "output_tokens": turn_output,
            "cache_write_tokens": turn_cw,
            "cache_read_tokens": turn_cr,
            "model": turn_model,
            "tool_names": json.dumps(turn_tools),
        })

    conn.execute(
        """
        INSERT OR REPLACE INTO sessions
            (session_id, project, start_time, end_time, turn_count,
             input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, primary_model)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        """,
        (session_id, project, start_time, end_time, len(turn_rows),
         session_input, session_output, session_cw, session_cr, session_model),
    )

    conn.execute("DELETE FROM turns WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM tool_calls WHERE session_id = ?", (session_id,))

    for t in turn_rows:
        conn.execute(
            """
            INSERT OR IGNORE INTO turns
                (session_id, turn_index, timestamp, user_text, message_id,
                 input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
                 model, tool_names)
            VALUES
                (:session_id, :turn_index, :timestamp, :user_text, :message_id,
                 :input_tokens, :output_tokens, :cache_write_tokens, :cache_read_tokens,
                 :model, :tool_names)
            """,
            t,
        )

    for row in tool_rows:
        conn.execute(
            "INSERT INTO tool_calls (session_id, turn_id, tool_name, input_preview, result_size, timestamp) VALUES (?,?,?,?,?,?)",
            row,
        )

    conn.commit()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def scan(projects_dir: str, db_path: str, pricing: dict, verbose: bool = False) -> dict:
    """
    Walk *projects_dir*, find JSONL files, skip unchanged ones (by mtime),
    parse and store new/updated files. Returns counts dict.
    """
    conn = open_db(db_path)
    projects_path = Path(projects_dir).expanduser()

    stats = {"scanned": 0, "skipped": 0, "errors": 0, "total": 0}

    if not projects_path.exists():
        if verbose:
            print(f"Projects directory not found: {projects_path}")
        conn.close()
        return stats

    jsonl_files = sorted(projects_path.rglob("*.jsonl"))
    stats["total"] = len(jsonl_files)

    for path in jsonl_files:
        path_str = str(path)
        try:
            st = path.stat()
            mtime, size = st.st_mtime, st.st_size
        except OSError:
            stats["errors"] += 1
            continue

        row = conn.execute(
            "SELECT mtime FROM file_index WHERE path = ?", (path_str,)
        ).fetchone()
        if row and row["mtime"] == mtime:
            stats["skipped"] += 1
            continue

        # Path structure: .../projects/<project-slug>/<session-id>.jsonl
        session_id = path.stem
        project = path.parent.name

        if verbose:
            print(f"  scanning {project}/{session_id}")

        try:
            _process_session(path_str, session_id, project, conn, pricing)
            conn.execute(
                "INSERT OR REPLACE INTO file_index (path, mtime, size) VALUES (?,?,?)",
                (path_str, mtime, size),
            )
            conn.commit()
            stats["scanned"] += 1
        except Exception as exc:
            if verbose:
                print(f"  ERROR {path}: {exc}")
            stats["errors"] += 1

    conn.close()
    return stats
