import os
import re
import json
import csv
import io
import time
import asyncio
import sqlite3
from pathlib import Path
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional

import httpx
from alembic.config import Config as AlembicConfig
from alembic import command as alembic_command
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.middleware.sessions import SessionMiddleware

from jose import jwt, JWTError

from deps import get_current_user, require_user, JWT_SECRET, JWT_ALGORITHM
import auth as auth_module
import status as status_module
import analytics as analytics_module

_docs_enabled = os.environ.get("ENABLE_DOCS", "0") in ("1", "true", "True")
app = FastAPI(
    title="MCLabs Tools",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

# Session middleware — required for Discord OAuth state parameter
app.add_middleware(SessionMiddleware, secret_key=JWT_SECRET)

# Rate limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — locked to configured origins in production
_cors_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:8000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

# Body size cap — reject POST bodies larger than 1 MB
_MAX_BODY = 1_048_576

@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    if request.method == "POST":
        cl = request.headers.get("content-length")
        if cl and int(cl) > _MAX_BODY:
            return JSONResponse(status_code=413, content={"detail": "Request body too large"})
    return await call_next(request)


# Cookie-free usage analytics — counts hits and daily unique visitors in SQLite
@app.middleware("http")
async def track_analytics(request: Request, call_next):
    response = await call_next(request)
    analytics_module.record(request, response.status_code)
    return response


def _token_valid(token: Optional[str]) -> bool:
    if not token:
        return False
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return True
    except JWTError:
        return False


@app.middleware("http")
async def rolling_session(request: Request, call_next):
    """Keep logged-in users logged in: when the short-lived access token has
    expired but the refresh token is still valid, mint a fresh access token for
    this request and re-issue both cookies on the way out (sliding expiration),
    so active users never get silently logged out."""
    reissue_uid = None
    if not _token_valid(request.cookies.get("access_token")):
        refresh = request.cookies.get("refresh_token")
        if _token_valid(refresh):
            try:
                reissue_uid = int(jwt.decode(refresh, JWT_SECRET, algorithms=[JWT_ALGORITHM])["sub"])
                # Make the new access token visible to this request's handlers.
                request.cookies["access_token"] = auth_module._make_jwt(
                    reissue_uid, auth_module.ACCESS_TOKEN_EXPIRE)
            except (JWTError, KeyError, ValueError):
                reissue_uid = None

    response = await call_next(request)
    if reissue_uid is not None:
        auth_module._set_auth_cookies(response, reissue_uid)
    return response

app.include_router(auth_module.router, prefix="/auth")

DATA_FILE = Path(__file__).parent / "data" / "crops.json"
DB_FILE   = Path(__file__).parent / "data" / "history.db"
SHEET_ID  = "1cOKyTKjOaAdyBKyJy9654gPjT6aYkme-EMEfRZWazew"

# Purity multipliers: index = level (0-3)
PURITY_MULTIPLIERS = [1.00, 1.15, 1.30, 1.50]

# One full inventory = 36 storable slots * 64 items. Prestige goals are quoted
# in "inventories" in-game but tracked in raw item counts in the menu dump.
INVENTORY_SIZE = 2304

PRESTIGE_REQUIREMENTS = {
    "wheatium":    806400,
    "betronium":   576000,
    "nethwartium": 806400,
    "potatium":    1105920,
    "carrotenium": 1036800,
    "sweeberrium": 368640,
    "cocobium":    806400,
    "chorufrium":  230400,
    "paprium":     806400,
    "sugrium":     460800,
    "cactium":     1382400,
    "pumpkonium":  2188800,
    "melonium":    921600,
    "globerrium":  921600,
}


# ── SQLite history helpers ────────────────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_FILE))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_meta(key: str) -> Optional[str]:
    conn = get_db()
    row = conn.execute("SELECT value FROM app_meta WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else None


def set_meta(key: str, value: str):
    conn = get_db()
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value))
    )
    conn.commit()
    conn.close()


def migrate_json_to_db():
    """One-time migration from history.json to SQLite if it exists."""
    old_file = DATA_FILE.parent / "history.json"
    if not old_file.exists():
        return
    with open(old_file) as f:
        data = json.load(f)
    conn = get_db()
    for crop_id, entries in data.items():
        for entry in entries:
            conn.execute(
                "INSERT OR IGNORE INTO price_history (crop_id, date, price) VALUES (?,?,?)",
                (crop_id, entry["date"], entry["price"])
            )
    conn.commit()
    conn.close()
    old_file.rename(old_file.with_suffix(".json.bak"))


