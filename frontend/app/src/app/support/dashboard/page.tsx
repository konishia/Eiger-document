'use client';

import { useEffect, useState } from 'react';

import ColumnChart, { type ColumnDatum } from '@/components/ColumnChart';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch, formatMinutes, STATUS_LABELS, type Dashboard, type InquiryStatus } from '@/lib/api';

const PERIODS = [
  { days: 7, label: '7日' },
  { days: 30, label: '30日' },
  { days: 90, label: '90日' },
  { days: null, label: '全期間' },
] as const;

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
const STATUS_ORDER = Object.keys(STATUS_LABELS) as InquiryStatus[];

/** "2026-10-08" を時差でずらさずに日付として読む */
function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-card px-5 py-4 shadow-soft">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

/** サポートチーム用ダッシュボード（件数・平均対応時間・問い合わせが来る時間帯・カテゴリー別の傾向） */
export default function DashboardPage() {
  const [days, setDays] = useState<number | null>(30);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    apiFetch<Dashboard>(days ? `/dashboard?days=${days}` : '/dashboard')
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : '読み込めませんでした'));
  }, [days]);

  const periodLabel = days ? `直近${days}日` : '全期間';

  return (
    <main className="page max-w-5xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="page-title">ダッシュボード</h1>
          <p className="text-sm text-muted">{periodLabel}に届いた問い合わせの集計です</p>
        </div>
        {/* 期間の切り替え */}
        <div className="flex gap-1 rounded-2xl bg-sunken p-1" role="group" aria-label="集計期間">
          {PERIODS.map((p) => (
            <button
              key={p.label}
              onClick={() => setDays(p.days)}
              aria-pressed={days === p.days}
              className={`btn btn-sm ${days === p.days ? 'bg-card text-ink shadow-soft' : 'btn-ghost'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!data ? (
        !error && <p className="text-center text-muted">読み込み中…</p>
      ) : (
        <DashboardBody data={data} periodLabel={periodLabel} />
      )}
    </main>
  );
}

function DashboardBody({ data, periodLabel }: { data: Dashboard; periodLabel: string }) {
  const diff = data.previous_total === null ? null : data.total - data.previous_total;
  const diffNote =
    diff === null
      ? undefined
      : diff === 0
        ? '前の同じ期間と同じ'
        : `前の同じ期間より ${diff > 0 ? '+' : '−'}${Math.abs(diff)}件`;

  const daily: ColumnDatum[] = data.daily.map((d) => {
    const date = parseDate(d.date);
    return {
      key: d.date,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      fullLabel: `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[(date.getDay() + 6) % 7]}）`,
      value: d.count,
    };
  });
  const hourly: ColumnDatum[] = data.hourly.map((h) => ({
    key: String(h.hour),
    label: String(h.hour),
    fullLabel: `${h.hour}時台`,
    value: h.count,
  }));
  const weekday: ColumnDatum[] = data.weekday.map((w) => ({
    key: String(w.weekday),
    label: WEEKDAYS[w.weekday],
    fullLabel: `${WEEKDAYS[w.weekday]}曜日`,
    value: w.count,
  }));

  const busiestHour = data.total > 0 ? data.hourly.reduce((a, b) => (b.count > a.count ? b : a)) : null;
  const maxCategory = Math.max(...data.categories.map((c) => c.count), 1);

  return (
    <>
      {/* ---------- 件数・平均対応時間 ---------- */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="概要">
        <StatTile label={`問い合わせ件数（${periodLabel}）`} value={`${data.total}件`} note={diffNote} />
        <StatTile label="未完了（現在）" value={`${data.unresolved_total}件`} note="対応完了になっていない問い合わせ" />
        <StatTile
          label="初回回答までの平均"
          value={formatMinutes(data.avg_first_response_minutes)}
          note={
            data.first_response_count > 0
              ? `中央値 ${formatMinutes(data.median_first_response_minutes)}（${data.first_response_count}件）`
              : 'まだ回答した問い合わせがありません'
          }
        />
        <StatTile
          label="解決までの平均"
          value={formatMinutes(data.avg_resolution_minutes)}
          note={
            data.resolution_count > 0
              ? `中央値 ${formatMinutes(data.median_resolution_minutes)}（${data.resolution_count}件）`
              : 'まだ対応完了の問い合わせがありません'
          }
        />
      </section>

      <section className="flex flex-wrap items-center gap-3 text-sm" aria-label="ステータス別の件数">
        <span className="text-xs font-bold text-muted">ステータス別（{periodLabel}）</span>
        {STATUS_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <StatusBadge status={s} />
            <span className="font-bold tabular-nums">{data.status_counts[s]}件</span>
          </span>
        ))}
      </section>

      {/* ---------- 件数の推移 ---------- */}
      <section className="card space-y-4">
        <h2 className="text-lg font-bold">日別の件数</h2>
        <ColumnChart data={daily} labelHeading="日付" tickEvery={Math.max(1, Math.ceil(daily.length / 10))} />
      </section>

      {/* ---------- 問い合わせが来る時間 ---------- */}
      <section className="card space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-bold">問い合わせが来る時間</h2>
          {busiestHour && busiestHour.count > 0 && (
            <p className="text-sm text-muted">いちばん多いのは {busiestHour.hour}時台 です</p>
          )}
        </div>
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-muted">時間帯別</h3>
            <ColumnChart data={hourly} labelHeading="時間帯" tickEvery={3} />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-muted">曜日別</h3>
            <ColumnChart data={weekday} labelHeading="曜日" />
          </div>
        </div>
      </section>

      {/* ---------- カテゴリー別の傾向 ---------- */}
      <section className="card space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-bold">カテゴリー別の傾向</h2>
          <p className="text-xs text-muted">件名と内容から、よくある事例に自動で振り分けています</p>
        </div>
        {data.categories.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">この期間の問い合わせはありません</p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 text-left font-bold">カテゴリー</th>
                  <th className="py-2 pr-3 text-left font-bold">件数</th>
                  <th className="py-2 pr-3 text-right font-bold">未完了</th>
                  <th className="py-2 pr-3 text-right font-bold">初回回答まで</th>
                  <th className="py-2 text-right font-bold">解決まで</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.categories.map((c) => (
                  <tr key={c.name}>
                    <td className="py-3 pr-3 font-bold">{c.name}</td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-32 shrink-0" aria-hidden>
                          <div className="h-full rounded-r bg-primary" style={{ width: `${(c.count / maxCategory) * 100}%` }} />
                        </div>
                        <span className="tabular-nums">
                          {c.count}件<span className="ml-1 text-xs text-muted">（{Math.round((c.count / data.total) * 100)}%）</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums">{c.unresolved_count}件</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{formatMinutes(c.avg_first_response_minutes)}</td>
                    <td className="py-3 text-right tabular-nums">{formatMinutes(c.avg_resolution_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">
          初回回答まで: 届いてからサポートチームが最初に返信するまで ／ 解決まで: 届いてから対応完了にするまで（どちらも平均）
        </p>
      </section>
    </>
  );
}
