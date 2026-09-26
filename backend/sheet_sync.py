"""Automatic price sync from the community price sheet.

A background loop downloads the public Google Sheet as CSV every
SYNC_INTERVAL_S and hands the rows to main.py, which updates any prices that
changed. Nothing is stored per check: history only gains a row when a price
actually changes, keyed by the date in the sheet's column header (one row per
crop per sheet date), so the database grows about once a week, not per check.
"""
import asyncio
import csv
import io
from datetime import date, datetime, timedelta
from typing import Callable, Optional

import httpx

SHEET_ID = "1cOKyTKjOaAdyBKyJy9654gPjT6aYkme-EMEfRZWazew"
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv"
SYNC_INTERVAL_S = 600   # the sheet changes about weekly; 10 min is plenty fresh
FETCH_TIMEOUT_S = 15


def parse_price(cell: str) -> Optional[float]:
    try:
        return float(cell.replace("$", "").replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def sheet_date(rows: list[list[str]], today: date) -> str:
    """ISO date of the newest price column, e.g. "September 21" -> "2026-09-21".

    The header has no year: use this year, or last year if that would be in
    the future (a December column read in January). Falls back to today.
    """
    for row in rows:
        if len(row) < 2 or not row[1].strip():
            continue
        try:
            d = datetime.strptime(f"{row[1].strip()} {today.year}", "%B %d %Y").date()
        except ValueError:
            continue
        if d > today + timedelta(days=1):
            d = d.replace(year=today.year - 1)
        return d.isoformat()
    return today.isoformat()


def price_updates(rows: list[list[str]], crops: list[dict]) -> list[tuple[dict, float]]:
    """(crop, new_price) for every crop whose newest sheet price differs."""
    by_name = {c["name"].lower(): c for c in crops}
    out = []
    for row in rows:
        if len(row) < 2:
            continue
        crop = by_name.get(row[0].strip().lower())
        price = parse_price(row[1])
        if crop is None or price is None:
            continue
        if abs((crop["current_price"] or 0) - price) > 0.001:
            out.append((crop, price))
    return out


async def fetch_rows() -> list[list[str]]:
    async with httpx.AsyncClient(follow_redirects=True, timeout=FETCH_TIMEOUT_S) as client:
        resp = await client.get(SHEET_URL)
    resp.raise_for_status()
    return list(csv.reader(io.StringIO(resp.text)))


async def sync_loop(apply: Callable[[list[list[str]]], int]):
    """Fetch the sheet every SYNC_INTERVAL_S and apply it. Logs only changes and errors."""
    await asyncio.sleep(5)  # let startup finish
    while True:
        try:
            updated = apply(await fetch_rows())
            if updated:
                print(f"[sheet] updated {updated} prices")
        except Exception as e:
            print(f"[sheet] sync failed: {e}")
        await asyncio.sleep(SYNC_INTERVAL_S)


# ── Self-check: python backend/sheet_sync.py ────────────────────────────────

if __name__ == "__main__":
    header = ["Base Chems", "September 21", "September 9"]
    today = date(2026, 9, 26)
    assert sheet_date([["", ""], header], today) == "2026-09-21"
    # December column read in early January belongs to last year
    assert sheet_date([["Base Chems", "December 30"]], date(2027, 1, 3)) == "2026-12-30"
    # No readable header -> today
    assert sheet_date([["Wheatium", "$10.81"]], today) == "2026-09-26"

    assert parse_price("$1,234.50") == 1234.5 and parse_price("n/a") is None

    crops = [{"name": "Wheatium", "current_price": 11.11},
             {"name": "Potatium", "current_price": 7.47}]
    rows = [header, ["Wheatium", "$10.81"], ["Potatium", "$7.47"],
            ["Unknownium", "$1.00"], ["Average (Raw)", "$8.50"], ["Short"]]
    ups = price_updates(rows, crops)
    assert [(c["name"], p) for c, p in ups] == [("Wheatium", 10.81)], ups
    assert crops[0]["current_price"] == 11.11  # pure: caller applies the change
    print("sheet_sync self-check ok")
