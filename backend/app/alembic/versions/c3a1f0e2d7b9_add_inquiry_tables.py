"""Add inquiry tables

Revision ID: c3a1f0e2d7b9
Revises: b252355876d4
Create Date: 2026-09-24 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3a1f0e2d7b9"
down_revision: str | Sequence[str] | None = "b252355876d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "inquiries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("reporter_name", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("summary_generated_at", sa.DateTime(), nullable=True),
        sa.Column("ai_missing_fields", sa.Text(), nullable=True),
        sa.Column("ai_questions", sa.Text(), nullable=True),
        sa.Column("ai_probable_cause", sa.Text(), nullable=True),
        sa.Column("ai_action_required", sa.Boolean(), nullable=True),
        sa.Column("ai_draft_answer", sa.Text(), nullable=True),
        sa.Column("ai_checked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_inquiries_id"), "inquiries", ["id"], unique=False)
    op.create_index(op.f("ix_inquiries_status"), "inquiries", ["status"], unique=False)

    op.create_table(
        "comments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("inquiry_id", sa.Integer(), nullable=False),
        sa.Column("author_name", sa.String(length=100), nullable=False),
        sa.Column("author_role", sa.String(length=20), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["inquiry_id"], ["inquiries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_comments_id"), "comments", ["id"], unique=False)
    op.create_index(op.f("ix_comments_inquiry_id"), "comments", ["inquiry_id"], unique=False)

    required_fields = op.create_table(
        "required_fields",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("keywords", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_required_fields_id"), "required_fields", ["id"], unique=False)

    # サポートチームが定義する必須項目の初期値（画面から編集可能）
    op.bulk_insert(
        required_fields,
        [
            {
                "name": "発生日時",
                "description": "問題が起きた日付と時刻（例: 9月24日 10時30分頃）",
                "keywords": "日時,時頃,時ごろ,時半,時分,月,日,:,昨日,今朝,本日",
                "is_active": True,
            },
            {
                "name": "発生した画面・機能",
                "description": "どの画面・どの機能で起きたか（例: 決済画面、ログイン画面）",
                "keywords": "画面,機能,ページ,メニュー,ボタン",
                "is_active": True,
            },
            {
                "name": "再現手順",
                "description": "どの操作をしたら起きたか（例: ①商品を選択 ②決済ボタンを押す）",
                "keywords": "手順,操作,押す,押した,押すと,クリック,選択,入力,→,①,1.",
                "is_active": True,
            },
            {
                "name": "エラーメッセージ・表示内容",
                "description": "画面に表示されたメッセージやエラーコード",
                "keywords": "エラー,メッセージ,表示,コード,と出",
                "is_active": True,
            },
            {
                "name": "利用環境",
                "description": "端末・OS・ブラウザ（例: 店舗iPad / Safari）",
                "keywords": "端末,ブラウザ,iPad,iPhone,Android,Windows,Mac,Chrome,Safari,Edge,PC",
                "is_active": True,
            },
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_required_fields_id"), table_name="required_fields")
    op.drop_table("required_fields")
    op.drop_index(op.f("ix_comments_inquiry_id"), table_name="comments")
    op.drop_index(op.f("ix_comments_id"), table_name="comments")
    op.drop_table("comments")
    op.drop_index(op.f("ix_inquiries_status"), table_name="inquiries")
    op.drop_index(op.f("ix_inquiries_id"), table_name="inquiries")
    op.drop_table("inquiries")
