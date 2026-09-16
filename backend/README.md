# FastAPIベースプロジェクト

FastAPIベースのバックエンド。環境構築しただけの状態で、`Sample`（`id`・`name`のみ）のCRUD APIをサンプルとして1つ置いてある。

## 設計方針

独自のレイヤー分割（クリーンアーキテクチャ等）は導入せず、[FastAPI公式チュートリアル](https://fastapi.tiangolo.com/tutorial/)の標準的なやり方に準拠する。

- **ルーティング**: `main.py`にエンドポイントを直接書く（[Path Operations](https://fastapi.tiangolo.com/tutorial/first-steps/)）。規模が大きくなったら[`APIRouter`でファイル分割](https://fastapi.tiangolo.com/tutorial/bigger-applications/)する
- **DB**: [SQLAlchemy](https://docs.sqlalchemy.org/)（同期）。`models.py`にテーブル定義、`database.py`に接続設定。参考: [FastAPI公式のSQL(Relational) Databasesチュートリアル](https://fastapi.tiangolo.com/tutorial/sql-databases/)
- **スキーマ**: `schemas.py`にリクエスト/レスポンスの型（Pydantic）
- **マイグレーション**: [Alembic](https://alembic.sqlalchemy.org/)。`alembic/versions/`に履歴を残す
- 認証・認可機能は実装していない

迷ったらまず[FastAPI公式チュートリアル](https://fastapi.tiangolo.com/tutorial/)を参照する。

## 動作環境

DevContainer（Dockerコンテナ）内で動く前提のため、Python自体を自分のPCに個別インストールする必要はない。

- Python 3.14
- [uv](https://docs.astral.sh/uv/)（パッケージ管理。Dockerイメージのビルド時にコンテナ内へ自動インストールされる）

## 起動

- VSCode DevContainer経由で起動
- 起動時に`alembic upgrade head`が自動実行され、テーブルが作成される

## ディレクトリ構成

```text
app/
  main.py       APIのエンドポイント定義（起動エントリポイントも兼ねる）
  database.py   DB接続設定（SQLAlchemy engine/session）
  models.py     テーブル定義（SQLAlchemyモデル）
  schemas.py    リクエスト/レスポンスの型定義（Pydantic）
  alembic/      DBマイグレーション
```

## 機能を追加する

1. `models.py`にテーブル定義を追加
2. `alembic revision --autogenerate -m "説明"` でマイグレーションを作成し、`alembic upgrade head`を実行
3. `schemas.py`にリクエスト/レスポンスの型を追加
4. `main.py`にエンドポイントを追加

`http://localhost:8000/docs`（Swagger UI）で動作確認できる。

## OpenAPI

FastAPIはエンドポイント定義から[OpenAPI](https://www.openapis.org/what-is-openapi)仕様（`/openapi.json`）を自動生成する。上記のSwagger UIはこの仕様を元にした画面で、実際にリクエストを送って試すこともできる。

- [FastAPI: 自動ドキュメント生成の仕組み](https://fastapi.tiangolo.com/tutorial/first-steps/#interactive-api-docs)
- [OpenAPI Specification（仕様そのもの）](https://swagger.io/specification/)

## SQL / DBアクセス

`models.py`のテーブル定義や`main.py`のクエリを書く前に、SQLの基本とSQLAlchemyの使い方を押さえておくと理解が早い。

- [SQLBolt（インタラクティブなSQL入門）](https://sqlbolt.com/)
- [SQLAlchemy ORM Quickstart](https://docs.sqlalchemy.org/en/20/orm/quickstart.html)
- [FastAPI公式のSQL(Relational) Databasesチュートリアル](https://fastapi.tiangolo.com/tutorial/sql-databases/)（このプロジェクトの`database.py`/`models.py`はこの構成に準拠）
