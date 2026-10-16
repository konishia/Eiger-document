'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 入力中の文章を、この端末（ブラウザ）に下書きとして自動保存する
// - 入力が止まってから少し待って保存する。送信したら消す
// - 画面を閉じたり別の画面へ移動したりしても、次に開いたときに復元する
// - 古い下書きは使わない（写真は容量が大きいので保存しない）

const PREFIX = 'draft:';
const SAVE_DELAY_MS = 800;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Fields = Record<string, string>;
type Saved<T> = { value: T; savedAt: number };

function isBlank(value: Fields): boolean {
  return Object.values(value).every((v) => v.trim() === '');
}

function write(key: string, value: Fields): number | null {
  try {
    if (isBlank(value)) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    const savedAt = Date.now();
    localStorage.setItem(PREFIX + key, JSON.stringify({ value, savedAt }));
    return savedAt;
  } catch {
    // 保存できない環境（プライベートモードなど）では下書きを使わない
    return null;
  }
}

export type DraftState = {
  /** 最後に下書きを保存した日時（保存していなければ null） */
  savedAt: Date | null;
  /** 前回の下書きを復元したか */
  restored: boolean;
  /** 下書きを消す（送信したとき・破棄するとき） */
  clear: () => void;
};

/**
 * 入力欄の値を下書きとして自動保存し、次に開いたときに restore で戻す
 * @param key 下書きの保存先（画面ごと・問い合わせごとに分ける）
 * @param value 保存する入力欄の値（例: { title, body }）
 * @param restore 保存してあった下書きを入力欄に戻す処理
 */
export function useDraft<T extends Fields>(key: string, value: T, restore: (saved: T) => void): DraftState {
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [restored, setRestored] = useState(false);
  const restoreRef = useRef(restore);
  const latest = useRef(value);
  // 送信・破棄で消したあとは、画面を離れるときに書き戻さない
  const cleared = useRef(false);
  const serialized = JSON.stringify(value);

  useEffect(() => {
    restoreRef.current = restore;
    latest.current = value;
  });

  // 開いたときに、保存してあった下書きを戻す
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return;
      const saved = JSON.parse(raw) as Saved<T>;
      if (Date.now() - saved.savedAt > MAX_AGE_MS || isBlank(saved.value)) {
        localStorage.removeItem(PREFIX + key);
        return;
      }
      restoreRef.current(saved.value);
      setRestored(true);
      setSavedAt(new Date(saved.savedAt));
    } catch {
      // 壊れた下書きは無視する
    }
  }, [key]);

  // 入力が止まったら保存する
  useEffect(() => {
    const value = JSON.parse(serialized) as Fields;
    if (!isBlank(value)) cleared.current = false;
    const timer = setTimeout(() => {
      const at = write(key, value);
      setSavedAt(at ? new Date(at) : null);
      if (!at) setRestored(false);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, serialized]);

  // 保存前に画面を離れても、入力した分は残す
  useEffect(() => {
    // 空のときは何もしない（開いた直後に、復元前の空の値で下書きを消さないようにする）
    const flush = () => {
      if (!cleared.current && !isBlank(latest.current)) write(key, latest.current);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [key]);

  const clear = useCallback(() => {
    cleared.current = true;
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      // 保存できない環境では何もしない
    }
    setSavedAt(null);
    setRestored(false);
  }, [key]);

  return { savedAt, restored, clear };
}
