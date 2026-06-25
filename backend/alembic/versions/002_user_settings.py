"""add user_settings table

Revision ID: 002
Revises: 001
Create Date: 2026-06-25
"""
revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None

from alembic import op


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id             INTEGER PRIMARY KEY REFERENCES users(id),
            ntfy_topic          TEXT    NOT NULL DEFAULT '',
            ntfy_server         TEXT    NOT NULL DEFAULT 'https://ntfy.sh',
            ntfy_enabled        INTEGER NOT NULL DEFAULT 0,
            last_notify_sent_at INTEGER
        )
    """)
    # Migrate existing ntfy settings from app_meta to user_settings for user_id=1.
    # Only runs if user_id=1 exists (i.e. existing single-user install after first Discord login).
    op.execute("""
        INSERT INTO user_settings (user_id, ntfy_topic, ntfy_server, ntfy_enabled)
        SELECT
            1,
            COALESCE((SELECT value FROM app_meta WHERE key='ntfy_topic'), ''),
            COALESCE((SELECT value FROM app_meta WHERE key='ntfy_server'), 'https://ntfy.sh'),
            COALESCE(
                CASE (SELECT value FROM app_meta WHERE key='ntfy_enabled')
                    WHEN '1' THEN 1 WHEN 'true' THEN 1 WHEN 'True' THEN 1
                    ELSE 0 END,
                0
            )
        WHERE EXISTS (SELECT 1 FROM users WHERE id=1)
        AND NOT EXISTS (SELECT 1 FROM user_settings WHERE user_id=1)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_settings")
