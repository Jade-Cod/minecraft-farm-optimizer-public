"""add users table

Revision ID: 001
Revises: 000
Create Date: 2026-06-25
"""
revision = '001'
down_revision = '000'
branch_labels = None
depends_on = None

from alembic import op


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id    TEXT    UNIQUE NOT NULL,
            username      TEXT    NOT NULL,
            avatar_url    TEXT,
            created_at    INTEGER NOT NULL,
            last_seen_at  INTEGER NOT NULL
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS users")
