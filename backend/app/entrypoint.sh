#!/bin/bash
set -e

# 環境変数の確認（機微情報はマスク）
echo "Runtime env check:"
echo "  STAGE=${STAGE:-}"
echo "  DATABASE_HOST=${DATABASE_HOST:-<empty>}"
DATABASE_PORT=${DATABASE_PORT:-3306}
echo "  DATABASE_PORT=${DATABASE_PORT}"
echo "  DATABASE_NAME=${DATABASE_NAME:-<empty>}"
if [[ -n "${DATABASE_USER:-}" ]]; then echo "  DATABASE_USER=<set>"; else echo "  DATABASE_USER=<empty>"; fi
if [[ -n "${DATABASE_PASSWORD:-}" ]]; then echo "  DATABASE_PASSWORD=<masked>"; else echo "  DATABASE_PASSWORD=<empty>"; fi

# データベースの準備ができるまで待機
echo "Waiting for database to be ready..."
while ! nc -z "$DATABASE_HOST" "$DATABASE_PORT"; do
  echo "Database not ready, waiting... (host=$DATABASE_HOST port=$DATABASE_PORT)"
  sleep 2
done

echo "Database is ready!"

# マイグレーションを実行
echo "Running database migrations..."
alembic upgrade head

# アプリケーションを起動
echo "Starting application..."
exec "$@"
