export type ColumnDatum = {
  key: string;
  /** 横軸の目盛りに出す短いラベル（例: 9/28、10時） */
  label: string;
  /** ツールチップ・表に出すラベル（例: 9月28日（日）） */
  fullLabel: string;
  value: number;
};

type Props = {
  data: ColumnDatum[];
  /** 表の見出し（例: 日付） */
  labelHeading: string;
  /** 目盛りのラベルを何本おきに出すか */
  tickEvery?: number;
  height?: number;
  unit?: string;
};

/**
 * 1系列の縦棒グラフ（件数の推移・時間帯別など）
 * - 棒にカーソルを合わせる（またはキーボードで選ぶ）と値が出る
 * - いちばん多い棒にだけ値を直接書き、すべての値は「表で見る」で確認できる
 */
export default function ColumnChart({ data, labelHeading, tickEvery = 1, height = 160, unit = '件' }: Props) {
  const max = Math.max(...data.map((d) => d.value), 0);
  // 目盛りは切りのいい値にする（最大値が小さいときも0〜最大が分かるように）
  const scaleMax = max <= 4 ? Math.max(max, 1) : Math.ceil(max / 2) * 2;
  const peakIndex = max > 0 ? data.findIndex((d) => d.value === max) : -1;

  return (
    <div className="space-y-3">
      <div className="relative" style={{ height }}>
        {/* 目盛り線（控えめに） */}
        {[1, 0.5].map((ratio) => (
          <div
            key={ratio}
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line"
            style={{ bottom: `${ratio * 100}%` }}
          >
            <span className="absolute -top-2 left-0 bg-card pr-1 text-[10px] leading-none text-muted tabular-nums">
              {Math.round(scaleMax * ratio)}
            </span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end border-b border-line pl-6">
          {data.map((d, i) => (
            <div
              key={d.key}
              tabIndex={0}
              aria-label={`${d.fullLabel}: ${d.value}${unit}`}
              className="group relative flex h-full min-w-0 flex-1 items-end justify-center px-px outline-none"
            >
              {i === peakIndex && (
                <span
                  className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[11px] font-bold text-ink tabular-nums group-hover:hidden group-focus:hidden"
                  style={{ bottom: `calc(${(d.value / scaleMax) * 100}% + 4px)` }}
                >
                  {d.value}
                </span>
              )}
              <div
                className="w-full max-w-6 rounded-t bg-primary transition group-hover:bg-primary-hover group-focus:bg-primary-hover group-focus:ring-2 group-focus:ring-primary-soft"
                style={{ height: `${(d.value / scaleMax) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
              />
              {/* 値は棒のすぐ上に出す */}
              <div
                role="tooltip"
                className="pointer-events-none absolute left-1/2 z-10 hidden -translate-x-1/2 rounded-xl border border-line bg-card px-3 py-1.5 text-center whitespace-nowrap shadow-soft group-hover:block group-focus:block"
                style={{ bottom: `calc(${(d.value / scaleMax) * 100}% + 6px)` }}
              >
                <p className="text-sm font-bold">
                  {d.value}
                  {unit}
                </p>
                <p className="text-[11px] text-muted">{d.fullLabel}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* 横軸の目盛り */}
      <div className="flex pl-6" aria-hidden>
        {data.map((d, i) => (
          <span key={d.key} className="min-w-0 flex-1 text-center text-[10px] whitespace-nowrap text-muted">
            {i % tickEvery === 0 ? d.label : ''}
          </span>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted select-none">表で見る</summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-sunken text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-bold">{labelHeading}</th>
                <th className="px-3 py-2 text-right font-bold">件数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((d) => (
                <tr key={d.key}>
                  <td className="px-3 py-1.5">{d.fullLabel}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {d.value}
                    {unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
