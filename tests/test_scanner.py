"""Basic scanner tests."""
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path


# Sample JSONL content mimicking Claude Code session format
def _make_session(turns):
    """Build JSONL lines for a session with the given turns.

    Each turn is a dict: {user_text, input_tokens, output_tokens, model, tools=[]}
    Assistant messages are written twice to test deduplication.
    """
    lines = []
    msg_id_counter = [0]

    def next_id():
        msg_id_counter[0] += 1
        return f"msg_{msg_id_counter[0]:04d}"

    for i, t in enumerate(turns):
        # User message
        lines.append(json.dumps({
            "type": "user",
            "uuid": f"user-{i}",
            "sessionId": "test-session",
            "timestamp": f"2024-01-01T00:{i:02d}:00.000Z",
            "message": {"role": "user", "content": t.get("user_text", "hello")},
        }))

        # Assistant message (written twice — duplicate)
        msg_id = next_id()
        tools = t.get("tools", [])
        content = [{"type": "text", "text": "response"}]
        for tool in tools:
            content.append({"type": "tool_use", "id": f"toolu_{i}", "name": tool, "input": {}})

        for write_pass in range(2):
            usage = {
                "input_tokens": t.get("input_tokens", 100) if write_pass == 1 else 50,
                "output_tokens": t.get("output_tokens", 20),
                "cache_creation_input_tokens": t.get("cache_write", 0),
                "cache_read_input_tokens": t.get("cache_read", 0),
            }
            lines.append(json.dumps({
                "type": "assistant",
                "uuid": f"asst-{i}-v{write_pass}",
                "sessionId": "test-session",
                "timestamp": f"2024-01-01T00:{i:02d}:30.000Z",
                "message": {
                    "id": msg_id,
                    "type": "message",
                    "role": "assistant",
                    "content": content,
                    "model": t.get("model", "claude-sonnet-4-6"),
                    "usage": usage,
                },
            }))

    return "\n".join(lines) + "\n"


PRICING = {
    "models": {
        "claude-sonnet-4-6": {"input": 3.0, "output": 15.0, "cache_write": 3.75, "cache_read": 0.3}
    }
}


class TestScanner(unittest.TestCase):

    def _run_scan(self, session_content):
        """Write session to a temp dir, scan it, return db connection."""
        from token_dashboard.scanner import open_db, scan

        with tempfile.TemporaryDirectory() as tmpdir:
            proj_dir = Path(tmpdir) / "my-project"
            proj_dir.mkdir()
            (proj_dir / "abc123.jsonl").write_text(session_content)

            db_path = str(Path(tmpdir) / "test.db")
            stats = scan(tmpdir, db_path, PRICING)
            self.assertEqual(stats["scanned"], 1)
            self.assertEqual(stats["errors"], 0)

            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            return conn

    def test_single_turn(self):
        content = _make_session([{"user_text": "Hello", "input_tokens": 200, "output_tokens": 50}])
        conn = self._run_scan(content)

        session = conn.execute("SELECT * FROM sessions").fetchone()
        self.assertIsNotNone(session)
        self.assertEqual(session["project"], "my-project")
        self.assertEqual(session["turn_count"], 1)
        self.assertEqual(session["input_tokens"], 200)  # deduplicated: only last write
        self.assertEqual(session["output_tokens"], 50)

    def test_deduplication(self):
        """The scanner must not double-count streamed assistant messages."""
        content = _make_session([{"input_tokens": 300, "output_tokens": 60}])
        conn = self._run_scan(content)
        row = conn.execute("SELECT input_tokens FROM sessions").fetchone()
        # First write had 50 tokens; final write has 300 — only final should count
        self.assertEqual(row["input_tokens"], 300)

    def test_multiple_turns(self):
        content = _make_session([
            {"user_text": "Turn 1", "input_tokens": 100, "output_tokens": 20},
            {"user_text": "Turn 2", "input_tokens": 200, "output_tokens": 40},
        ])
        conn = self._run_scan(content)
        session = conn.execute("SELECT * FROM sessions").fetchone()
        self.assertEqual(session["turn_count"], 2)
        self.assertEqual(session["input_tokens"], 300)

    def test_tool_calls_recorded(self):
        content = _make_session([
            {"user_text": "Do it", "input_tokens": 100, "output_tokens": 30, "tools": ["Bash", "Read"]},
        ])
        conn = self._run_scan(content)
        tools = conn.execute("SELECT tool_name FROM tool_calls ORDER BY tool_name").fetchall()
        names = [r["tool_name"] for r in tools]
        self.assertIn("Bash", names)
        self.assertIn("Read", names)

    def test_incremental_scan_skips_unchanged(self):
        from token_dashboard.scanner import scan
        import tempfile

        content = _make_session([{"input_tokens": 100}])
        with tempfile.TemporaryDirectory() as tmpdir:
            proj_dir = Path(tmpdir) / "proj"
            proj_dir.mkdir()
            (proj_dir / "sess.jsonl").write_text(content)
            db_path = str(Path(tmpdir) / "test.db")

            stats1 = scan(tmpdir, db_path, PRICING)
            self.assertEqual(stats1["scanned"], 1)

            stats2 = scan(tmpdir, db_path, PRICING)
            self.assertEqual(stats2["scanned"], 0)
            self.assertEqual(stats2["skipped"], 1)


class TestComputeCost(unittest.TestCase):
    def test_basic_cost(self):
        from token_dashboard.scanner import compute_cost
        cost = compute_cost(1_000_000, 0, 0, 0, "claude-sonnet-4-6", PRICING)
        self.assertAlmostEqual(cost, 3.0)

    def test_cache_read_cheaper(self):
        from token_dashboard.scanner import compute_cost
        input_cost = compute_cost(1_000_000, 0, 0, 0, "claude-sonnet-4-6", PRICING)
        cache_cost = compute_cost(0, 0, 0, 1_000_000, "claude-sonnet-4-6", PRICING)
        self.assertLess(cache_cost, input_cost)

    def test_unknown_model_falls_back(self):
        from token_dashboard.scanner import compute_cost
        cost = compute_cost(1_000, 0, 0, 0, "claude-unknown-model-xyz", PRICING)
        self.assertGreater(cost, 0)


class TestTips(unittest.TestCase):
    def _make_db(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        from token_dashboard.scanner import open_db
        # Run schema against in-memory db
        from token_dashboard.scanner import SCHEMA
        conn.executescript(SCHEMA)
        return conn

    def test_no_tips_on_empty_db(self):
        from token_dashboard.tips import generate_tips
        conn = self._make_db()
        tips = generate_tips(conn)
        self.assertIsInstance(tips, list)

    def test_low_cache_tip(self):
        from token_dashboard.tips import generate_tips
        conn = self._make_db()
        conn.execute(
            "INSERT INTO sessions (session_id, project, input_tokens, cache_read_tokens, turn_count) VALUES (?,?,?,?,?)",
            ("s1", "proj", 100_000, 0, 5),
        )
        conn.commit()
        tips = generate_tips(conn)
        ids = [t["id"] for t in tips]
        self.assertIn("low_cache_hit_rate", ids)


if __name__ == "__main__":
    unittest.main()
