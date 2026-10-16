"""監査ログと、対応完了日時（ダッシュボード用）を追加する

Revision ID: a8c2e4f6b1d3
Revises: d6b8f0c2e4a9
Create Date: 2026-10-08 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8c2e4f6b1d3"
down_revision: str | Sequence[str] | None = "d6b8f0c2e4a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("inquiries", sa.Column("closed_at", sa.DateTime(), nullable=True))
    # 既に対応完了の問い合わせは、最後に更新した日時を対応完了日時とみなす
    op.execute("UPDATE inquiries SET closed_at = updated_at WHERE status = 'closed'")

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("actor_role", sa.String(length=20), nullable=False),
        sa.Column("actor_name", sa.String(length=100), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("inquiry_id", sa.Integer(), nullable=True),
        sa.Column("summary", sa.String(length=300), nullable=False),
        sa.Column("changes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_logs_id"), "audit_logs", ["id"], unique=False)
    op.create_index(op.f("ix_audit_logs_created_at"), "audit_logs", ["created_at"], unique=False)
    op.create_index(op.f("ix_audit_logs_action"), "audit_logs", ["action"], unique=False)
    op.create_index(op.f("ix_audit_logs_inquiry_id"), "audit_logs", ["inquiry_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_audit_logs_inquiry_id"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_action"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_created_at"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_id"), table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_column("inquiries", "closed_at")
