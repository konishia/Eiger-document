'use client';

import { useEffect, useState } from 'react';

import { useLoginRole } from '@/components/AuthGate';
import EmployeeSection from '@/components/EmployeeSection';
import PasswordSection from '@/components/PasswordSection';
import { apiFetch, formatDateTime, type RequiredField } from '@/lib/api';

/** サポートチームが問い合わせの必須項目を定義する */
function RequiredFieldsSection() {
  const [fields, setFields] = useState<RequiredField[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');

  const loadFields = async () => {
    setFields(await apiFetch<RequiredField[]>('/required-fields'));
  };

  useEffect(() => {
    loadFields();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/required-fields', { method: 'POST', json: { name, description, keywords } });
    setName('');
    setDescription('');
    setKeywords('');
    setShowAdd(false);
    loadFields();
  };

  const handleToggle = async (field: RequiredField) => {
    await apiFetch(`/required-fields/${field.id}`, { method: 'PATCH', json: { is_active: !field.is_active } });
    loadFields();
  };

  const handleDelete = async (field: RequiredField) => {
    if (!confirm(`「${field.name}」を削除しますか？`)) return;
    await apiFetch(`/required-fields/${field.id}`, { method: 'DELETE' });
    loadFields();
  };

  return (
    <section className="card space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">必須項目</h2>
        <p className="text-sm text-muted">問い合わせに書いてほしい項目です。足りないときはAIが聞き返します。</p>
      </div>

      <ul className="divide-y divide-line">
        {fields.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-4 py-4">
            <div className={`min-w-0 transition ${f.is_active ? '' : 'opacity-50'}`}>
              <p className="font-bold">{f.name}</p>
              {f.description && <p className="truncate text-xs text-muted">{f.description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {/* オン／オフのスイッチ */}
              <button
                role="switch"
                aria-checked={f.is_active}
                aria-label={`${f.name}を${f.is_active ? '無効' : '有効'}にする`}
                onClick={() => handleToggle(f)}
                className={`relative h-7 w-12 rounded-full transition duration-300 ${f.is_active ? 'bg-primary' : 'bg-line'}`}
              >
                <span
                  className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-card shadow-soft transition duration-300 ${f.is_active ? 'translate-x-5' : ''}`}
                />
              </button>
              <button
                onClick={() => handleDelete(f)}
                className="btn btn-ghost h-9 w-9 p-0 hover:text-danger"
                aria-label={`${f.name}を削除`}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      {showAdd ? (
        <form onSubmit={handleCreate} className="animate-fade-up space-y-3">
          <input
            className="input"
            placeholder="項目名（例: 来園人数）"
            aria-label="項目名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder="説明（例: 同じチケットで入園しようとした人数）"
            aria-label="説明"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <input
            className="input"
            placeholder="簡易判定キーワード（カンマ区切り。例: 人数,名,大人,子ども）"
            aria-label="簡易判定キーワード"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="btn btn-ghost">
              やめる
            </button>
            <button type="submit" className="btn btn-primary">
              追加する
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} className="btn btn-soft">
          ＋ 項目を追加
        </button>
      )}
    </section>
  );
}

type FaqStatus = { count: number; fetched_at: string | null; source_url: string };

/** AIが引用するよくある質問（FAQ）の取り込み状況 */
function FaqSection() {
  const role = useLoginRole();
  const [status, setStatus] = useState<FaqStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<FaqStatus>('/faq/status').then(setStatus);
  }, []);

  const handleRefresh = async () => {
    setRunning(true);
    setError('');
    try {
      setStatus(await apiFetch<FaqStatus>('/faq/refresh', { method: 'POST' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '取り込みに失敗しました');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="card space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">よくある質問（FAQ）</h2>
        <p className="text-sm text-muted">
          AIは回答のときに、該当するFAQを出典つきで引用します。FAQは毎日自動で取り込み直します。
        </p>
      </div>
      {status && (
        <p className="text-sm">
          {status.count} 件
          {status.fetched_at && <span className="text-muted">（{formatDateTime(status.fetched_at)} 取り込み）</span>}
          <br />
          <a href={status.source_url} target="_blank" rel="noreferrer" className="link text-xs break-all">
            {status.source_url}
          </a>
        </p>
      )}
      {role === 'support_admin' && (
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={handleRefresh} disabled={running} className="btn btn-soft">
            {running ? '取り込み中…（1分ほど）' : '今すぐ取り込む'}
          </button>
          {error && <span className="text-sm text-danger">{error}</span>}
        </div>
      )}
    </section>
  );
}

/** 自動要約バッチの手動実行 */
function BatchSection() {
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await apiFetch<{ summarized_count: number }>('/batch/summaries', { method: 'POST' });
      setMessage(`${res.summarized_count} 件の要約を作成しました`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="card space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">要約の作成</h2>
        <p className="text-sm text-muted">毎日自動で作成されます。すぐに作りたいときに使います。</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={handleRun} disabled={running} className="btn btn-soft">
          {running ? '作成中…' : '今すぐ作成'}
        </button>
        {message && <span className="animate-fade-in text-sm text-muted">{message}</span>}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <main className="page space-y-8">
      <h1 className="page-title">設定</h1>
      <PasswordSection />
      <EmployeeSection />
      <RequiredFieldsSection />
      <FaqSection />
      <BatchSection />
    </main>
  );
}
