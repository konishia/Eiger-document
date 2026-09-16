FROM python:3.14-slim

# 必要なパッケージのインストール
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    zsh \
    procps \
    build-essential \
    pkg-config \
    netcat-traditional \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# uvのインストール
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# 作業ディレクトリの設定
WORKDIR /workspace/backend/app
ENV PYTHONPATH=/workspace/backend/app

# アプリケーションファイルをコピー
COPY app/ .

# uvで依存関係をインストール
RUN uv sync --frozen --all-extras
ENV PATH="/workspace/backend/app/.venv/bin:${PATH}"

# ポートの公開
EXPOSE 8000

RUN chmod +x entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
