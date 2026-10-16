"""写真の添付テーブルを追加

Revision ID: a1e5c7f3d9b4
Revises: f9d4b6e2c8a3
Create Date: 2026-09-25 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1e5c7f3d9b4"
down_revision: str | Sequence[str] | None = "f9d4b6e2c8a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("inquiry_id", sa.Integer(), nullable=False),
        sa.Column("media_type", sa.String(length=50), nullable=False),
        sa.Column("data", sa.LargeBinary().with_variant(mysql.MEDIUMBLOB(), "mysql"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["inquiry_id"], ["inquiries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_attachments_id"), "attachments", ["id"], unique=False)
    op.create_index(op.f("ix_attachments_inquiry_id"), "attachments", ["inquiry_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_attachments_inquiry_id"), table_name="attachments")
    op.drop_index(op.f("ix_attachments_id"), table_name="attachments")
    op.drop_table("attachments")
