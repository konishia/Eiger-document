'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';

import NotificationBell from '@/components/NotificationBell';
import { apiFetch, isAdminRole, siteOf, siteOfRole, type LoginRole, type Me, type ViewerRole } from '@/lib/api';

// サイトごとのメニュー（adminOnly は、そのサイトの管理者だけに表示する）
const NAV_LINKS: Record<ViewerRole, { href: string; label: string; exact?: boolean; adminOnly?: boolean }[]> = {
  staff: [
    { href: '/staff', label: 'かんたん問い合わせ', exact: true },
    { href: '/staff/inquiries', label: '送った問い合わせ' },
    { href: '/staff/settings', label: '設定', adminOnly: true },
  ],
  support: [
    { href: '/support', label: '問い合わせ一覧', exact: true },
    { href: '/support/dashboard', label: 'ダッシュボード' },
    { href: '/support/audit-logs', label: '監査ログ' },
    { href: '/support/settings', label: '設定' },
  ],
};

const SITE_LABELS: Record<ViewerRole, string> = {
  staff: '現場スタッフ',
  support: 'サポートチーム',
};

const SessionContext = createContext<Me>({ role: 'staff', employee_code: '', employee_name: '' });

/** ログイン中の権限（現場スタッフ / サポートチーム と、それぞれの管理者）を取得する */
export function useLoginRole(): LoginRole {
  return useContext(SessionContext).role;
}

/** ログイン中の従業員（従業員コード・名簿上の名前）を取得する。ログイン画面では空 */
export function useSession(): Me {
  return useContext(SessionContext);
}

function isActive(pathname: string, link: { href: string; exact?: boolean }): boolean {
  if (link.exact) {
    // 一覧から開いた詳細画面も「問い合わせ一覧」を選択中として扱う
    return pathname === link.href || (link.href === '/support' && pathname.startsWith('/support/inquiries'));
  }
  return pathname.startsWith(link.href);
}

/** ログイン済みの場合だけヘッダーと画面を表示する（未ログインならログイン画面へ） */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === '/login';
  const site = siteOf(pathname);
  const [session, setSession] = useState<Me | null>(null);
  const role = session?.role ?? null;

  useEffect(() => {
    if (isLoginPage || role) return;
    apiFetch<Me>('/auth/me')
      .then(setSession)
      .catch(() => {
        const next = window.location.pathname + window.location.search;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      });
  }, [isLoginPage, role, router]);

  // ログインしたパスワードのサイトだけを使えるようにする（入口や相手側のサイトを開いたら自分のサイトへ移動）
  const ownSite = role ? siteOfRole(role) : null;
  const wrongSite = ownSite !== null && site !== ownSite;
  useEffect(() => {
    if (!isLoginPage && ownSite && wrongSite) router.replace(`/${ownSite}`);
  }, [isLoginPage, ownSite, wrongSite, router]);

  const handleLogout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    // 画面の状態ごと破棄するため再読み込みで移動する
    window.location.href = '/login';
  };

  if (isLoginPage) return <>{children}</>;
  if (!session || !role || wrongSite) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="animate-fade-in text-muted">読み込み中…</p>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <header className="sticky top-0 z-30 border-b border-line bg-base/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-5 py-3">
          <Link href={site ? `/${site}` : '/'} className="mr-2 flex items-center gap-2 font-bold whitespace-nowrap">
            <img src="/icon-192.png" alt="" className="h-8 w-8 rounded-xl" />
            <span className="hidden text-sm leading-tight sm:block">
              問い合わせ管理
              {site && (
                <>
                  <br />
                  <span className="text-xs font-medium text-muted">{SITE_LABELS[site]}用</span>
                </>
              )}
            </span>
          </Link>
          <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="メインメニュー">
            {site &&
              NAV_LINKS[site]
                .filter((link) => !link.adminOnly || isAdminRole(role))
                .map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`btn btn-sm ${isActive(pathname, link) ? 'bg-primary-soft text-ink' : 'btn-ghost'}`}
                  >
                    {link.label}
                  </Link>
                ))}
          </nav>
          {/* ログイン中の従業員 */}
          <span className="hidden max-w-40 truncate text-right text-xs leading-tight text-muted md:block" title={session.employee_name}>
            {session.employee_name || '名簿未登録'}
            <br />
            <span className="tabular-nums">{session.employee_code}</span>
          </span>
          {isAdminRole(role) && (
            <span className="chip hidden bg-ai-soft text-ai-ink sm:inline-flex">管理者</span>
          )}
          {site && <NotificationBell site={site} />}
          <div className="relative">
            <details className="group">
              <summary className="btn btn-ghost btn-sm list-none" aria-label="メニュー">
                ⋯
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-48 animate-pop-in overflow-hidden rounded-2xl border border-line bg-card p-1 shadow-soft">
                <button onClick={handleLogout} className="w-full rounded-xl px-4 py-2 text-left text-sm hover:bg-sunken">
                  ログアウト
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>
      {children}
    </SessionContext.Provider>
  );
}
