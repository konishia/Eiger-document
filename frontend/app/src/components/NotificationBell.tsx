'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  apiFetch,
  formatRelative,
  inquiryPath,
  type AppNotification,
  type NotificationList,
  type ViewerRole,
} from '@/lib/api';
import { disablePush, enablePush, getPushState, updatePushRole, type PushState } from '@/lib/push';

const POLL_INTERVAL_MS = 10_000;
const TOAST_DURATION_MS = 10_000;
const MAX_TOASTS = 3;

/** OSの通知を出す（ブラウザで通知が許可されている場合のみ） */
function showSystemNotification(n: AppNotification, site: ViewerRole) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const url = n.inquiry_id ? inquiryPath(site, n.inquiry_id, true) : `/${site}`;
  const notification = new Notification('問い合わせ管理', { body: n.message, icon: '/icon-192.png', tag: `notification-${n.id}` });
  notification.onclick = () => {
    window.focus();
    window.location.href = url;
  };
}

const PUSH_HINTS: Record<PushState, string> = {
  on: 'サイトを閉じていても通知が届きます',
  off: 'オンにすると、サイトを閉じていても通知が届きます',
  denied: 'ブラウザの設定で通知がブロックされています。アドレスバーの鍵アイコンから許可してください',
  unsupported: 'このブラウザはポップアップ通知に対応していません',
};

/**
 * 画面右上の通知ベル
 * - 定期的に新着を確認し、新着があれば画面内にポップアップを出す（サイトを開いているとき）
 * - サイトを閉じているときの通知（ポップアップ通知）のオン／オフもここで切り替える
 * - 宛先は開いているサイトで決まる（現場スタッフ用なら職員宛、サポートチーム用ならサポートチーム宛）
 */
