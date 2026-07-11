"""add status_checks table for server uptime monitoring

Revision ID: 005
Revises: 004
Create Date: 2026-07-11
"""
revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None

from alembic import op


def upgrade() -> None:
    op.execute("""
        CREATE TABLE status_checks (
            ts          INTEGER PRIMARY KEY,
            online      INTEGER NOT NULL,
            latency_ms  INTEGER,
            players     INTEGER,
            max_players INTEGER,
            version     TEXT
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE status_checks")