def seed_history_from_crops():
    """Seed DB with current/previous prices if table is empty."""
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0]
    if count == 0:
        with open(DATA_FILE) as f:
            crops = json.load(f)
        for c in crops:
            if c.get("previous_price") is not None:
                conn.execute(
                    "INSERT OR IGNORE INTO price_history (crop_id, date, price) VALUES (?,?,?)",
                    (c["id"], "2026-05-22", c["previous_price"])
                )
            if c.get("current_price") is not None:
                conn.execute(
                    "INSERT OR IGNORE INTO price_history (crop_id, date, price) VALUES (?,?,?)",
                    (c["id"], "2026-05-28", c["current_price"])
                )
        conn.commit()
    conn.close()


def load_history() -> dict:
    conn = get_db()
    rows = conn.execute(
        "SELECT crop_id, date, price FROM price_history ORDER BY crop_id, date"
    ).fetchall()
    conn.close()
    result: dict[str, list] = {}
    for row in rows:
        result.setdefault(row["crop_id"], []).append(
            {"date": row["date"], "price": row["price"]}
        )
    return result


def upsert_history(crop_id: str, record_date: str, price: float):
    conn = get_db()
    conn.execute(
        "INSERT INTO price_history (crop_id, date, price) VALUES (?,?,?) "
        "ON CONFLICT(crop_id, date) DO UPDATE SET price=excluded.price",
        (crop_id, record_date, price)
    )
    conn.commit()
    conn.close()


