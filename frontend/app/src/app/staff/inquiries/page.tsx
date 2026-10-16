'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import StatusBadge from '@/components/StatusBadge';
import { apiFetch, formatRelative, inquiryPath, type InquirySummary } from '@/lib/api';
import { keepSentInquiryIds, loadSentInquiryIds } from '@/lib/sent';

/** 現場スタッフがこの端末から送った問い合わせの一覧（回答が来たものが分かるようにする） */
export default function SentInquiriesPage() {
  const [inquiries, setInquiries] = useState<InquirySummary[] | null>(null);

  useEffect(() => {
    const ids = loadSentInquiryIds();
    if (ids.length === 0) {
      setInquiries([]);
      return;
    }
    apiFetch<InquirySummary[]>(`/inquiries?ids=${ids.join(',')}&sort=updated`).then((list) => {
      setInquiries(list);
      // 削除された問い合わせは覚えている一覧から外す
      keepSentInquiryIds(list.map((i) => i.id));
    });
  }, []);

  return (
    <main className="page space-y-8">
      <div className="space-y-2">
        <h1 className="page-title">送った問い合わせ</h1>
        <p className="text-sm text-muted">この端末から送った問い合わせと、サポートチームからの回答を確認できます</p>
      </div>

      {inquiries === null ? (
        <p className="text-center text-muted">読み込み中…</p>
      ) : inquiries.length === 0 ? (
        <div className="space-y-4 rounded-3xl border-2 border-dashed border-line px-6 py-16 text-center text-muted">
          <p>まだ問い合わせを送っていません</p>
          <Link href="/staff" className="btn btn-soft">
            かんたん問い合わせへ
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {inquiries.map((inquiry, index) => {
            const answered = inquiry.last_comment_role === 'support';
            return (
              <li key={inquiry.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
                <Link
                  href={inquiryPath('staff', inquiry.id)}
                  className="block space-y-2 rounded-3xl border border-line bg-card px-6 py-5 shadow-soft transition duration-200 hover:-translate-y-0.5 hover:border-primary/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={inquiry.status} />
                    {answered && <span className="chip bg-primary text-on-primary">回答あり</span>}
                    {inquiry.status === 'waiting_info' && (
                      <span className="chip bg-warn-soft text-warn-ink">追加の情報を待っています</span>
                    )}
                  </div>
                  <p className="truncate font-bold">{inquiry.title}</p>
                  <p className="text-xs text-muted">更新 {formatRelative(inquiry.updated_at)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
