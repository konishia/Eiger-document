'use client';

import { useEffect, useState } from 'react';

import { apiFetch, type AICheckResult } from '@/lib/api';

const DEBOUNCE_MS = 2000;
const MIN_BODY_LENGTH = 10;

/** 入力が止まってから一定時間後に、必須項目の不足をAIでチェックする */
export function usePrecheck(title: string, body: string) {
  const [result, setResult] = useState<AICheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (body.trim().length < MIN_BODY_LENGTH) {
      setResult(null);
      return;
    }
    // 入力が続いている間の古いリクエスト結果は捨てる
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await apiFetch<AICheckResult>('/ai/precheck', {
          method: 'POST',
          json: { title, body },
        });
        if (!cancelled) setResult(res);
      } catch {
        if (!cancelled) setResult(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setChecking(false);
    };
  }, [title, body]);

  return { result, checking };
}
