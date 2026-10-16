import { NextConfig } from 'next';

const config: NextConfig = {
  // スタンドアロンモードを有効化（Docker最適化）
  output: 'standalone',

  // 現場スタッフ用（/staff）とサポートチーム用（/support）に分ける前のURLを、新しいURLへ移動させる
  // （ブックマークや持ち場に貼った QR コード /quick?name=... をそのまま使えるようにする）
  async redirects() {
    return [
      { source: '/quick', destination: '/staff', permanent: false },
      { source: '/inquiries/new', destination: '/staff/new', permanent: false },
      { source: '/inquiries/:id', destination: '/support/inquiries/:id', permanent: false },
      { source: '/settings', destination: '/support/settings', permanent: false },
    ];
  },
};

export default config;
