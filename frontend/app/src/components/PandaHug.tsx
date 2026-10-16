// 枠（カード）を抱きかかえているパンダのイラスト
//
// 使い方: position: relative の親の中に、カード（z-10）と一緒に置く。
// パンダの顔・耳・腕は枠の後ろ（z-0）、前足は枠の手前（z-20）に描き、
// 枠の上からのぞき込み、前足で枠の縁をつかんでいるように見せる。
// 座標は 300×190。y=160 の位置がカードの上端に重なる。

const INK = '#2f3645';
const OUTLINE = '#cfe0ec';

const BOX = 'pointer-events-none absolute left-1/2 h-[190px] w-[300px] -translate-x-1/2';
// y=160 をカードの上端にそろえる
const BOX_POSITION = { top: '-160px' };

/** 枠の後ろに描く部分（耳・腕・顔） */
export function PandaBack() {
  return (
    <svg viewBox="0 0 300 190" className={`${BOX} z-0 animate-fade-up`} style={BOX_POSITION} aria-hidden>
      {/* 耳 */}
      <circle cx="92" cy="52" r="24" fill={INK} />
      <circle cx="208" cy="52" r="24" fill={INK} />
      {/* 腕（肩から枠の縁まで。先は枠に隠れる） */}
      <path d="M108 138 Q72 146 52 170" stroke={INK} strokeWidth="30" strokeLinecap="round" fill="none" />
      <path d="M192 138 Q228 146 248 170" stroke={INK} strokeWidth="30" strokeLinecap="round" fill="none" />
      {/* 顔 */}
      <ellipse cx="150" cy="100" rx="78" ry="66" fill="#ffffff" stroke={OUTLINE} strokeWidth="2.5" />
      {/* 目のまわりの黒い模様 */}
      <ellipse cx="120" cy="100" rx="15" ry="20" fill={INK} transform="rotate(-28 120 100)" />
      <ellipse cx="180" cy="100" rx="15" ry="20" fill={INK} transform="rotate(28 180 100)" />
      {/* 目 */}
      <circle cx="122" cy="98" r="6" fill="#ffffff" />
      <circle cx="123" cy="99" r="3.6" fill={INK} />
      <circle cx="124.5" cy="97" r="1.3" fill="#ffffff" />
      <circle cx="178" cy="98" r="6" fill="#ffffff" />
      <circle cx="177" cy="99" r="3.6" fill={INK} />
      <circle cx="178.5" cy="97" r="1.3" fill="#ffffff" />
      {/* ほっぺ */}
      <ellipse cx="102" cy="124" rx="10" ry="6" fill="#f6c6d3" opacity="0.7" />
      <ellipse cx="198" cy="124" rx="10" ry="6" fill="#f6c6d3" opacity="0.7" />
      {/* 鼻と口 */}
      <ellipse cx="150" cy="121" rx="8" ry="5.5" fill={INK} />
      <path
        d="M142 131 Q146 136 150 131 Q154 136 158 131"
        stroke={INK}
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** 一方の前足（肉球つき） */
function Paw({ cx }: { cx: number }) {
  return (
    <g>
      <ellipse cx={cx} cy="164" rx="22" ry="15" fill={INK} />
      {/* 指の肉球（枠の縁にかかっている指先） */}
      <circle cx={cx - 10} cy="159" r="3.2" fill="#56607a" />
      <circle cx={cx} cy="156" r="3.2" fill="#56607a" />
      <circle cx={cx + 10} cy="159" r="3.2" fill="#56607a" />
      <ellipse cx={cx} cy="167" rx="7" ry="5" fill="#56607a" />
    </g>
  );
}

/** 枠の手前に描く部分（枠の縁をつかんでいる前足） */
export function PandaFront() {
  return (
    <svg viewBox="0 0 300 190" className={`${BOX} z-20 animate-fade-up`} style={BOX_POSITION} aria-hidden>
      <Paw cx={50} />
      <Paw cx={250} />
    </svg>
  );
}
