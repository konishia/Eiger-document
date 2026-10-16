'use client';

import { useCallback, useEffect, useState } from 'react';

import { AuditEntry } from '@/components/AuditTrail';
import { apiFetch, type AuditLog, type AuditLogList } from '@/lib/api';

const PAGE_SIZE = 50;

// 操作の種類の絞り込み（前方一致で検索する）
const ACTION_FILTERS = [
  { value: '', label: 'すべての操作' },
  { value: 'inquiry.', label: '問い合わせ（作成・編集・削除・自動変更）' },
  { value: 'comment.', label: '返信' },
  { value: 'auth.', label: 'ログイン・パスワード' },
  { value: 'auth.login_failed', label: 'ログイン失敗だけ' },
  { value: 'employee.', label: '従業員名簿' },
  { value: 'required_field.', label: '必須項目の設定' },
  { value: 'ai.', label: 'AIチェック' },
  { value: 'faq.', label: 'FAQ取り込み' },
  { value: 'batch.', label: '要約バッチ' },
];

type Filters = { q: string; action: string };

/** 監査ログ（誰が・いつ・何を変えたか） */
export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [action, setAction] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const fetchPage = useCallback(async (f: Filters, offset: number) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (f.q.trim()) params.set('q', f.q);
    if (f.action) params.set('action', f.action);
    return apiFetch<AuditLogList>(`/audit-logs?${params}`);
  }, []);

  const load = useCallback(
    async (f: Filters) => {
      setError('');
      try {
        const page = await fetchPage(f, 0);
        setLogs(page.items);
        setTotal(page.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : '読み込めませんでした');
      }
    },
    [fetchPage],
  );

  // 種類を変えたらすぐ反映する（キーワードは検索ボタンで反映）
  useEffect(() => {
    load({ q: keyword, action });
  }, [load, action]);

  const loadMore = async () => {
    if (!logs) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage({ q: keyword, action }, logs.length);
      setLogs([...logs, ...page.items]);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込めませんでした');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <main className="page space-y-8">
      <div className="space-y-2">
        <h1 className="page-title">監査ログ</h1>
        <p className="text-sm text-muted">
          誰が・いつ・何を変えたかの記録です（新しい順）。問い合わせを削除しても記録は残ります。
          [ ] 内はログインした従業員コード、名前は入力欄の名前または従業員名簿の名前です。
        </p>
      </div>

      <div className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load({ q: keyword, action });
          }}
          className="flex gap-2"
        >
          <input
            className="input"
            placeholder="名前・従業員コード・内容・接続元で探す（例: A1234 削除）"
            aria-label="キーワード"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button type="submit" className="btn btn-soft px-6">
            検索
          </button>
        </form>
        <select
          className="input w-auto py-2 text-sm"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="操作の種類"
        >
          {ACTION_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {logs === null ? (
        !error && <p className="text-center text-muted">読み込み中…</p>
      ) : logs.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-line px-6 py-16 text-center text-muted">
          記録はありません
        </div>
      ) : (
        <section className="card space-y-2">
          <p className="text-sm text-muted">
            {total} 件中 {logs.length} 件を表示
          </p>
          <ul className="divide-y divide-line">
            {logs.map((log) => (
              <AuditEntry key={log.id} log={log} />
            ))}
          </ul>
          {logs.length < total && (
            <div className="pt-2 text-center">
              <button onClick={loadMore} disabled={loadingMore} className="btn btn-soft">
                {loadingMore ? '読み込み中…' : 'さらに表示'}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
