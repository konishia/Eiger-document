"""Customize required fields for the park

Revision ID: d5b2e8f4a1c6
Revises: c3a1f0e2d7b9
Create Date: 2026-09-24 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5b2e8f4a1c6"
down_revision: str | Sequence[str] | None = "c3a1f0e2d7b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

required_fields = sa.table(
    "required_fields",
    sa.column("id", sa.Integer),
    sa.column("name", sa.String),
    sa.column("description", sa.Text),
    sa.column("keywords", sa.Text),
    sa.column("is_active", sa.Boolean),
)

# パークの業務に合わせて説明・キーワードを変更する既存項目
UPDATED = {
    "発生日時": {
        "description": "問題が起きた日付と時刻（例: 9月24日 10時30分頃）",
        "keywords": "日時,時頃,時ごろ,時半,時分,:,昨日,今朝,本日,午前,午後,開園直後,月,日",
    },
    "再現手順": {
        "description": "お客様・職員がどの操作をしたら起きたか（例: ①アプリでチケットを表示 ②ゲートの読み取り機にかざす）",
        "keywords": "手順,操作,押す,押した,押すと,タップ,かざ,選択,入力,→,①",
    },
    "利用環境": {
        "name": "利用端末",
        "description": "お客様または職員が使っていた端末（例: お客様のiPhone・公式アプリ／ゲートのQR読み取り機）",
        "keywords": "端末,iphone,android,ipad,スマホ,スマートフォン,アプリ,ブラウザ,読み取り機,券売機,ハンディ,pc",
    },
}

# 新しく追加する項目
ADDED = [
    {
        "name": "予約番号／注文番号",
        "description": "チケット購入時の予約番号または注文番号（購入完了メールやチケット画面に記載）",
        "keywords": "予約番号,注文番号,購入番号,受付番号,番号",
        "is_active": True,
    },
    {
        "name": "チケット種別",
        "description": "入園券（1日券・2日券）・ツアー・年間パスなど",
        "keywords": "入園券,1日券,2日券,ツアー,年間パス,年パス,チケット種別,前売",
        "is_active": True,
    },
    {
        "name": "発生場所",
        "description": "問題が起きた場所（例: 入園ゲート・特設ブース・チケット窓口・園外（お客様の自宅など））",
        "keywords": "ゲート,ブース,窓口,エントランス,インフォメーション,場所,エリア,売店,自宅,園外",
        "is_active": True,
    },
]

# パークでは必須にしない項目（削除せず無効化。設定画面から再度有効にできる）
DEACTIVATED = ["発生した画面・機能", "エラーメッセージ・表示内容"]


def upgrade() -> None:
    """Upgrade schema."""
    for name, values in UPDATED.items():
        op.execute(required_fields.update().where(required_fields.c.name == name).values(**values))
    op.execute(
        required_fields.update()
        .where(required_fields.c.name.in_(DEACTIVATED))
        .values(is_active=False)
    )
    op.bulk_insert(required_fields, ADDED)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        required_fields.delete().where(required_fields.c.name.in_([f["name"] for f in ADDED]))
    )
    op.execute(
        required_fields.update()
        .where(required_fields.c.name.in_(DEACTIVATED))
        .values(is_active=True)
    )
    op.execute(
        required_fields.update()
        .where(required_fields.c.name == "利用端末")
        .values(name="利用環境")
    )
