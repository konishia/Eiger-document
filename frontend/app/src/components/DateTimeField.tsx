'use client';

import { useState } from 'react';

/** 必須項目の名前から、日時を入れる項目かどうかを判定する（「発生日時」など） */
export function isDateTimeField(name: string): boolean {
  return name.includes('日時') || name.includes('日付');
}

/** 「2026年9月28日 10:15頃」のような、問い合わせに書く形式にする */
export function formatDateTimeForText(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}頃`;
}

/** 入力欄の初期値（今の日時）。datetime-local の形式 "YYYY-MM-DDTHH:MM" */
function nowForInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

type Props = {
  /** 問い合わせに書く形式の文字列（例: 2026年9月28日 10:15頃）。未選択なら空 */
  onChange: (text: string) => void;
  label: string;
  required?: boolean;
};

/** カレンダーから日時を選ぶ入力欄。「今」ボタンで現在の日時も入れられる */
export default function DateTimeField({ onChange, label, required = false }: Props) {
  const [value, setValue] = useState('');

  const update = (next: string) => {
    setValue(next);
    onChange(next ? formatDateTimeForText(next) : '');
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="datetime-local"
        className="input w-auto min-w-0 flex-1"
        aria-label={label}
        value={value}
        max={nowForInput()}
        required={required}
        onChange={(e) => update(e.target.value)}
      />
      <button type="button" onClick={() => update(nowForInput())} className="btn btn-soft btn-sm">
        今
      </button>
      {value && (
        <button type="button" onClick={() => update('')} className="btn btn-ghost btn-sm">
          クリア
        </button>
      )}
    </div>
  );
}
