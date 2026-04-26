"""
Local HTTP server for the Token Dashboard.

Serves static files from web/ and handles /api/* routes backed by SQLite.
Uses only the Python stdlib — no third-party packages required.
"""

import json
import mimetypes
import os
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from token_dashboard.scanner import compute_cost, open_db
from token_dashboard.tips import generate_tips


class _Handler(BaseHTTPRequestHandler):
    # ------------------------------------------------------------------ logging
    def log_message(self, fmt, *args):
        pass  # suppress default stderr noise

    # ------------------------------------------------------------------ routing
    def do_GET(self):
        parsed = urlparse(self.path)
        p = parsed.path
        q = parse_qs(parsed.query)

        if p == "/api/events":
            self._sse()
        elif p == "/api/overview":
            self._api_overview(q)
        elif p == "/api/prompts":
            self._api_prompts(q)
        elif p == "/api/sessions" and not p[len("/api/sessions"):].lstrip("/"):
            self._api_sessions(q)
        elif p.startswith("/api/sessions/"):
            self._api_session_detail(p[len("/api/sessions/"):])
        elif p == "/api/projects":
            self._api_projects(q)
        elif p == "/api/skills":
            self._api_skills(q)
        elif p == "/api/tips":
            self._api_tips(q)
        elif p == "/api/settings":
            self._api_settings_get()
        elif p.startswith("/api/"):
            self._send_error(404)
        else:
            self._serve_static(p)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/settings":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self._send_error(400)
                return
            conn = self._conn()
            for k, v in data.items():
                conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)",
                    (k, json.dumps(v)),
                )
            conn.commit()
            self._send_json({"ok": True})
        else:
            self._send_error(404)

    # ------------------------------------------------------------------ helpers
    def _conn(self) -> sqlite3.Connection:
        return self.server.get_conn()

    def _send_json(self, obj, status: int = 200):
        body = json.dumps(obj, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, code: int):
        self.send_response(code)
        self.end_headers()

    def _get_setting(self, conn, key: str, default=None):
        row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        if row:
            try:
                return json.loads(row["value"])
            except (json.JSONDecodeError, TypeError):
                return row["value"]
        return default

    # ------------------------------------------------------------------ API
    def _api_overview(self, q):
        conn = self._conn()
        pricing = self.server.pricing
        plan = self._get_setting(conn, "plan", "api")

        totals = conn.execute(
            """
            SELECT
                COALESCE(SUM(input_tokens),0)       AS input_tokens,
                COALESCE(SUM(output_tokens),0)      AS output_tokens,
                COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
                COALESCE(SUM(cache_read_tokens),0)  AS cache_read_tokens,
                COUNT(*)                             AS sessions,
                COALESCE(SUM(turn_count),0)         AS turns
            FROM sessions
            """
        ).fetchone()

        # Cost per model
        model_rows = conn.execute(
            """
            SELECT primary_model,
                   COALESCE(SUM(input_tokens),0)       AS i,
                   COALESCE(SUM(output_tokens),0)      AS o,
                   COALESCE(SUM(cache_write_tokens),0) AS cw,
                   COALESCE(SUM(cache_read_tokens),0)  AS cr
            FROM sessions
            GROUP BY primary_model
            """
        ).fetchall()
        total_cost = sum(
            compute_cost(r["i"], r["o"], r["cw"], r["cr"], r["primary_model"] or "", pricing)
            for r in model_rows
        )

        # Daily usage (last 30 days)
        daily = conn.execute(
            """
            SELECT DATE(start_time) AS day,
                   COALESCE(SUM(input_tokens+output_tokens+cache_write_tokens),0) AS work_tokens,
                   COALESCE(SUM(cache_read_tokens),0) AS cache_tokens
            FROM sessions
            WHERE start_time IS NOT NULL
            GROUP BY day
            ORDER BY day DESC
            LIMIT 30
            """
        ).fetchall()

        projects = conn.execute(
            """
            SELECT project,
                   COALESCE(SUM(input_tokens+output_tokens),0) AS tokens,
                   COUNT(*) AS sessions
            FROM sessions
            GROUP BY project
            ORDER BY tokens DESC
            LIMIT 10
            """
        ).fetchall()

        models = conn.execute(
            """
            SELECT primary_model,
                   COALESCE(SUM(input_tokens+output_tokens),0) AS tokens
            FROM sessions
            WHERE primary_model IS NOT NULL
            GROUP BY primary_model
            ORDER BY tokens DESC
            """
        ).fetchall()

        top_tools = conn.execute(
            """
            SELECT tool_name, COUNT(*) AS calls
            FROM tool_calls
            GROUP BY tool_name
            ORDER BY calls DESC
            LIMIT 10
            """
        ).fetchall()

        recent = conn.execute(
            """
            SELECT session_id, project, start_time, turn_count,
                   input_tokens+output_tokens AS tokens, primary_model
            FROM sessions
            ORDER BY start_time DESC
            LIMIT 15
            """
        ).fetchall()

        self._send_json({
            "totals": dict(totals),
            "total_cost_usd": total_cost,
            "plan": plan,
            "daily": [dict(r) for r in reversed(daily)],
            "projects": [dict(r) for r in projects],
            "models": [dict(r) for r in models],
            "top_tools": [dict(r) for r in top_tools],
            "recent_sessions": [dict(r) for r in recent],
        })

    def _api_prompts(self, q):
        conn = self._conn()
        limit = min(int(q.get("limit", ["100"])[0]), 500)
        offset = int(q.get("offset", ["0"])[0])
        rows = conn.execute(
            """
            SELECT t.id, t.session_id, s.project, t.timestamp,
                   t.user_text, t.input_tokens, t.output_tokens,
                   t.cache_write_tokens, t.cache_read_tokens,
                   t.model, t.tool_names
            FROM turns t
            JOIN sessions s ON s.session_id = t.session_id
            WHERE t.input_tokens + t.output_tokens > 0
              AND t.user_text IS NOT NULL AND t.user_text != ''
            ORDER BY t.input_tokens + t.output_tokens DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()
        self._send_json({"prompts": [dict(r) for r in rows]})

    def _api_sessions(self, q):
        conn = self._conn()
        project = q.get("project", [None])[0]
        if project:
            rows = conn.execute(
                "SELECT * FROM sessions WHERE project = ? ORDER BY start_time DESC",
                (project,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM sessions ORDER BY start_time DESC LIMIT 200"
            ).fetchall()
        self._send_json({"sessions": [dict(r) for r in rows]})

    def _api_session_detail(self, session_id: str):
        conn = self._conn()
        session = conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
        if not session:
            self._send_error(404)
            return
        turns = conn.execute(
            "SELECT * FROM turns WHERE session_id = ? ORDER BY turn_index",
            (session_id,),
        ).fetchall()
        tools = conn.execute(
            "SELECT * FROM tool_calls WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
        self._send_json({
            "session": dict(session),
            "turns": [dict(t) for t in turns],
            "tool_calls": [dict(t) for t in tools],
        })

    def _api_projects(self, q):
        conn = self._conn()
        rows = conn.execute(
            """
            SELECT project,
                   COUNT(*)                             AS sessions,
                   COALESCE(SUM(turn_count),0)         AS turns,
                   COALESCE(SUM(input_tokens),0)       AS input_tokens,
                   COALESCE(SUM(output_tokens),0)      AS output_tokens,
                   COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
                   COALESCE(SUM(cache_read_tokens),0)  AS cache_read_tokens,
                   MAX(end_time)                       AS last_active
            FROM sessions
            GROUP BY project
            ORDER BY SUM(input_tokens+output_tokens) DESC
            """
        ).fetchall()
        self._send_json({"projects": [dict(r) for r in rows]})

    def _api_skills(self, q):
        conn = self._conn()
        rows = conn.execute(
            """
            SELECT
                CASE
                    WHEN INSTR(user_text, ' ') > 1
                        THEN SUBSTR(user_text, 1, INSTR(user_text, ' ') - 1)
                    ELSE user_text
                END AS skill,
                COUNT(*) AS invocations,
                COALESCE(SUM(input_tokens+output_tokens),0) AS total_tokens
            FROM turns
            WHERE user_text LIKE '/%'
            GROUP BY skill
            ORDER BY invocations DESC
            LIMIT 30
            """
        ).fetchall()
        self._send_json({"skills": [dict(r) for r in rows]})

    def _api_tips(self, q):
        conn = self._conn()
        tips = generate_tips(conn)
        self._send_json({"tips": tips})

    def _api_settings_get(self):
        conn = self._conn()
        pricing = self.server.pricing
        plan = self._get_setting(conn, "plan", "api")
        self._send_json({
            "plan": plan,
            "plans": pricing.get("plans", {}),
            "models": pricing.get("models", {}),
        })

    # ------------------------------------------------------------------ SSE
    def _sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            while True:
                time.sleep(30)
                self.wfile.write(b'data: {"type":"refresh"}\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    # ------------------------------------------------------------------ static
    def _serve_static(self, path: str):
        if path in ("/", ""):
            path = "/index.html"

        web_dir = Path(self.server.web_dir).resolve()
        file_path = (web_dir / path.lstrip("/")).resolve()

        # Security: block path traversal
        try:
            file_path.relative_to(web_dir)
        except ValueError:
            self._send_error(403)
            return

        if not file_path.is_file():
            # SPA fallback
            file_path = web_dir / "index.html"

        ext = file_path.suffix.lower()
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".woff2": "font/woff2",
        }.get(ext, "application/octet-stream")

        try:
            data = file_path.read_bytes()
        except OSError:
            self._send_error(404)
            return

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", len(data))
        self.end_headers()
        self.wfile.write(data)


class _Server(HTTPServer):
    def __init__(self, host: str, port: int, db_path: str, web_dir: str, pricing: dict):
        super().__init__((host, port), _Handler)
        self.db_path = db_path
        self.web_dir = web_dir
        self.pricing = pricing
        self._local = threading.local()

    def get_conn(self) -> sqlite3.Connection:
        if not getattr(self._local, "conn", None):
            self._local.conn = open_db(self.db_path)
        return self._local.conn


def make_server(host: str, port: int, db_path: str, web_dir: str, pricing: dict) -> _Server:
    return _Server(host, port, db_path, web_dir, pricing)
