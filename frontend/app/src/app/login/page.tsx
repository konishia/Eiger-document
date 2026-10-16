'use client';

import { useEffect, useState } from 'react';

import { apiFetch, siteOf, type ViewerRole } from '@/lib/api';

// 最初に選ぶサイト
const SITES: { key: ViewerRole; icon: string; title: string; description: string }[] = [
  { key: 'staff', icon: '🙋', title: '現場スタッフ', description: '困りごとの相談・問い合わせ' },
  { key: 'support', icon: '🎧', title: 'サポートチーム', description: '問い合わせの確認・返信' },
];

// この端末で最後に使った従業員コード（次回から入力を省けるようにする）
const EMPLOYEE_CODE_KEY = 'employee-code';

function loadEmployeeCode(): string {
  try {
    return localStorage.getItem(EMPLOYEE_CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveEmployeeCode(code: string) {
  try {
    localStorage.setItem(EMPLOYEE_CODE_KEY, code);
  } catch {
    // 保存できない環境では毎回入力する
  }
}

/** 全角で入力されても半角にする（サーバー側も同じ処理をする） */
function normalizeCode(value: string): string {
  return value.normalize('NFKC').trim();
}

/** ログイン後に戻る画面（外部URLや、選んだサイト以外の画面へは飛ばさない） */
function nextPath(site: ViewerRole): string {
  const next = new URLSearchParams(window.location.search).get('next') ?? '';
  if (next.startsWith('/') && !next.startsWith('//') && siteOf(next) === site) return next;
  return `/${site}`;
}

/** ログイン画面: 先に「現場スタッフ」「サポートチーム」を選び、従業員コードとそのサイトのパスワードを入力する */
export default function LoginPage() {
  const [site, setSite] = useState<ViewerRole | null>(null);
  const [employeeCode, setEmployeeCode] = useState('');
  // 前回の従業員コードを覚えていれば、パスワード欄から入力を始める
  const [codeRemembered, setCodeRemembered] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 通知や持ち場の QR コードから開いた場合は、行き先のサイトを最初から選んでおく
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get('next') ?? '';
    const preset = siteOf(next);
    if (preset) setSite(preset);
    const savedCode = loadEmployeeCode();
    setEmployeeCode(savedCode);
    setCodeRemembered(savedCode !== '');
  }, []);

  const chooseSite = (next: ViewerRole | null) => {
    setSite(next);
    setPassword('');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!site) return;
    setSubmitting(true);
    setError('');
    const code = normalizeCode(employeeCode);
    try {
      await apiFetch('/auth/login', { method: 'POST', json: { site, employee_code: code, password } });
      saveEmployeeCode(code);
      window.location.href = nextPath(site);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
      setPassword('');
      setSubmitting(false);
    }
  };

  const selected = SITES.find((s) => s.key === site);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm animate-fade-up rounded-3xl border border-line bg-card px-6 pt-10 pb-8 text-center shadow-soft sm:px-8">
        <h1 className="mb-8 flex items-center justify-center gap-2 text-xl font-bold">
          <img src="/icon-192.png" alt="" className="h-8 w-8 rounded-xl" />
          問い合わせ管理
        </h1>

        {!selected ? (
          // ---------- 1. どちらのサイトを使うか ----------
          <div className="space-y-4">
            <p className="text-sm text-muted">どちらでログインしますか？</p>
            {SITES.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => chooseSite(s.key)}
                className="flex w-full animate-fade-up items-center gap-4 rounded-2xl border border-line bg-card px-5 py-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary-soft"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="text-3xl" aria-hidden>
                  {s.icon}
                </span>
                <span>
                  <span className="block font-bold">{s.title}</span>
                  <span className="block text-xs text-muted">{s.description}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          // ---------- 2. そのサイトのパスワード ----------
          <form onSubmit={handleSubmit} className="animate-fade-up space-y-6">
            <div className="flex items-center justify-center gap-2">
              <span className="chip bg-primary-soft py-1 text-sm text-ink">
                {selected.icon} {selected.title}
              </span>
              <button type="button" onClick={() => chooseSite(null)} className="btn btn-ghost btn-sm">
                変更
              </button>
            </div>
            <div className="space-y-3 text-left">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-muted">従業員コード</span>
                <input
                  className="input text-center tracking-wider"
                  placeholder="例: A1234"
                  value={employeeCode}
                  onChange={(e) => setEmployeeCode(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={20}
                  autoFocus={!codeRemembered}
                  required
                />
              </label>
              <span className="block pt-1 text-xs font-bold text-muted">パスワード</span>
              {/* 入力中の文字を確認できるよう、表示／非表示を切り替えられる */}
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-14 pl-14 text-center"
                  placeholder={`${selected.title}のパスワード`}
                  aria-label={`${selected.title}のパスワード`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus={codeRemembered}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="btn btn-ghost absolute top-1/2 right-2 h-9 -translate-y-1/2 px-3 text-xs"
                  aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示する'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? '隠す' : '表示'}
                </button>
              </div>
              {error && <p className="animate-fade-in text-center text-sm text-danger">{error}</p>}
            </div>
            <button type="submit" disabled={submitting} className="btn btn-primary w-full py-3 text-base">
              {submitting ? '確認中…' : 'ログイン'}
            </button>
          </form>
        )}
      </div>
      <p className="mt-6 text-xs text-muted">現場スタッフ・サポートチーム専用</p>
    </main>
  );
}