# ── Startup: migrate and seed ────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    _backend = Path(__file__).parent
    cfg = AlembicConfig(str(_backend / "alembic.ini"))
    cfg.set_main_option("script_location", str(_backend / "alembic"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{_backend / 'data' / 'history.db'}")
    alembic_command.upgrade(cfg, "head")
    migrate_json_to_db()
    try:
        seed_history_from_crops()
    except FileNotFoundError:
        pass  # crops.json absent on fresh install; will populate after first /api/sync
    asyncio.create_task(vote_notify_loop())
    asyncio.create_task(status_module.status_check_loop(get_db))


# ── Crops helpers ─────────────────────────────────────────────────────────────

def load_crops() -> list[dict]:
    with open(DATA_FILE) as f:
        crops = json.load(f)

    price_map = {c["name"]: c["current_price"] for c in crops if c["current_price"] is not None}

    for c in crops:
        if c["current_price"] is not None and c["previous_price"] is not None:
            c["change"] = round(c["current_price"] - c["previous_price"], 2)
            c["change_pct"] = round(c["change"] / c["previous_price"] * 100, 1)
        else:
            c["change"] = None
            c["change_pct"] = None

        c["craft_profit"] = None
        c["craft_input_cost"] = None
        c["craft_output_value"] = None
        if c["recipe"] and c["output_qty"] and c["current_price"] is not None:
            input_cost = 0.0
            known = True
            for ing_name, qty in c["recipe"].items():
                ing_price = price_map.get(ing_name)
                if ing_price is None:
                    known = False
                    break
                input_cost += qty * ing_price
            if known:
                output_val = c["output_qty"] * c["current_price"]
                c["craft_input_cost"] = round(input_cost, 2)
                c["craft_output_value"] = round(output_val, 2)
                c["craft_profit"] = round(output_val - input_cost, 2)

    return crops


# ── API routes ────────────────────────────────────────────────────────────────

@app.get("/api/crops")
def get_crops(category: Optional[str] = None, sort: str = "price"):
    crops = load_crops()
    if category:
        crops = [c for c in crops if c["category"] == category]
    if sort == "price":
        return sorted(crops, key=lambda x: (x["current_price"] or 0), reverse=True)
    if sort == "change":
        return sorted(crops, key=lambda x: (x["change_pct"] or 0), reverse=True)
    if sort == "profit":
        return sorted(crops, key=lambda x: (x["craft_profit"] or 0), reverse=True)
    return crops


@app.get("/api/crops/top")
def get_top_picks():
    crops = load_crops()
    with_price = [c for c in crops if c["current_price"] is not None]
    combos_with_profit = [c for c in with_price if c["craft_profit"] is not None]
    return {
        "best_price": max(with_price, key=lambda x: x["current_price"]),
        "best_craft_profit": max(combos_with_profit, key=lambda x: x["craft_profit"]) if combos_with_profit else None,
        "trending_up": sorted([c for c in with_price if (c["change"] or 0) > 0], key=lambda x: x["change_pct"], reverse=True)[:3],
        "trending_down": sorted([c for c in with_price if (c["change"] or 0) < 0], key=lambda x: x["change_pct"])[:3],
    }


@app.get("/api/history")
def get_history():
    return load_history()


@app.get("/api/purity-multipliers")
def get_purity_multipliers():
    return {"multipliers": PURITY_MULTIPLIERS}


@app.get("/api/prestige")
def get_prestige():
    crops = load_crops()
    result = []
    for c in crops:
        if c["id"] not in PRESTIGE_REQUIREMENTS:
            continue
        result.append({
            "id": c["id"],
            "name": c["name"],
            "minecraft_name": c["minecraft_name"],
            "emoji": c["emoji"],
            "icon": c.get("icon"),
            "requirement": PRESTIGE_REQUIREMENTS[c["id"]],
            "current_price": c["current_price"],
        })
    return sorted(result, key=lambda x: x["requirement"])


# ── Prestige progress tracker (uploaded menu dumps) ───────────────────────────

_PROG_RE      = re.compile(r"(\d[\d,]*)\s*/\s*(\d[\d,]*)")
_TITLE_RE     = re.compile(r"(Chems|Police)\s*-\s*(.+)", re.IGNORECASE)
_VERB_RE      = re.compile(r"^(sell|collect|craft|harvest|mine)\s+", re.IGNORECASE)
_INVENTORY_RE = re.compile(r"(\d[\d,]*)\s+inventor")


def _slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _join_text(node) -> str:
    """Flatten a Minecraft text component (string | {text, extra:[...]}) to a string."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    parts = []
    if isinstance(node, dict):
        if node.get("text"):
            parts.append(node["text"])
        for ex in node.get("extra", []):
            parts.append(_join_text(ex))
    return "".join(parts)


def _lore_lines(lore) -> list[str]:
    return [_join_text(line) for line in (lore or [])]


def parse_prestige_dump(data) -> list[dict]:
    """Extract prestige objectives from a pasted/uploaded inventory JSON dump.

    Accepts either a top-level list of {slot, item} entries, or an object with
    an `items`/`slots` array. Filters out non-objective fluff (the chest's other
    contents) by keeping only items whose name matches '<Chems|Police> - ...'.
    """
    if isinstance(data, dict):
        data = data.get("items") or data.get("slots") or []
    if not isinstance(data, list):
        return []

    crops = load_crops()
    name_to_crop = {c["name"].lower(): c for c in crops}

    out, seen = [], set()
    for entry in data:
        if not isinstance(entry, dict):
            continue
        item = entry.get("item")
        if not isinstance(item, dict):
            continue
        comps = item.get("components", {}) or {}
        title = _join_text(comps.get("minecraft:custom_name"))
        m = _TITLE_RE.search(title)
        if not m:
            continue
        category = m.group(1).capitalize()       # Chems / Police
        label = m.group(2).strip()

        current = goal = None
        for line in _lore_lines(comps.get("minecraft:lore")):
            pm = _PROG_RE.search(line)
            if pm:
                current = int(pm.group(1).replace(",", ""))
                goal = int(pm.group(2).replace(",", ""))
                break

        # Completed objectives have no progress bar — the game replaces it with
        # a reception date + reward line ("+1 ... Prestige Unlocked"). Backfill
        # current/goal from whatever the completed lore still tells us.
        if current is None or goal is None or goal <= 0:
            lore_flat = " ".join(_lore_lines(comps.get("minecraft:lore"))).lower()
            if "prestige unlocked" not in lore_flat:
                continue
            if category == "Chems":
                crop_key = _VERB_RE.sub("", label).strip().lower()
                tmp_crop = name_to_crop.get(crop_key)
                if tmp_crop and tmp_crop["id"] in PRESTIGE_REQUIREMENTS:
                    goal = PRESTIGE_REQUIREMENTS[tmp_crop["id"]]
                    current = goal  # completed means current == goal
                else:
                    continue
            else:
                # Police goals are quoted in "inventories" (e.g. "You have
                # confiscated 75 inventories of contraband.") — convert using
                # the same raw-item-count unit the in-progress bars use.
                inv_match = _INVENTORY_RE.search(lore_flat)
                if inv_match:
                    goal = int(inv_match.group(1).replace(",", "")) * INVENTORY_SIZE
                    current = goal
                else:
                    continue

        goal_text = ""
        lore_lines = _lore_lines(comps.get("minecraft:lore"))
        for i, line in enumerate(lore_lines):
            if line.strip().lower().startswith("goal"):
                for nxt in lore_lines[i + 1:]:
                    if nxt.strip():
                        goal_text = nxt.strip()
                        break
                break

        objective_id = _slugify(f"{category}-{label}")
        if objective_id in seen:
            continue
        seen.add(objective_id)

        crop = name_to_crop.get(_VERB_RE.sub("", label).strip().lower())
        out.append({
            "objective_id": objective_id,
            "category": category,
            "label": label,
            "goal_text": goal_text,
            "current": current,
            "goal": goal,
            "crop_id": crop["id"] if crop else None,
            "icon": crop.get("icon") if crop else None,
            "emoji": (crop["emoji"] if crop else ("🚔" if category == "Police" else "📦")),
        })
    return out


def _enrich_objective(label: str, category: str, name_to_crop: dict) -> dict:
    crop = name_to_crop.get(_VERB_RE.sub("", label).strip().lower())
    return {
        "crop_id": crop["id"] if crop else None,
        "icon": crop.get("icon") if crop else None,
        "emoji": (crop["emoji"] if crop else ("🚔" if category == "Police" else "📦")),
    }


@app.post("/api/prestige/upload")
@limiter.limit("10/minute")
async def upload_prestige(request: Request, user: dict = Depends(require_user)):
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body is not valid JSON")

    parsed = parse_prestige_dump(data)
    if not parsed:
        raise HTTPException(
            status_code=422,
            detail="No prestige objectives found — expected items named 'Chems - ...' or 'Police - ...'",
        )

    now_ms = int(time.time() * 1000)
    user_id = user["id"]
    conn = get_db()

    # Skip storing a snapshot that is byte-identical to the most recent one.
    last = conn.execute(
        "SELECT MAX(taken_at) AS t FROM prestige_progress WHERE user_id=?", (user_id,)
    ).fetchone()
    inserted = True
    if last and last["t"]:
        prev = {r["objective_id"]: r["current"] for r in conn.execute(
            "SELECT objective_id, current FROM prestige_progress WHERE user_id=? AND taken_at=?",
            (user_id, last["t"]))}
        if len(prev) == len(parsed) and all(
                prev.get(o["objective_id"]) == o["current"] for o in parsed):
            inserted = False

    if inserted:
        for o in parsed:
            conn.execute(
                "INSERT OR REPLACE INTO prestige_progress "
                "(user_id, taken_at, objective_id, category, label, goal_text, current, goal) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (user_id, now_ms, o["objective_id"], o["category"], o["label"],
                 o["goal_text"], o["current"], o["goal"]),
            )
        conn.commit()
    conn.close()

    return {
        "inserted": inserted,
        "taken_at": now_ms,
        "count": len(parsed),
        "objectives": parsed,
        "inventory_size": INVENTORY_SIZE,
    }


@app.get("/api/prestige/progress")
def get_prestige_progress(user: dict = Depends(require_user)):
    conn = get_db()
    rows = conn.execute(
        "SELECT taken_at, objective_id, category, label, goal_text, current, goal "
        "FROM prestige_progress WHERE user_id=? ORDER BY taken_at, objective_id",
        (user["id"],)
    ).fetchall()
    conn.close()

    name_to_crop = {c["name"].lower(): c for c in load_crops()}
    objectives: dict[str, dict] = {}
    snapshots: list[int] = []
    for r in rows:
        if not snapshots or snapshots[-1] != r["taken_at"]:
            if r["taken_at"] not in snapshots:
                snapshots.append(r["taken_at"])
        oid = r["objective_id"]
        obj = objectives.get(oid)
        if obj is None:
            obj = {
                "objective_id": oid,
                "category": r["category"],
                "label": r["label"],
                "goal_text": r["goal_text"],
                "goal": r["goal"],
                "history": [],
                **_enrich_objective(r["label"], r["category"], name_to_crop),
            }
            objectives[oid] = obj
        obj["goal"] = r["goal"]              # keep the most recent goal value
        obj["goal_text"] = r["goal_text"] or obj["goal_text"]
        obj["history"].append({"t": r["taken_at"], "current": r["current"]})

    return {
        "snapshots": sorted(set(snapshots)),
        "objectives": list(objectives.values()),
        "inventory_size": INVENTORY_SIZE,
    }


@app.delete("/api/prestige/progress")
def clear_prestige_progress(taken_at: Optional[int] = None, user: dict = Depends(require_user)):
    conn = get_db()
    if taken_at:
        conn.execute(
            "DELETE FROM prestige_progress WHERE user_id=? AND taken_at=?",
            (user["id"], taken_at)
        )
    else:
        conn.execute("DELETE FROM prestige_progress WHERE user_id=?", (user["id"],))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Vote tracker ──────────────────────────────────────────────────────────────

# Reset models (must mirror VOTE_SITES in frontend/app.js):
#   reset_hour_pt: fixed daily reset at this Pacific-time hour (24h clock)
#   cooldown:      rolling N hours measured from the moment you voted
VOTE_SITES = [
    {"id": "msl",   "name": "Minecraft Server List", "reset_hour_pt": 16},
    {"id": "buzz",  "name": "Minecraft Buzz",        "cooldown": 24},
    {"id": "mp",    "name": "Minecraft MP",          "reset_hour_pt": 21},
    {"id": "topg",  "name": "TopG.org",              "reset_hour_pt": 19},
    {"id": "msorg", "name": "MinecraftServers.org",  "reset_hour_pt": 17},
    {"id": "pmc",   "name": "Planet Minecraft",      "reset_hour_pt": 21},
    {"id": "tms",   "name": "Top MC Servers",        "reset_hour_pt": 21},
]
VOTE_SITE_IDS = {s["id"] for s in VOTE_SITES}
PT_TZ = ZoneInfo("America/Los_Angeles")


def next_pacific_reset(after_ms: int, hour_pt: int) -> int:
    """Epoch ms of the next time Pacific clock hits hour_pt:00, strictly after after_ms."""
    after = datetime.fromtimestamp(after_ms / 1000, PT_TZ)
    cand = after.replace(hour=hour_pt, minute=0, second=0, microsecond=0)
    if cand <= after:
        cand += timedelta(days=1)
    return int(cand.timestamp() * 1000)


def site_ready_at(site: dict, voted_ms: int) -> int:
    """Epoch ms when a site becomes votable again after a vote at voted_ms (0 if never voted)."""
    if not voted_ms:
        return 0
    if "reset_hour_pt" in site:
        return next_pacific_reset(voted_ms, site["reset_hour_pt"])
    return voted_ms + site.get("cooldown", 24) * 3600000


def load_votes_map(user_id: int) -> dict:
    conn = get_db()
    rows = conn.execute("SELECT site_id, voted_at FROM vote_log WHERE user_id=?", (user_id,)).fetchall()
    conn.close()
    return {row["site_id"]: row["voted_at"] for row in rows}


def all_ready_at(votes: dict):
    """Return (epoch_ms_when_all_7_votable, any_vote_recorded)."""
    times, any_voted = [], False
    for s in VOTE_SITES:
        v = votes.get(s["id"], 0)
        if v:
            any_voted = True
        times.append(site_ready_at(s, v))
    return (max(times) if times else 0), any_voted


@app.get("/api/votes")
def get_votes(user: dict = Depends(require_user)):
    """Return { site_id: voted_at_ms } for the current user's recorded votes."""
    return load_votes_map(user["id"])


@app.post("/api/votes/{site_id}")
@limiter.limit("20/minute")
def record_vote(request: Request, site_id: str, user: dict = Depends(require_user)):
    """Record (or update) a vote for the given site as 'now' (epoch ms)."""
    if site_id not in VOTE_SITE_IDS:
        raise HTTPException(status_code=404, detail="Unknown vote site")
    now_ms = int(time.time() * 1000)
    conn = get_db()
    conn.execute(
        "INSERT INTO vote_log (user_id, site_id, voted_at) VALUES (?,?,?) "
        "ON CONFLICT(user_id, site_id) DO UPDATE SET voted_at=excluded.voted_at",
        (user["id"], site_id, now_ms)
    )
    conn.commit()
    conn.close()
    return {"site_id": site_id, "voted_at": now_ms}


# ── ntfy push notifications ───────────────────────────────────────────────────

def get_vote_config(user_id: int) -> dict:
    """ntfy config for a specific user from user_settings."""
    conn = get_db()
    row = conn.execute(
        "SELECT ntfy_topic, ntfy_server, ntfy_enabled FROM user_settings WHERE user_id=?", (user_id,)
    ).fetchone()
    conn.close()
    if row:
        return {
            "topic":   row["ntfy_topic"]  or os.environ.get("NTFY_TOPIC", ""),
            "server":  row["ntfy_server"] or os.environ.get("NTFY_SERVER", "https://ntfy.sh"),
            "enabled": bool(row["ntfy_enabled"]),
            "app_url": os.environ.get("APP_URL", ""),
        }
    return {
        "topic":   os.environ.get("NTFY_TOPIC", ""),
        "server":  os.environ.get("NTFY_SERVER", "https://ntfy.sh"),
        "enabled": os.environ.get("NTFY_ENABLED", "0") in ("1", "true", "True"),
        "app_url": os.environ.get("APP_URL", ""),
    }


def _ascii_header(s: str) -> str:
    """HTTP header values must be ASCII. Swap common unicode punctuation and
    drop anything else non-ASCII so ntfy's Title header never errors."""
    s = s.replace("—", "-").replace("–", "-").replace("…", "...")
    return s.encode("ascii", "ignore").decode("ascii").strip()


async def send_ntfy(cfg: dict, title: str, message: str):
    if not cfg.get("topic"):
        raise HTTPException(status_code=400, detail="No ntfy topic configured")
    url = f"{cfg['server'].rstrip('/')}/{cfg['topic']}"
    headers = {
        "Title": _ascii_header(title),
        "Priority": "high",
        "Tags": "ballot_box,money_with_wings",
    }
    if cfg.get("app_url"):
        headers["Click"] = cfg["app_url"]
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(url, content=message.encode("utf-8"), headers=headers)
    resp.raise_for_status()


class VoteConfigBody(BaseModel):
    topic: Optional[str] = None
    server: Optional[str] = None
    enabled: Optional[bool] = None


@app.get("/api/vote-config")
def get_vote_config_route(user: dict = Depends(require_user)):
    cfg = get_vote_config(user["id"])
    return {"topic": cfg["topic"], "server": cfg["server"], "enabled": cfg["enabled"]}


@app.post("/api/vote-config")
def set_vote_config_route(body: VoteConfigBody, user: dict = Depends(require_user)):
    conn = get_db()
    conn.execute("""
        INSERT INTO user_settings (user_id, ntfy_topic, ntfy_server, ntfy_enabled)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            ntfy_topic    = COALESCE(?, ntfy_topic),
            ntfy_server   = COALESCE(?, ntfy_server),
            ntfy_enabled  = COALESCE(?, ntfy_enabled)
    """, (
        user["id"],
        body.topic.strip() if body.topic is not None else "",
        body.server.strip() or "https://ntfy.sh" if body.server is not None else "https://ntfy.sh",
        1 if (body.enabled if body.enabled is not None else False) else 0,
        body.topic.strip() if body.topic is not None else None,
        body.server.strip() or "https://ntfy.sh" if body.server is not None else None,
        (1 if body.enabled else 0) if body.enabled is not None else None,
    ))
    conn.commit()
    conn.close()
    cfg = get_vote_config(user["id"])
    return {"topic": cfg["topic"], "server": cfg["server"], "enabled": cfg["enabled"]}


@app.post("/api/vote-test-push")
async def vote_test_push(user: dict = Depends(require_user)):
    cfg = get_vote_config(user["id"])
    try:
        await send_ntfy(cfg, "MCLabs — Test Notification",
                        "If you can read this on your phone, vote alerts are working! 🗳️")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ntfy push failed: {e}")
    return {"ok": True, "sent_to": f"{cfg['server'].rstrip('/')}/{cfg['topic']}"}


async def vote_notify_loop():
    """Background poll: push ntfy alerts per-user when all 7 sites become votable."""
    await asyncio.sleep(5)
    while True:
        try:
            conn = get_db()
            enabled_users = conn.execute("""
                SELECT us.user_id, us.ntfy_topic, us.ntfy_server, us.last_notify_sent_at
                FROM user_settings us
                WHERE us.ntfy_enabled=1 AND us.ntfy_topic != ''
            """).fetchall()
            conn.close()

            now_ms = int(time.time() * 1000)
            app_url = os.environ.get("APP_URL", "")

            for row in enabled_users:
                try:
                    votes = load_votes_map(row["user_id"])
                    ready_ms, any_voted = all_ready_at(votes)
                    last_sent = row["last_notify_sent_at"]
                    if any_voted and ready_ms > 0 and now_ms >= ready_ms and \
                            (last_sent is None or last_sent != ready_ms):
                        cfg = {
                            "topic":   row["ntfy_topic"],
                            "server":  row["ntfy_server"],
                            "app_url": app_url,
                        }
                        await send_ntfy(cfg, "MCLabs — Vote Ready!",
                                        "All 7 vote sites have reset. Vote now to earn rewards! 🗳️💸")
                        upd = get_db()
                        upd.execute(
                            "UPDATE user_settings SET last_notify_sent_at=? WHERE user_id=?",
                            (ready_ms, row["user_id"])
                        )
                        upd.commit()
                        upd.close()
                except Exception as e:
                    print(f"[vote-notify] user {row['user_id']} error: {e}")
        except Exception as e:
            print(f"[vote-notify] error: {e}")
        await asyncio.sleep(60)


@app.post("/api/sync")
@limiter.limit("2/minute")
async def sync_prices(request: Request, user: dict = Depends(require_user)):
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url)
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch spreadsheet: {e}")

    reader = csv.reader(io.StringIO(resp.text))
    rows = list(reader)
    crops = load_crops()
    name_map = {c["name"].lower(): c for c in crops}
    updated = 0
    today = date.today().isoformat()

    for row in rows:
        if len(row) < 2:
            continue
        name = row[0].strip().lower()
        if name not in name_map:
            continue
        try:
            new_price = float(row[1].replace("$", "").replace(",", "").strip())
            crop = name_map[name]
            if abs((crop["current_price"] or 0) - new_price) > 0.001:
                crop["previous_price"] = crop["current_price"]
                crop["current_price"] = new_price
                updated += 1
                upsert_history(crop["id"], today, new_price)
        except (ValueError, IndexError):
            continue

    save_fields = {"id", "name", "minecraft_name", "emoji", "icon", "category",
                   "recipe_type", "recipe", "output_qty", "current_price",
                   "previous_price"}
    save_data = [{k: v for k, v in c.items() if k in save_fields} for c in crops]
    tmp = DATA_FILE.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(save_data, f, indent=2)
    os.replace(tmp, DATA_FILE)

    return {"updated": updated, "synced_at": today}


# Note: behind Caddy all clients share one limiter identity (uvicorn runs
# without --proxy-headers), so this bucket is site-wide. The 30s payload
# cache in status.py makes these requests ~free; the limit is abuse-bounding.
@app.get("/api/status")
@limiter.limit("120/minute")
def server_status(request: Request):
    try:
        return status_module.get_status_payload(get_db)
    except Exception as e:
        print(f"[status] payload error: {e}")
        raise HTTPException(status_code=503, detail="Status temporarily unavailable")


@app.get("/api/layout")
def get_layout(width: int = 18, length: int = 18):
    if width > 100 or length > 100:
        raise HTTPException(status_code=400, detail="Max dimension is 100 blocks")
    if width < 1 or length < 1:
        raise HTTPException(status_code=400, detail="Dimensions must be positive")

    water_sources: set[tuple[int, int]] = set()
    r = min(4, length - 1)
    while r < length:
        c = min(4, width - 1)
        while c < width:
            water_sources.add((r, c))
            c += 9
        r += 9

    grid = []
    crop_count = 0
    for r in range(length):
        row = []
        for c in range(width):
            if (r, c) in water_sources:
                row.append("water")
            elif any(max(abs(r - wr), abs(c - wc)) <= 4 for wr, wc in water_sources):
                row.append("crop")
                crop_count += 1
            else:
                row.append("empty")
        grid.append(row)

    return {
        "grid": grid,
        "width": width,
        "length": length,
        "crop_count": crop_count,
        "water_count": len(water_sources),
        "empty_count": width * length - crop_count - len(water_sources),
        "efficiency": round(crop_count / (width * length) * 100, 1),
    }


# ── Static files ──────────────────────────────────────────────────────────────

frontend_dir = Path(__file__).parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

    @app.get("/")
    def index():
        return FileResponse(str(frontend_dir / "index.html"))
