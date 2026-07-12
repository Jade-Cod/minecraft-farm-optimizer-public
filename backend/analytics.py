"""Cookie-free usage analytics.

Counts per-day/per-path hits and daily unique visitors. A visitor is
sha256(secret + date + ip + user-agent) — nothing identifying is stored, the
hash can't be reversed without the server secret, and it rotates daily
(same trick Plausible uses). No cookies, no client JS, no consent banner.

Not exposed over HTTP by design. Read the numbers with:
    docker exec mclabs-tools python analytics.py [days]
"""
import hashlib
import sqlite3
import sys
from datetime import date, timedelta

from fastapi import Request

from deps import DB_FILE, JWT_SECRET


def record(request: Request, status_code: int) -> None:
    """Count one request. Never raises — analytics must not break the app."""
    path = request.url.path
    if status_code >= 400 or not (path == "/" or path.startswith("/api/")):
        return
    try:
        today = date.today().isoformat()
        ip = request.client.host if request.client else ""
        ua = request.headers.get("user-agent", "")
        visitor = hashlib.sha256(f"{JWT_SECRET}{today}{ip}{ua}".encode()).hexdigest()[:16]
        conn = sqlite3.connect(str(DB_FILE))
        try:
            conn.execute(
                "INSERT INTO analytics_hits (date, path, count) VALUES (?,?,1) "
                "ON CONFLICT(date, path) DO UPDATE SET count = count + 1",
                (today, path),
            )
            conn.execute(
                "INSERT OR IGNORE INTO analytics_visitors (date, visitor) VALUES (?,?)",
                (today, visitor),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print(f"[analytics] record error: {e}")


def stats(days: int = 30) -> dict:
    days = max(1, min(days, 365))
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    conn = sqlite3.connect(str(DB_FILE))
    conn.row_factory = sqlite3.Row
    try:
        daily = [dict(r) for r in conn.execute(
            "SELECT h.date, SUM(h.count) AS hits, "
            "       (SELECT COUNT(*) FROM analytics_visitors v WHERE v.date = h.date) AS visitors "
            "FROM analytics_hits h WHERE h.date >= ? GROUP BY h.date ORDER BY h.date",
            (since,),
        )]
        top_paths = [dict(r) for r in conn.execute(
            "SELECT path, SUM(count) AS hits FROM analytics_hits "
            "WHERE date >= ? GROUP BY path ORDER BY hits DESC LIMIT 20",
            (since,),
        )]
    finally:
        conn.close()
    return {
        "since": since,
        "daily": daily,
        "top_paths": top_paths,
        "totals": {
            "hits": sum(d["hits"] for d in daily),
            "visitors": sum(d["visitors"] for d in daily),
        },
    }


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    s = stats(days)
    print(f"Since {s['since']}: {s['totals']['visitors']} daily-unique visitors, "
          f"{s['totals']['hits']} hits\n")
    print(f"{'date':<12}{'visitors':>9}{'hits':>7}")
    for d in s["daily"]:
        print(f"{d['date']:<12}{d['visitors']:>9}{d['hits']:>7}")
    print(f"\n{'path':<40}{'hits':>7}")
    for p in s["top_paths"]:
        print(f"{p['path']:<40}{p['hits']:>7}")
