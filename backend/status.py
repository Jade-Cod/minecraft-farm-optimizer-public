"""Uptime monitoring for the Minecraft server.

A background loop pings the server once a minute using the vanilla
Server List Ping protocol (raw TCP, no dependencies) and stores one row
per check in SQLite. /api/status aggregates those rows into the payload
the Status tab renders (current state, uptime %, hourly heatmap, events).
"""
import asyncio
import json
import os
import re
import struct
import time

STATUS_HOST = os.environ.get("STATUS_HOST", "play.labs-mc.com")
STATUS_PORT = int(os.environ.get("STATUS_PORT", "25565"))
CHECK_INTERVAL_S = 60
PING_TIMEOUT_S = 5.0
RETENTION_S = 90 * 86400      # keep 90 days of checks
WINDOW_S = 15 * 86400         # heatmap/events window: covers "last week" view

_MC_FORMAT_CODES = re.compile(r"§.")  # strip §-style color codes from version names


# ── Server List Ping protocol ────────────────────────────────────────────────

def pack_varint(n: int) -> bytes:
    """Encode an int as a Minecraft protocol VarInt (32-bit two's complement)."""
    n &= 0xFFFFFFFF
    out = b""
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out += bytes([b | 0x80])
        else:
            return out + bytes([b])


async def read_varint(reader: asyncio.StreamReader) -> int:
    num = 0
    for i in range(5):
        b = (await reader.readexactly(1))[0]
        num |= (b & 0x7F) << (7 * i)
        if not b & 0x80:
            return num
    raise ValueError("VarInt too long")


async def ping_server(host: str, port: int, timeout: float = PING_TIMEOUT_S) -> dict:
    """One Server List Ping. Returns latency/players/version; raises on any failure."""
    start = time.monotonic()
    reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
    try:
        addr = host.encode()
        # Handshake: packet 0x00, protocol -1 (status query), host, port, next-state 1
        handshake = (pack_varint(0x00) + pack_varint(-1)
                     + pack_varint(len(addr)) + addr
                     + struct.pack(">H", port) + pack_varint(1))
        # Status request: empty packet 0x00
        writer.write(pack_varint(len(handshake)) + handshake + pack_varint(1) + pack_varint(0x00))
        await writer.drain()

        async def read_response() -> dict:
            await read_varint(reader)                    # packet length
            await read_varint(reader)                    # packet id (0x00)
            json_len = await read_varint(reader)
            if json_len > 1_048_576:
                raise ValueError("status response too large")
            raw = await reader.readexactly(json_len)
            return json.loads(raw)

        status = await asyncio.wait_for(read_response(), timeout)
        latency_ms = int((time.monotonic() - start) * 1000)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass

    players = status.get("players", {})
    version = _MC_FORMAT_CODES.sub("", str(status.get("version", {}).get("name", "")))[:64]
    return {
        "latency_ms": latency_ms,
        "players": players.get("online"),
        "max_players": players.get("max"),
        "version": version or None,
    }


# ── Check loop ───────────────────────────────────────────────────────────────

async def status_check_loop(get_db):
    """Ping the server every CHECK_INTERVAL_S and record the result."""
    await asyncio.sleep(3)  # let startup finish (migrations already ran)
    while True:
        ts = int(time.time())
        try:
            res = await ping_server(STATUS_HOST, STATUS_PORT)
        except Exception:
            res = None
        try:
            conn = get_db()
            conn.execute(
                "INSERT OR REPLACE INTO status_checks (ts, online, latency_ms, players, max_players, version) "
                "VALUES (?,?,?,?,?,?)",
                (ts, 1 if res else 0,
                 res["latency_ms"] if res else None,
                 res["players"] if res else None,
                 res["max_players"] if res else None,
                 res["version"] if res else None),
            )
            conn.execute("DELETE FROM status_checks WHERE ts < ?", (ts - RETENTION_S,))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[status] db error: {e}")
        await asyncio.sleep(CHECK_INTERVAL_S)


# ── API payload ──────────────────────────────────────────────────────────────

