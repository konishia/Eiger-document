import type { Metadata, Viewport } from 'next';

import AuthGate from '@/components/AuthGate';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: '問い合わせ管理',
  description: '現場スタッフとサポートチームの社内問い合わせツール',
  // 社内ツールのため検索エンジンに登録させない
  robots: { index: false, follow: false },
  // ホーム画面に追加してアプリとして使えるようにする（ポップアップ通知にも使う）
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: '#f7fbfe',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
