"""既読の記録とポップアップ通知の送り先を追加

Revision ID: b3f6d8a2e4c7
Revises: a1e5c7f3d9b4
Create Date: 2026-09-26 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3f6d8a2e4c7"
down_revision: str | Sequence[str] | None = "a1e5c7f3d9b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("inquiries", sa.Column("support_read_at", sa.DateTime(), nullable=True))
    op.add_column("comments", sa.Column("read_at", sa.DateTime(), nullable=True))

    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(length=700), nullable=False),
        sa.Column("p256dh", sa.String(length=200), nullable=False),
        sa.Column("auth", sa.String(length=100), nullable=False),
        sa.Column("target_role", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint"),
    )
    op.create_index(op.f("ix_push_subscriptions_id"), "push_subscriptions", ["id"], unique=False)
    op.create_index(
        op.f("ix_push_subscriptions_target_role"), "push_subscriptions", ["target_role"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_push_subscriptions_target_role"), table_name="push_subscriptions")
    op.drop_index(op.f("ix_push_subscriptions_id"), table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
    op.drop_column("comments", "read_at")
    op.drop_column("inquiries", "support_read_at")
