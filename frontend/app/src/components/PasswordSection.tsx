'use client';

import { useState } from 'react';

import { useLoginRole } from '@/components/AuthGate';
import { apiFetch, isAdminRole, siteOfRole, type LoginRole, type ViewerRole } from '@/lib/api';

// 各サイトの管理者が変更できるパスワード（自分のサイトの一般用と、自分の管理者パスワード）
const TARGETS: Record<ViewerRole, { value: LoginRole; label: string }[]> = {
  staff: [
    { value: 'staff', label: '現場スタッフ用' },
    { value: 'staff_admin', label: '現場スタッフ管理者' },
  ],
  support: [
    { value: 'support', label: 'サポートチーム用' },
    { value: 'support_admin', label: 'サポートチーム管理者' },
  ],
};

const SITE_LABELS: Record<ViewerRole, string> = {
  staff: '現場スタッフ',
  support: 'サポートチーム',
};

/** 自分のサイトのパスワードの変更（そのサイトの管理者のみ）。変更すると、変更した管理者以外はそのサイトの全員がログアウトされる */
export default function PasswordSection() {
  const role = useLoginRole();
  const site = siteOfRole(role);
  const [target, setTarget] = useState<LoginRole>(site);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!isAdminRole(role)) {
    return (
      <section className="card space-y-2">
        <h2 className="text-lg font-bold">パスワード</h2>
        <p className="text-sm text-muted">
          パスワードの変更は{SITE_LABELS[site]}の管理者のみ行えます。{SITE_LABELS[site]}を選び、管理者パスワードでログインしてください。
        </p>
      </section>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setMessage({ ok: false, text: '新しいパスワード（確認）が一致しません' });
      return;
    }
    try {
      await apiFetch('/auth/password', {
        method: 'POST',
        json: { target, current_password: current, new_password: next },
      });
      setMessage({ ok: true, text: '変更しました。ほかの端末では新しいパスワードで再ログインが必要です。' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : '変更に失敗しました' });
    }
  };

  return (
    <section className="card space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">パスワードの変更</h2>
        <p className="text-sm text-muted">
          変更すると、{SITE_LABELS[site]}用サイトではこの端末以外の全員がログアウトされます。
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="inline-flex rounded-full bg-sunken p-1" role="radiogroup" aria-label="変更するパスワード">
          {TARGETS[site].map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={target === value}
              onClick={() => setTarget(value)}
              className={`btn btn-sm ${target === value ? 'bg-card text-ink shadow-soft' : 'text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="password"
          className="input"
          placeholder="現在の管理者パスワード"
          aria-label="現在の管理者パスワード"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <input
          type="password"
          className="input"
          placeholder="新しいパスワード（3文字以上）"
          aria-label="新しいパスワード"
          autoComplete="new-password"
          minLength={3}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <input
          type="password"
          className="input"
          placeholder="新しいパスワード（確認）"
          aria-label="新しいパスワード（確認）"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {message && (
          <p className={`animate-fade-in text-sm ${message.ok ? 'font-bold text-primary' : 'text-danger'}`}>{message.text}</p>
        )}
        <button type="submit" className="btn btn-primary">
          変更する
        </button>
      </form>
    </section>
  );
}