def get_status_payload(get_db) -> dict:
    now = int(time.time())
    conn = get_db()

    latest = conn.execute(
        "SELECT ts, online, latency_ms, players, max_players, version "
        "FROM status_checks ORDER BY ts DESC LIMIT 1"
    ).fetchone()

    def uptime_pct(window_s: int):
        row = conn.execute(
            "SELECT COUNT(*) AS total, COALESCE(SUM(online),0) AS ok "
            "FROM status_checks WHERE ts > ?", (now - window_s,)
        ).fetchone()
        return round(row["ok"] / row["total"] * 100, 2) if row["total"] else None

    # Start of the current up/down streak: the check after the last opposite state.
    since = None
    if latest is not None:
        flip = conn.execute(
            "SELECT MAX(ts) AS ts FROM status_checks WHERE online != ?", (latest["online"],)
        ).fetchone()
        since = flip["ts"] if flip["ts"] is not None else \
            conn.execute("SELECT MIN(ts) AS ts FROM status_checks").fetchone()["ts"]

    hours = conn.execute(
        "SELECT (ts/3600)*3600 AS hour, COUNT(*) AS total, COALESCE(SUM(online),0) AS ok "
        "FROM status_checks WHERE ts > ? GROUP BY hour ORDER BY hour",
        (now - WINDOW_S,)
    ).fetchall()

    transitions = conn.execute(
        "SELECT ts, online FROM ("
        "  SELECT ts, online, LAG(online) OVER (ORDER BY ts) AS prev"
        "  FROM status_checks WHERE ts > ?"
        ") WHERE prev IS NOT NULL AND online != prev ORDER BY ts",
        (now - WINDOW_S,)
    ).fetchall()
    uptime = {"h24": uptime_pct(86400), "d7": uptime_pct(7 * 86400)}
    conn.close()

    events = []
    last_down_ts = None
    for t in transitions:
        if t["online"]:
            events.append({"ts": t["ts"], "type": "up",
                           "down_for_s": (t["ts"] - last_down_ts) if last_down_ts else None})
        else:
            last_down_ts = t["ts"]
            events.append({"ts": t["ts"], "type": "down"})
    events.reverse()  # newest first

    return {
        "host": STATUS_HOST,
        "now": now,
        "current": dict(latest) if latest else None,
        "since": since,
        "uptime": uptime,
        "heatmap": [dict(h) for h in hours],
        "events": events[:20],
    }


# ── Self-check: python backend/status.py ────────────────────────────────────

if __name__ == "__main__":
    import sqlite3

    # VarInt round-trip, including the -1 protocol version (5-byte encoding)
    class _FakeReader:
        def __init__(self, data): self.data = data

        async def readexactly(self, n):
            out, self.data = self.data[:n], self.data[n:]
            return out

    async def _roundtrip(n):
        return await read_varint(_FakeReader(pack_varint(n)))

    for n in (0, 1, 127, 128, 300, 25565, 2**31 - 1):
        assert asyncio.run(_roundtrip(n)) == n, n
    assert pack_varint(-1) == b"\xff\xff\xff\xff\x0f"

    # Payload aggregation on an in-memory DB: 3h of checks with one 2-check outage
    shared = sqlite3.connect(":memory:")
    shared.row_factory = sqlite3.Row
    shared.execute("CREATE TABLE status_checks (ts INTEGER PRIMARY KEY, online INTEGER NOT NULL, "
                   "latency_ms INTEGER, players INTEGER, max_players INTEGER, version TEXT)")
    _now = int(time.time())
    for i in range(180):
        ts = _now - (179 - i) * 60
        online = 0 if 100 <= i < 102 else 1
        shared.execute("INSERT INTO status_checks VALUES (?,?,?,?,?,?)",
                       (ts, online, 42 if online else None, 7 if online else None, 200, "1.20.4"))
    shared.commit()

    def _get_db():
        # Wrapper over the shared memory db that, like a real conn, rejects use after close
        class P:
            closed = False

            def execute(self, *a):
                assert not self.closed, "query after close()"
                return shared.execute(*a)

            def close(self): self.closed = True
        return P()

    p = get_status_payload(_get_db)
    assert p["current"]["online"] == 1
    assert p["uptime"]["h24"] == round(178 / 180 * 100, 2)
    assert len(p["events"]) == 2
    assert p["events"][0]["type"] == "up" and p["events"][0]["down_for_s"] == 120
    assert p["events"][1]["type"] == "down"
    assert p["since"] == p["events"][0]["ts"] - 60  # streak measured from the last down check
    assert sum(h["total"] for h in p["heatmap"]) == 180
    assert sum(1 for h in p["heatmap"] if h["ok"] < h["total"]) in (1, 2)  # outage spans ≤2 buckets
    print("status.py self-check OK")
