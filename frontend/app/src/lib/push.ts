// ポップアップ通知（Web Push）の登録
// サイトを閉じていても OS の通知として届くよう、サービスワーカー（/sw.js）経由で購読する

import { apiFetch, type ViewerRole } from '@/lib/api';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/** 現在の状態（未対応 / 拒否済み / 未登録 / 登録済み） */
export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const subscription = await reg?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}

/** 通知を許可してもらい、このブラウザを送り先として登録する */
export async function enablePush(role: ViewerRole): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const reg = await registration();
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    const { public_key } = await apiFetch<{ public_key: string }>('/push/public-key');
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(public_key),
    });
  }
  await saveSubscription(subscription, role);
  return 'on';
}

/** 登録済みなら、宛先（職員 / サポートチーム）を更新する */
export async function updatePushRole(role: ViewerRole): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) await saveSubscription(subscription, role);
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) {
    await apiFetch('/push/unsubscribe', { method: 'POST', json: { endpoint: subscription.endpoint } });
    await subscription.unsubscribe();
  }
  return 'off';
}

async function saveSubscription(subscription: PushSubscription, role: ViewerRole): Promise<void> {
  const json = subscription.toJSON();
  await apiFetch('/push/subscriptions', {
    method: 'POST',
    json: { endpoint: json.endpoint, keys: json.keys, role },
  });
}
