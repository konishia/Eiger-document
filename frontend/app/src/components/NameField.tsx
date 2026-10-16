'use client';

import { useEffect, useState } from 'react';

import { useSession } from '@/components/AuthGate';
import { forgetName, loadNames } from '@/lib/names';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  /** 最初に空欄なら、ログイン中の従業員の名前（名簿に無ければいちばん最近使った名前）を入れておく */
  prefillLatest?: boolean;
};

/** 名前記入欄。ログイン中の従業員の名前と、この端末で使った名前を下に並べ、タップで選べるようにする（書き換えもできる） */
export default function NameField({ value, onChange, placeholder, label = '名前', required, prefillLatest = true }: Props) {
  const [names, setNames] = useState<string[]>([]);
  // ログインした従業員コードに登録された名前（従業員名簿）
  const employeeName = useSession().employee_name;

  useEffect(() => {
    const saved = loadNames();
    setNames(saved);
    const initial = employeeName || saved[0];
    if (prefillLatest && !value && initial) onChange(initial);
    // 表示したときに一度だけ実行する
  }, []);

  const handleForget = (name: string) => {
    setNames(forgetName(name));
    if (value === name) onChange('');
  };

  return (
    <div className="space-y-2">
      <input
        className="input"
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        required={required}
      />
      {(employeeName || names.length > 0) && (
        <ul className="flex flex-wrap gap-2" aria-label="名前の候補">
          {employeeName && (
            <li>
              <button
                type="button"
                onClick={() => onChange(employeeName)}
                aria-pressed={value === employeeName}
                title="ログイン中の従業員"
                className={`flex animate-fade-in items-center gap-1 rounded-full px-3 py-1.5 text-xs transition ${value === employeeName ? 'bg-primary text-on-primary' : 'bg-sunken text-ink hover:bg-primary-soft'}`}
              >
                <span aria-hidden>👤</span>
                {employeeName}
              </button>
            </li>
          )}
          {names.filter((name) => name !== employeeName).map((name) => {
            const selected = name === value;
            return (
              <li
                key={name}
                className={`flex animate-fade-in items-center rounded-full text-xs transition ${selected ? 'bg-primary text-on-primary' : 'bg-sunken text-ink hover:bg-primary-soft'}`}
              >
                <button
                  type="button"
                  onClick={() => onChange(name)}
                  className="py-1.5 pr-1 pl-3"
                  aria-pressed={selected}
                >
                  {name}
                </button>
                <button
                  type="button"
                  onClick={() => handleForget(name)}
                  className="rounded-full px-2 py-1.5 opacity-60 hover:opacity-100"
                  aria-label={`${name}を候補から消す`}
                  title="候補から消す"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
