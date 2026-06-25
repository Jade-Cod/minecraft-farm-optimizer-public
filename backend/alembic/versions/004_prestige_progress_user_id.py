"""add user_id to prestige_progress

Revision ID: 004
Revises: 003
Create Date: 2026-06-25
"""
revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None

from alembic import op


def upgrade() -> None:
    op.execute("ALTER TABLE prestige_progress RENAME TO prestige_progress_old")
    op.execute("""
        CREATE TABLE prestige_progress (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            taken_at     INTEGER NOT NULL,
            objective_id TEXT    NOT NULL,
            category     TEXT    NOT NULL,
            label        TEXT    NOT NULL,
            goal_text    TEXT,
            current      INTEGER NOT NULL,
            goal         INTEGER NOT NULL,
            UNIQUE(user_id, taken_at, objective_id)
        )
    """)
    op.execute("""
        INSERT INTO prestige_progress (user_id, taken_at, objective_id, category, label, goal_text, current, goal)
        SELECT 1, taken_at, objective_id, category, label, goal_text, current, goal
        FROM prestige_progress_old
        WHERE EXISTS (SELECT 1 FROM users WHERE id=1)
    """)
    op.execute("DROP TABLE prestige_progress_old")


def downgrade() -> None:
    op.execute("ALTER TABLE prestige_progress RENAME TO prestige_progress_new")
    op.execute("""
        CREATE TABLE prestige_progress (
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
    op.execute("""
        INSERT INTO prestige_progress (taken_at, objective_id, category, label, goal_text, current, goal)
        SELECT taken_at, objective_id, category, label, goal_text, current, goal
        FROM prestige_progress_new
    """)
    op.execute("DROP TABLE prestige_progress_new")
