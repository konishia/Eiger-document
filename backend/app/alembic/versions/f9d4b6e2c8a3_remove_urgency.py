"""Remove urgency flag

Revision ID: f9d4b6e2c8a3
Revises: e7c3a9d1b2f5
Create Date: 2026-09-25 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f9d4b6e2c8a3"
down_revision: str | Sequence[str] | None = "e7c3a9d1b2f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index(op.f("ix_inquiries_urgency"), table_name="inquiries")
    op.drop_column("inquiries", "urgency")
    op.drop_column("notifications", "is_urgent")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "notifications",
        sa.Column("is_urgent", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "inquiries",
        sa.Column("urgency", sa.String(length=10), nullable=False, server_default="normal"),
    )
    op.create_index(op.f("ix_inquiries_urgency"), "inquiries", ["urgency"], unique=False)
