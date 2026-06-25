import os
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import Depends, HTTPException, Request
from jose import jwt, JWTError

JWT_SECRET    = os.environ.get("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")

DB_FILE = Path(__file__).parent / "data" / "history.db"


def _get_user_by_id(user_id: int) -> Optional[dict]:
    conn = sqlite3.connect(str(DB_FILE))
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT id, discord_id, username, avatar_url FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    if row is None:
        return None
    return dict(row)


def _user_id_from_token(token: Optional[str]) -> Optional[int]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None


def get_current_user(request: Request) -> Optional[dict]:
    # Prefer the short-lived access token; if it's missing or expired, fall back
    # to the longer-lived refresh token so the session survives past the access
    # token's lifetime (the rolling-session middleware re-mints both cookies).
    user_id = _user_id_from_token(request.cookies.get("access_token"))
    if user_id is None:
        user_id = _user_id_from_token(request.cookies.get("refresh_token"))
    if user_id is None:
        return None
    return _get_user_by_id(user_id)


def require_user(user: Optional[dict] = Depends(get_current_user)) -> dict:
    if user is None:
        raise HTTPException(status_code=401, detail="Login required")
    return user
