"""baseline — stamp existing tables

Revision ID: 000
Revises:
Create Date: 2026-06-25
"""
revision = '000'
down_revision = None
branch_labels = None
depends_on = None

from alembic import op


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS price_history (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            crop_id TEXT    NOT NULL,
            date    TEXT    NOT NULL,
            price   REAL    NOT NULL,
            UNIQUE(crop_id, date)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS vote_log (
            site_id  TEXT    PRIMARY KEY,
            voted_at INTEGER NOT NULL
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS app_meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS prestige_progress (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            taken_at     INTEGER NOT NULL,
            objective_id TEXT    NOT NULL,
            category     TEXT    NOT NULL,
            label        TEXT    NOT NULL,
            goal_text    TEXT,
            current      INTEGER NOT NULL,
            goal         INTEGER NOT NULL,
            UNIQUE(taken_at, objective_id)
        )
    """)


def downgrade() -> None:
    pass