export default function NotificationBell({ site }: { site: ViewerRole }) {
  const router = useRouter();
  const role = site;
  const [data, setData] = useState<NotificationList>({ unread_count: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [pushState, setPushState] = useState<PushState>('off');
  const [pushBusy, setPushBusy] = useState(false);
  // 画面内のポップアップ（新着の通知）
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  // ポップアップを出し済みの最新の通知ID（最初の読み込み分は出さない）
  const lastSeenId = useRef<number | null>(null);
  const pushStateRef = useRef<PushState>('off');
  pushStateRef.current = pushState;

  useEffect(() => {
    getPushState()
      .then((state) => {
        setPushState(state);
        // 登録済みなら、このサイトの宛先で届くようにする
        if (state === 'on') updatePushRole(site).catch(() => {});
      })
      .catch(() => setPushState('unsupported'));
  }, [site]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToasts = useCallback(
    (fresh: AppNotification[]) => {
      setToasts((prev) => [...fresh, ...prev].slice(0, MAX_TOASTS));
      fresh.forEach((n) => setTimeout(() => dismissToast(n.id), TOAST_DURATION_MS));
      // 別のタブを見ているときは、OSの通知でも知らせる（ポップアップ通知がオンならサービスワーカーが出す）
      if (document.hidden && pushStateRef.current !== 'on') fresh.forEach((n) => showSystemNotification(n, site));
    },
    [dismissToast, site],
  );

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<NotificationList>(`/notifications?role=${role}`);
      setData(res);
      const newestId = res.items[0]?.id ?? 0;
      if (lastSeenId.current !== null) {
        const fresh = res.items.filter((n) => n.id > (lastSeenId.current ?? 0) && !n.is_read);
        if (fresh.length > 0) showToasts(fresh);
      }
      lastSeenId.current = Math.max(newestId, lastSeenId.current ?? 0);
    } catch {
      // 通信エラー時は次の確認まで待つ
    }
  }, [role, showToasts]);

  useEffect(() => {
    lastSeenId.current = null;
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    // ポップアップ通知が届いたらサービスワーカーから知らせが来るので、すぐ読み込む
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'push') load();
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      clearInterval(timer);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [load]);

  const togglePush = async () => {
    setPushBusy(true);
    try {
      setPushState(pushState === 'on' ? await disablePush() : await enablePush(site));
    } catch {
      setPushState(await getPushState().catch(() => 'unsupported' as const));
    } finally {
      setPushBusy(false);
    }
  };

  const handleClick = async (n: AppNotification) => {
    await apiFetch(`/notifications/${n.id}/read`, { method: 'POST' });
    setOpen(false);
    dismissToast(n.id);
    load();
    // 問い合わせの返信欄を開いて、すぐ返信できるようにする
    if (n.inquiry_id) router.push(inquiryPath(site, n.inquiry_id, true));
  };

  const handleReadAll = async () => {
    await apiFetch(`/notifications/read-all?role=${role}`, { method: 'POST' });
    load();
  };

  return (
    <div className="relative">
      {/* 画面内のポップアップ（新着の通知） */}
      <div
        className="pointer-events-none fixed top-20 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3"
        aria-live="polite"
      >
        {toasts.map((n) => (
          <div
            key={n.id}
            className="pointer-events-auto flex animate-pop-in items-start gap-3 rounded-3xl border border-line bg-card p-4 shadow-soft"
            role="status"
          >
            <span className="text-xl" aria-hidden>
              🔔
            </span>
            <button onClick={() => handleClick(n)} className="min-w-0 flex-1 text-left">
              <span className="block text-sm leading-relaxed font-bold">{n.message}</span>
              <span className="mt-1 block text-xs text-primary">タップして開く</span>
            </button>
            <button
              onClick={() => dismissToast(n.id)}
              className="btn btn-ghost h-7 w-7 shrink-0 p-0 text-xs"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="btn btn-ghost relative h-10 w-10 p-0 text-lg"
        aria-label={`通知 ${data.unread_count}件の未読`}
        aria-expanded={open}
      >
        🔔
        {data.unread_count > 0 && (
          <span
            key={data.unread_count}
            className="absolute -top-0.5 -right-0.5 min-w-5 animate-pop-in rounded-full bg-accent px-1 text-center text-[11px] leading-5 font-bold text-white"
          >
            {data.unread_count > 99 ? '99+' : data.unread_count}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* 外側をタップしたら閉じる */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-30 mt-3 w-80 max-w-[calc(100vw-2.5rem)] origin-top-right animate-pop-in overflow-hidden rounded-3xl border border-line bg-card shadow-soft">
            <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
              <p className="text-sm font-bold">お知らせ</p>
              <button onClick={handleReadAll} className="btn btn-ghost btn-sm">
                すべて既読
              </button>
            </div>

            {/* ポップアップ通知のオン／オフ */}
            <div className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-2xl bg-sunken px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-bold">ポップアップ通知</p>
                <p className="text-[11px] leading-snug text-muted">{PUSH_HINTS[pushState]}</p>
              </div>
              {(pushState === 'on' || pushState === 'off') && (
                <button
                  role="switch"
                  aria-checked={pushState === 'on'}
                  aria-label="ポップアップ通知"
                  disabled={pushBusy}
                  onClick={togglePush}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition duration-300 disabled:opacity-50 ${pushState === 'on' ? 'bg-primary' : 'bg-line'}`}
                >
                  <span
                    className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-card shadow-soft transition duration-300 ${pushState === 'on' ? 'translate-x-5' : ''}`}
                  />
                </button>
              )}
            </div>

            <ul className="max-h-96 overflow-y-auto px-2 pb-2">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => handleClick(n)}
                    className={`flex w-full gap-3 rounded-2xl px-3 py-3 text-left text-sm transition hover:bg-sunken ${n.is_read ? 'text-muted' : ''}`}
                  >
                    <span
                      className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-transparent' : 'bg-accent'}`}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block leading-relaxed">{n.message}</span>
                      <span className="mt-1 block text-xs text-muted">{formatRelative(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
              {data.items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">通知はありません</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
