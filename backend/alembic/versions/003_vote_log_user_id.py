"""add user_id to vote_log

Revision ID: 003
Revises: 002
Create Date: 2026-06-25
"""
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None

from alembic import op


def upgrade() -> None:
    op.execute("ALTER TABLE vote_log RENAME TO vote_log_old")
    op.execute("""
        CREATE TABLE vote_log (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id  INTEGER NOT NULL REFERENCES users(id),
            site_id  TEXT    NOT NULL,
            voted_at INTEGER NOT NULL,
            UNIQUE(user_id, site_id)
        )
    """)
    # Migrate existing rows to user_id=1. If users table is empty (fresh install),
    # old rows had no votes yet so nothing to migrate.
    op.execute("""
        INSERT INTO vote_log (user_id, site_id, voted_at)
        SELECT 1, site_id, voted_at
        FROM vote_log_old
        WHERE EXISTS (SELECT 1 FROM users WHERE id=1)
    """)
    op.execute("DROP TABLE vote_log_old")


def downgrade() -> None:
    op.execute("ALTER TABLE vote_log RENAME TO vote_log_new")
    op.execute("""
        CREATE TABLE vote_log (
            site_id  TEXT    PRIMARY KEY,
            voted_at INTEGER NOT NULL
        )
    """)
    op.execute("""
        INSERT INTO vote_log (site_id, voted_at)
        SELECT site_id, MAX(voted_at) FROM vote_log_new GROUP BY site_id
    """)
    op.execute("DROP TABLE vote_log_new")
