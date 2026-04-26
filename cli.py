#!/usr/bin/env python3
"""
Token Dashboard CLI
Usage: python3 cli.py <command> [options]

Commands:
  scan        Populate / refresh the local DB, then exit
  today       Print today's token totals to the terminal
  stats       Print all-time totals to the terminal
  tips        Print active suggestions to the terminal
  dashboard   Scan + serve the dashboard at http://localhost:8080
"""

import argparse
import json
import os
import sqlite3
import sys
import webbrowser
from pathlib import Path
from threading import Thread

# ---------------------------------------------------------------------------
# Defaults (overridable via env vars)
# ---------------------------------------------------------------------------

DEFAULT_PROJECTS_DIR = os.environ.get(
    "CLAUDE_PROJECTS_DIR",
    str(Path.home() / ".claude" / "projects"),
)
DEFAULT_DB = os.environ.get(
    "TOKEN_DASHBOARD_DB",
    str(Path.home() / ".claude" / "token-dashboard.db"),
)
DEFAULT_HOST = os.environ.get("HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("PORT", "8080"))

_HERE = Path(__file__).parent
PRICING_PATH = _HERE / "pricing.json"
WEB_DIR = _HERE / "web"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_pricing() -> dict:
    try:
        with open(PRICING_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"Cannot read {PRICING_PATH}: {exc}")


def _fmtk(n: int) -> str:
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}k"
    return str(n)


def _fmt_cost(usd: float) -> str:
    if usd >= 1.0:
        return f"${usd:.2f}"
    return f"${usd:.4f}"


# ---------------------------------------------------------------------------
# scan command
# ---------------------------------------------------------------------------

def cmd_scan(args) -> None:
    from token_dashboard.scanner import scan

    pricing = _load_pricing()
    print(f"Scanning {args.projects_dir} …")
    stats = scan(args.projects_dir, args.db, pricing, verbose=args.verbose)
    print(
        f"Done — {stats['scanned']} scanned, "
        f"{stats['skipped']} unchanged, "
        f"{stats['errors']} errors "
        f"(total files: {stats['total']})"
    )


# ---------------------------------------------------------------------------
# today command
# ---------------------------------------------------------------------------

def cmd_today(args) -> None:
    from token_dashboard.scanner import compute_cost, open_db

    pricing = _load_pricing()
    conn = open_db(args.db)
    row = conn.execute(
        """
        SELECT
            COALESCE(SUM(input_tokens),0)       AS inp,
            COALESCE(SUM(output_tokens),0)      AS out,
            COALESCE(SUM(cache_write_tokens),0) AS cw,
            COALESCE(SUM(cache_read_tokens),0)  AS cr,
            COUNT(*)                             AS sessions,
            COALESCE(SUM(turn_count),0)         AS turns,
            primary_model
        FROM sessions
        WHERE DATE(start_time) = DATE('now')
        GROUP BY primary_model
        ORDER BY inp+out DESC
        """
    ).fetchall()

    if not row:
        print("No sessions found for today.")
        return

    total_i = total_o = total_cw = total_cr = total_s = total_t = 0
    total_cost = 0.0
    for r in row:
        total_i += r["inp"]
        total_o += r["out"]
        total_cw += r["cw"]
        total_cr += r["cr"]
        total_s += r["sessions"]
        total_t += r["turns"]
        total_cost += compute_cost(r["inp"], r["out"], r["cw"], r["cr"], r["primary_model"] or "", pricing)

    print(f"\nToday's totals")
    print(f"  Input tokens   : {_fmtk(total_i)}")
    print(f"  Output tokens  : {_fmtk(total_o)}")
    print(f"  Cache write    : {_fmtk(total_cw)}")
    print(f"  Cache read     : {_fmtk(total_cr)}")
    print(f"  Sessions       : {total_s}")
    print(f"  Turns          : {total_t}")
    print(f"  Estimated cost : {_fmt_cost(total_cost)}")
    conn.close()


# ---------------------------------------------------------------------------
# stats command
# ---------------------------------------------------------------------------

