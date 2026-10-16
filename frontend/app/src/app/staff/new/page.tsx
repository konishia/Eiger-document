'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import AICheckPanel from '@/components/AICheckPanel';
import DateTimeField, { isDateTimeField } from '@/components/DateTimeField';
import DraftStatus from '@/components/DraftStatus';
import NameField from '@/components/NameField';
import { apiFetch, inquiryPath, type Inquiry, type RequiredField } from '@/lib/api';
import { rememberName } from '@/lib/names';
import { rememberSentInquiry } from '@/lib/sent';
import { useDraft } from '@/lib/useDraft';
import { usePrecheck } from '@/lib/usePrecheck';

const BODY_EXAMPLE = `例:
【発生場所】入園ゲート 3番レーン
【チケット種別】年間パス
【予約番号／注文番号】AW-20260901-1234
【利用端末】お客様のiPhone（公式アプリ）
【再現手順】QRを表示して読み取り機にかざすと「読み取りできません」と表示される`;

export default function NewInquiryPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [body, setBody] = useState('');
  // カレンダーで選んだ発生日時（例: 2026年9月28日 10:15頃）。内容の先頭に【発生日時】として入れて送る
  const [occurredAt, setOccurredAt] = useState('');
  const [requiredFields, setRequiredFields] = useState<RequiredField[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const dateFieldName = requiredFields.find((f) => isDateTimeField(f.name))?.name ?? '発生日時';
  const fullBody = occurredAt ? `【${dateFieldName}】${occurredAt}\n${body}` : body;
  const { result, checking } = usePrecheck(title, fullBody);

  // 名前はログイン中の従業員の名前が自動で入るので、下書きには残さない
  const draft = useDraft('staff-new', { title, body }, (saved) => {
    setTitle(saved.title ?? '');
    setBody(saved.body ?? '');
  });
  const discardDraft = () => {
    setTitle('');
    setBody('');
    draft.clear();
  };

  useEffect(() => {
    apiFetch<RequiredField[]>('/required-fields').then((fields) => setRequiredFields(fields.filter((f) => f.is_active)));
  }, []);

  const insertTemplate = () => {
    // 日時はカレンダーの欄で選ぶので、ひな形には入れない
    const template = requiredFields
      .filter((f) => !isDateTimeField(f.name))
      .map((f) => `【${f.name}】`)
      .join('\n');
    setBody((prev) => (prev ? `${prev}\n\n${template}` : template));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    rememberName(reporterName);
    try {
      const created = await apiFetch<Inquiry>('/inquiries', {
        method: 'POST',
        json: { title, body: fullBody, reporter_name: reporterName },
      });
      rememberSentInquiry(created.id);
      draft.clear();
      router.push(inquiryPath('staff', created.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました');
      setSubmitting(false);
    }
  };

  return (
    <main className="page space-y-8">
      <div className="space-y-2">
        <Link href="/staff" className="link text-sm">
          ← かんたん問い合わせへ
        </Link>
        <h1 className="page-title">フォームで問い合わせる</h1>
        <p className="text-sm text-muted">必要な項目をまとめて書いて、サポートチームへ送ります</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-7">
        <label className="block space-y-2">
          <span className="text-sm font-bold">件名</span>
          <input
            className="input"
            placeholder="例: 入園ゲートで年間パスのQRが読み取れない"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <div className="space-y-2">
          <span className="text-sm font-bold">所属・お名前</span>
          <NameField
            value={reporterName}
            onChange={setReporterName}
            placeholder="例: 入園ゲート 田中"
            label="所属・お名前"
            required
          />
        </div>
        <div className="space-y-2">
          <span className="text-sm font-bold">{dateFieldName}</span>
          <DateTimeField label={dateFieldName} onChange={setOccurredAt} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="body" className="text-sm font-bold">
              内容
            </label>
            <button type="button" onClick={insertTemplate} className="btn btn-ghost btn-sm">
              ＋ 項目のひな形
            </button>
          </div>
          <textarea
            id="body"
            className="input h-56 resize-y"
            placeholder={BODY_EXAMPLE}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
          <details className="group text-sm text-muted">
            <summary className="cursor-pointer select-none">書いてほしい項目を見る</summary>
            <ul className="mt-2 animate-fade-in space-y-1 pl-4">
              {requiredFields.map((f) => (
                <li key={f.id}>・{f.name}</li>
              ))}
            </ul>
          </details>
        </div>

        {checking && <p className="animate-fade-in text-sm text-muted">AIが内容を確認しています…</p>}
        {!checking && result && <AICheckPanel result={result} />}
        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="space-y-3">
          <button type="submit" disabled={submitting} className="btn btn-primary w-full py-3 text-base">
            {submitting ? '送信中…' : '送信する'}
          </button>
          <DraftStatus draft={draft} onDiscard={discardDraft} />
        </div>
      </form>
    </main>
  );
}
