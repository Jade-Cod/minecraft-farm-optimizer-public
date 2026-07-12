"""add analytics tables for cookie-free usage tracking

Revision ID: 006
Revises: 005
Create Date: 2026-07-11
"""
revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None

from alembic import op


def upgrade() -> None:
    op.execute("""
        CREATE TABLE analytics_hits (
            date  TEXT NOT NULL,
            path  TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (date, path)
        )
    """)
    op.execute("""
        CREATE TABLE analytics_visitors (
            date    TEXT NOT NULL,
            visitor TEXT NOT NULL,
            PRIMARY KEY (date, visitor)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE analytics_visitors")
    op.execute("DROP TABLE analytics_hits")
