'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  ACTION_LABELS,
  ACTOR_ROLE_LABELS,
  apiFetch,
  formatDateTime,
  inquiryPath,
  type AuditLog,
  type AuditLogList,
} from '@/lib/api';

/** 監査ログの1件（誰が・いつ・何を変えたか。変更内容は開くと見られる） */
export function AuditEntry({ log, showInquiryLink = true }: { log: AuditLog; showInquiryLink?: boolean }) {
  const changes = Object.entries(log.changes);
  const failed = log.action === 'auth.login_failed';
  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <time dateTime={log.created_at}>{formatDateTime(log.created_at)}</time>
        <span className={`chip ${failed ? 'bg-danger-soft text-danger' : 'bg-sunken text-ink'}`}>
          {ACTION_LABELS[log.action] ?? log.action}
        </span>
        <span>
          <span className="font-bold text-ink">{log.actor_name || '名前なし'}</span>
          {log.employee_code && <span className="ml-1 tabular-nums">[{log.employee_code}]</span>}（{ACTOR_ROLE_LABELS[log.actor_role] ?? log.actor_role}）
        </span>
        {log.ip_address && <span>接続元 {log.ip_address}</span>}
      </div>
      <p className="text-sm">
        {log.summary}
        {showInquiryLink && log.inquiry_id !== null && log.inquiry_exists && (
          <Link href={inquiryPath('support', log.inquiry_id)} className="link ml-2 text-xs">
            開く
          </Link>
        )}
      </p>
      {changes.length > 0 && (
        <details className="group text-sm">
          <summary className="cursor-pointer text-xs text-muted select-none">変更内容（{changes.length}項目）</summary>
          <dl className="mt-2 animate-fade-in space-y-2 rounded-2xl bg-sunken px-4 py-3">
            {changes.map(([field, [before, after]]) => (
              <div key={field} className="grid gap-1 sm:grid-cols-[8rem_1fr]">
                <dt className="text-xs font-bold text-muted">{field}</dt>
                <dd className="min-w-0 text-xs break-words whitespace-pre-wrap">
                  {before === null ? (
                    <span>{after}</span>
                  ) : after === null ? (
                    <span className="text-muted line-through">{before}</span>
                  ) : (
                    <>
                      <span className="text-muted line-through">{before}</span>
                      <span className="mx-2 text-muted" aria-label="から">
                        →
                      </span>
                      <span>{after}</span>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}

/** 問い合わせ詳細の下に出す、その問い合わせの変更履歴（閉じた状態で表示する） */
export default function AuditTrail({ inquiryId, version }: { inquiryId: number; version: number }) {
  const [logs, setLogs] = useState<AuditLogList | null>(null);

  useEffect(() => {
    apiFetch<AuditLogList>(`/audit-logs?inquiry_id=${inquiryId}&limit=100`)
      .then(setLogs)
      .catch(() => setLogs(null));
  }, [inquiryId, version]);

  if (!logs || logs.total === 0) return null;
  return (
    <details className="card group">
      <summary className="flex cursor-pointer items-center justify-between gap-2 select-none">
        <span className="text-lg font-bold">変更履歴</span>
        <span className="text-sm text-muted">
          {logs.total} 件 <span className="inline-block transition group-open:rotate-180">▼</span>
        </span>
      </summary>
      <ul className="mt-4 divide-y divide-line">
        {logs.items.map((log) => (
          <AuditEntry key={log.id} log={log} showInquiryLink={false} />
        ))}
      </ul>
    </details>
  );
}
