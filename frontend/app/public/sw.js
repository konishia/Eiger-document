// ポップアップ通知を受け取るサービスワーカー
// サイトを閉じていても、ブラウザ（またはホーム画面に追加したアプリ）が通知を受け取って表示する

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || '問い合わせ管理';
  event.waitUntil(
    (async () => {
      // 開いている画面に知らせて、画面内のポップアップをすぐ出してもらう
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      windows.forEach((client) => client.postMessage({ type: 'push' }));

      // 画面を操作中（フォーカスあり）なら画面内のポップアップだけにして、OSの通知と二重にしない
      if (windows.some((client) => client.focused)) return;

      await self.registration.showNotification(title, {
        body: data.body || '新しいお知らせがあります',
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: data.tag,
        // 同じ問い合わせの新しい通知が来たら、もう一度音や振動で知らせる
        renotify: Boolean(data.tag),
        data: { url: data.url || '/' },
      });
    })(),
  );
});

// 通知をタップしたら、開いている画面があればそれを使い、なければ新しく開く
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
