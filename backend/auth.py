import os
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse, JSONResponse
from jose import jwt
from starlette.config import Config as StarletteConfig

from deps import JWT_SECRET, JWT_ALGORITHM, get_current_user

router = APIRouter()

DB_FILE = Path(__file__).parent / "data" / "history.db"

DISCORD_CLIENT_ID     = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI  = os.environ.get("DISCORD_REDIRECT_URI", "http://localhost:8000/auth/discord/callback")

_starlette_cfg = StarletteConfig(environ={
    "DISCORD_CLIENT_ID":     DISCORD_CLIENT_ID,
    "DISCORD_CLIENT_SECRET": DISCORD_CLIENT_SECRET,
})

oauth = OAuth(_starlette_cfg)
oauth.register(
    name="discord",
    client_id=DISCORD_CLIENT_ID,
    client_secret=DISCORD_CLIENT_SECRET,
    access_token_url="https://discord.com/api/oauth2/token",
    authorize_url="https://discord.com/api/oauth2/authorize",
    api_base_url="https://discord.com/api/",
    client_kwargs={"scope": "identify"},
)

ACCESS_TOKEN_EXPIRE  = 3600         # 1 hour
REFRESH_TOKEN_EXPIRE = 7 * 86400    # 7 days
_SECURE = os.environ.get("SECURE_COOKIES", "true").lower() not in ("0", "false", "no")
COOKIE_OPTS = dict(httponly=True, samesite="lax", secure=_SECURE)


def _make_jwt(sub: int, expire_seconds: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(seconds=expire_seconds)
    return jwt.encode({"sub": str(sub), "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_FILE))
    conn.row_factory = sqlite3.Row
    return conn


def _upsert_user(discord_id: str, username: str, avatar_url: Optional[str]) -> int:
    now_ms = int(time.time() * 1000)
    conn = _get_db()
    conn.execute("""
        INSERT INTO users (discord_id, username, avatar_url, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET
            username     = excluded.username,
            avatar_url   = excluded.avatar_url,
            last_seen_at = excluded.last_seen_at
    """, (discord_id, username, avatar_url, now_ms, now_ms))
    conn.commit()
    row = conn.execute("SELECT id FROM users WHERE discord_id=?", (discord_id,)).fetchone()
    conn.close()
    return row["id"]


def _set_auth_cookies(response, user_id: int) -> None:
    access  = _make_jwt(user_id, ACCESS_TOKEN_EXPIRE)
    refresh = _make_jwt(user_id, REFRESH_TOKEN_EXPIRE)
    response.set_cookie("access_token",  access,  max_age=ACCESS_TOKEN_EXPIRE,  **COOKIE_OPTS)
    response.set_cookie("refresh_token", refresh, max_age=REFRESH_TOKEN_EXPIRE, **COOKIE_OPTS)


def _clear_auth_cookies(response) -> None:
    response.delete_cookie("access_token",  **COOKIE_OPTS)
    response.delete_cookie("refresh_token", **COOKIE_OPTS)


@router.get("/discord/login")
async def discord_login(request: Request):
    return await oauth.discord.authorize_redirect(request, DISCORD_REDIRECT_URI)


@router.get("/discord/callback")
async def discord_callback(request: Request):
    token = await oauth.discord.authorize_access_token(request)
    resp  = await oauth.discord.get("users/@me", token=token)
    data  = resp.json()

    discord_id = str(data["id"])
    username   = data.get("global_name") or data.get("username", "unknown")
    avatar     = None
    if data.get("avatar"):
        avatar = f"https://cdn.discordapp.com/avatars/{discord_id}/{data['avatar']}.png"

    user_id = _upsert_user(discord_id, username, avatar)

    redirect = RedirectResponse(url="/", status_code=302)
    _set_auth_cookies(redirect, user_id)
    return redirect


@router.post("/logout")
async def logout():
    response = JSONResponse({"ok": True})
    _clear_auth_cookies(response)
    return response


@router.get("/me")
async def me(request: Request):
    user = get_current_user(request)
    if user is None:
        return JSONResponse({"guest": True})
    return JSONResponse({
        "id":         user["id"],
        "username":   user["username"],
        "avatar_url": user["avatar_url"],
        "guest":      False,
    })
