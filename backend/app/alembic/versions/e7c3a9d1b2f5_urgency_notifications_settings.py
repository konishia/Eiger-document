"""Add urgency, notifications and app settings

Revision ID: e7c3a9d1b2f5
Revises: d5b2e8f4a1c6
Create Date: 2026-09-24 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7c3a9d1b2f5"
down_revision: str | Sequence[str] | None = "d5b2e8f4a1c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "inquiries",
        sa.Column("urgency", sa.String(length=10), nullable=False, server_default="normal"),
    )
    op.create_index(op.f("ix_inquiries_urgency"), "inquiries", ["urgency"], unique=False)

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("target_role", sa.String(length=20), nullable=False),
        sa.Column("inquiry_id", sa.Integer(), nullable=True),
        sa.Column("message", sa.String(length=300), nullable=False),
        sa.Column("is_urgent", sa.Boolean(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["inquiry_id"], ["inquiries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_notifications_id"), "notifications", ["id"], unique=False)
    op.create_index(op.f("ix_notifications_target_role"), "notifications", ["target_role"], unique=False)
    op.create_index(op.f("ix_notifications_inquiry_id"), "notifications", ["inquiry_id"], unique=False)
    op.create_index(op.f("ix_notifications_is_read"), "notifications", ["is_read"], unique=False)

    # 共通パスワードのハッシュなどを保存する（初回ログイン時に環境変数 APP_PASSWORD から作成される）
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("app_settings")
    op.drop_index(op.f("ix_notifications_is_read"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_inquiry_id"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_target_role"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_id"), table_name="notifications")
    op.drop_table("notifications")
    op.drop_index(op.f("ix_inquiries_urgency"), table_name="inquiries")
    op.drop_column("inquiries", "urgency")
