'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import StatusBadge from '@/components/StatusBadge';
import {
  apiFetch,
  formatRelative,
  inquiryPath,
  SORT_LABELS,
  STATUS_LABELS,
  type InquiryStatus,
  type InquirySummary,
  type SortKey,
} from '@/lib/api';

type Filters = { q: string; sort: SortKey };

// 進捗状況ごとに列を分けて並べる（左から対応の流れの順）
const STATUS_ORDER = Object.keys(STATUS_LABELS) as InquiryStatus[];

export default function Home() {
  const [inquiries, setInquiries] = useState<InquirySummary[] | null>(null);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [showFilters, setShowFilters] = useState(false);

  const loadInquiries = useCallback(async (f: Filters) => {
    const params = new URLSearchParams({ sort: f.sort });
    if (f.q.trim()) params.set('q', f.q);
    setInquiries(await apiFetch<InquirySummary[]>(`/inquiries?${params}`));
  }, []);

  // 並び順を変えたらすぐ反映する（キーワードは検索ボタンで反映）
  useEffect(() => {
    loadInquiries({ q: keyword, sort });
  }, [loadInquiries, sort]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadInquiries({ q: keyword, sort });
  };

  const byStatus = (status: InquiryStatus) => inquiries?.filter((i) => i.status === status) ?? [];
  const openCount = byStatus('open').length;
  const filtered = sort !== 'newest';

  return (
    <main className="page max-w-7xl space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            問い合わせ一覧
            {inquiries !== null && <span className="ml-3 text-base font-normal text-muted">全 {inquiries.length} 件</span>}
          </h1>
          {openCount > 0 && <p className="mt-1 text-sm text-accent-ink">未対応が {openCount} 件あります</p>}
        </div>
      </div>

      <div className="space-y-3">
        <form onSubmit={handleSearch} className="flex max-w-3xl gap-2">
          <input
            className="input"
            placeholder="キーワードで探す（例: 年間パス QR）"
            aria-label="キーワード"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button type="submit" className="btn btn-soft px-6">
            検索
          </button>
        </form>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="btn btn-ghost btn-sm"
          aria-expanded={showFilters}
        >
          {showFilters ? '▲' : '▼'} 並び替え{filtered && '（設定中）'}
        </button>
        {showFilters && (
          <div className="flex animate-fade-up flex-wrap gap-2">
            <select
              className="input w-auto py-2 text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="並び順"
            >
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {inquiries === null ? (
        <p className="text-center text-muted">読み込み中…</p>
      ) : (
        // 画面が狭くても4列を横に並べたまま、横スクロールで見られるようにする
        <div className="-mx-5 overflow-x-auto px-5 pb-2">
        <div className="grid min-w-[56rem] grid-cols-4 items-start gap-4">
          {STATUS_ORDER.map((status) => {
            const items = byStatus(status);
            return (
              <section key={status} aria-label={STATUS_LABELS[status]} className="min-w-0 space-y-3 rounded-3xl bg-sunken p-4">
                <div className="flex items-center justify-between gap-2 px-1">
                  <StatusBadge status={status} />
                  <span className="text-sm font-bold">{items.length} 件</span>
                </div>
                {items.length === 0 ? (
                  <p className="rounded-2xl border-2 border-dashed border-line px-4 py-8 text-center text-sm text-muted">
                    ありません
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {items.map((inquiry, index) => (
                      <li
                        key={inquiry.id}
                        className="animate-fade-up"
                        style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                      >
                        <div className="space-y-3 rounded-2xl border border-line bg-card px-4 py-4 shadow-soft transition duration-200 hover:-translate-y-0.5 hover:border-primary/40">
                          <Link href={inquiryPath('support', inquiry.id)} className="block space-y-1">
                            <p className="line-clamp-2 text-sm font-bold">{inquiry.title}</p>
                            <p className="text-xs text-muted">
                              {inquiry.reporter_name} ・ {formatRelative(inquiry.created_at)}
                              {inquiry.comment_count > 0 && ` ・ 💬 ${inquiry.comment_count}`}
                            </p>
                          </Link>
                          {inquiry.status !== 'closed' && (
                            <Link href={inquiryPath('support', inquiry.id, true)} className="btn btn-soft btn-sm">
                              返信する
                            </Link>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        </div>
      )}
    </main>
  );
}
