# Next.jsベースプロジェクト

Next.js（App Router）ベースのフロントエンド。環境構築しただけの状態で、追加のライブラリは入っていない（Tailwind CSSのみ）。

## 設計方針

独自のアーキテクチャ・ディレクトリ規約は導入せず、公式ドキュメントの標準的なやり方に準拠する。

- **ルーティング**: [Next.js App Router](https://nextjs.org/docs/app/building-your-application/routing)（`src/app`）のファイルシステムベースルーティングをそのまま使う
- **データ取得**: [Server Componentsでのデータフェッチ](https://nextjs.org/docs/app/building-your-application/data-fetching/fetching)、または素の`fetch`。状態管理・フォームライブラリは使わない（`useState`/`useEffect`で十分な範囲に留める）
- **UI**: [Tailwind CSS](https://tailwindcss.com/docs/installation)。コンポーネントライブラリは使わない
- 認証・認可機能は実装していない

迷ったら[Next.js公式のGetting Started](https://nextjs.org/docs/app/getting-started)を参照する。

## 動作環境

DevContainer（Dockerコンテナ）内で動く前提のため、Node.js/pnpmを自分のPCに個別インストールする必要はない。

- Node.js 24
- pnpm 10（Dockerイメージのビルド時にコンテナ内へ自動インストールされる）

## 起動

- VSCode DevContainer経由で起動

## ディレクトリ構成

```text
src/
  app/
    layout.tsx    共通レイアウト
    page.tsx      トップページ（サンプルAPIを呼ぶ実装例）
  styles/
    globals.css   Tailwindのimportのみ
  types/
    api.ts        OpenAPIから自動生成された型（手編集禁止、`pnpm gen:api`で再生成）
```

## 機能を追加する

`src/app/`配下にページを作り、`fetch`でバックエンドのAPIを呼ぶ。`page.tsx`を参考にする。
