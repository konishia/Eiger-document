import type { AICheckResult } from '@/lib/api';

/** 入力中のAIチェック結果（不足項目の指摘）を表示する */
export default function AICheckPanel({ result }: { result: AICheckResult }) {
  if (!result.is_complete) {
    return (
      <div className="animate-fade-up rounded-2xl bg-warn-soft px-5 py-4 text-sm text-warn-ink">
        <p className="mb-2 font-bold">あと少し！ 次の情報があると回答が早くなります</p>
        <ul className="space-y-1">
          {result.missing_fields.map((f) => (
            <li key={f}>・{f}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="animate-fade-up rounded-2xl bg-primary-soft px-5 py-4 text-sm font-bold">
      ✓ 必要な情報がそろっています
    </div>
  );
}