def cmd_stats(args) -> None:
    from token_dashboard.scanner import compute_cost, open_db

    pricing = _load_pricing()
    conn = open_db(args.db)

    row = conn.execute(
        """
        SELECT
            COALESCE(SUM(input_tokens),0)       AS inp,
            COALESCE(SUM(output_tokens),0)      AS out,
            COALESCE(SUM(cache_write_tokens),0) AS cw,
            COALESCE(SUM(cache_read_tokens),0)  AS cr,
            COUNT(*)                             AS sessions,
            COALESCE(SUM(turn_count),0)         AS turns
        FROM sessions
        """
    ).fetchone()

    model_rows = conn.execute(
        """
        SELECT primary_model,
               COALESCE(SUM(input_tokens),0)       AS inp,
               COALESCE(SUM(output_tokens),0)      AS out,
               COALESCE(SUM(cache_write_tokens),0) AS cw,
               COALESCE(SUM(cache_read_tokens),0)  AS cr
        FROM sessions
        GROUP BY primary_model
        """
    ).fetchall()

    total_cost = sum(
        compute_cost(r["inp"], r["out"], r["cw"], r["cr"], r["primary_model"] or "", pricing)
        for r in model_rows
    )

    print(f"\nAll-time totals")
    print(f"  Input tokens   : {_fmtk(row['inp'])}")
    print(f"  Output tokens  : {_fmtk(row['out'])}")
    print(f"  Cache write    : {_fmtk(row['cw'])}")
    print(f"  Cache read     : {_fmtk(row['cr'])}")
    print(f"  Sessions       : {row['sessions']}")
    print(f"  Turns          : {row['turns']}")
    print(f"  Estimated cost : {_fmt_cost(total_cost)}")

    if model_rows:
        print(f"\nBy model:")
        for r in sorted(model_rows, key=lambda x: x["inp"] + x["out"], reverse=True):
            m = r["primary_model"] or "unknown"
            c = compute_cost(r["inp"], r["out"], r["cw"], r["cr"], m, pricing)
            print(f"  {m:<40} {_fmtk(r['inp']+r['out']):>8} tok   {_fmt_cost(c)}")

    conn.close()


# ---------------------------------------------------------------------------
# tips command
# ---------------------------------------------------------------------------

def cmd_tips(args) -> None:
    from token_dashboard.scanner import open_db
    from token_dashboard.tips import generate_tips

    conn = open_db(args.db)
    tips = generate_tips(conn)
    conn.close()

    if not tips:
        print("No tips — your usage looks clean!")
        return

    icons = {"warning": "⚠", "info": "ℹ"}
    for tip in tips:
        icon = icons.get(tip["severity"], "•")
        print(f"\n{icon}  {tip['title']}")
        print(f"   {tip['detail']}")


# ---------------------------------------------------------------------------
# dashboard command
# ---------------------------------------------------------------------------

def _background_scan(projects_dir: str, db: str, pricing: dict) -> None:
    from token_dashboard.scanner import scan
    while True:
        try:
            scan(projects_dir, db, pricing)
        except Exception:
            pass
        import time
        time.sleep(30)


def cmd_dashboard(args) -> None:
    from token_dashboard.scanner import scan
    from token_dashboard.server import make_server

    pricing = _load_pricing()

    if not args.no_scan:
        print(f"Initial scan of {args.projects_dir} …", end=" ", flush=True)
        stats = scan(args.projects_dir, args.db, pricing, verbose=False)
        print(f"{stats['scanned']} files scanned.")

    url = f"http://{args.host}:{args.port}"
    print(f"Dashboard → {url}")

    server = make_server(args.host, args.port, args.db, str(WEB_DIR), pricing)

    # Background refresh thread
    t = Thread(
        target=_background_scan,
        args=(args.projects_dir, args.db, pricing),
        daemon=True,
    )
    t.start()

    if not args.no_open:
        # Give server a moment to bind before opening browser
        import time
        time.sleep(0.3)
        webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def _add_common(parser):
    parser.add_argument(
        "--projects-dir",
        default=DEFAULT_PROJECTS_DIR,
        help=f"Path to Claude projects directory (default: {DEFAULT_PROJECTS_DIR})",
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB,
        help=f"SQLite cache path (default: {DEFAULT_DB})",
    )


def main():
    root = argparse.ArgumentParser(
        prog="cli.py",
        description="Token Dashboard — local analytics for Claude Code sessions",
    )
    sub = root.add_subparsers(dest="command")

    # scan
    p = sub.add_parser("scan", help="Populate/refresh DB, then exit")
    _add_common(p)
    p.add_argument("-v", "--verbose", action="store_true")

    # today
    p = sub.add_parser("today", help="Print today's totals")
    _add_common(p)

    # stats
    p = sub.add_parser("stats", help="Print all-time totals")
    _add_common(p)

    # tips
    p = sub.add_parser("tips", help="Print active suggestions")
    _add_common(p)

    # dashboard
    p = sub.add_parser("dashboard", help="Serve the web dashboard")
    _add_common(p)
    p.add_argument("--host", default=DEFAULT_HOST)
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--no-open", action="store_true", help="Don't auto-open the browser")
    p.add_argument("--no-scan", action="store_true", help="Skip initial scan")

    args = root.parse_args()
    if not args.command:
        root.print_help()
        sys.exit(0)

    {
        "scan": cmd_scan,
        "today": cmd_today,
        "stats": cmd_stats,
        "tips": cmd_tips,
        "dashboard": cmd_dashboard,
    }[args.command](args)


if __name__ == "__main__":
    main()
