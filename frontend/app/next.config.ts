import { NextConfig } from 'next';

const config: NextConfig = {
  // スタンドアロンモードを有効化（Docker最適化）
  output: 'standalone',
};

export default config;
