'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import DraftStatus from '@/components/DraftStatus';
import { AttachmentGallery, CommentList } from '@/components/InquiryParts';
import Linkify from '@/components/Linkify';
import NameField from '@/components/NameField';
import PhotoPicker, { PhotoPreviews } from '@/components/PhotoPicker';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch, formatDateTime, type ChatImage, type Inquiry } from '@/lib/api';
import { rememberName } from '@/lib/names';
import { rememberSentInquiry } from '@/lib/sent';
import { useDraft } from '@/lib/useDraft';

// ワンタップで返信欄に入れられる定型文
const TEMPLATES = [
  'お客様にご案内し、解決しました。',
  'ご案内しましたが解決しませんでした。引き続き確認をお願いします。',
  'お客様はすでにお帰りになりました。',
];

const REFRESH_INTERVAL_MS = 15_000;

/** 現場スタッフ用の問い合わせ詳細（状況の確認とサポートチームへの返信） */
export default function StaffInquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [authorName, setAuthorName] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replyImages, setReplyImages] = useState<ChatImage[]>([]);
  const [posting, setPosting] = useState(false);
  const [sentMessage, setSentMessage] = useState('');
  const [error, setError] = useState('');
  const replyRef = useRef<HTMLTextAreaElement>(null);
  // 返信の本文を、問い合わせごとに下書きとして自動保存する
  const draft = useDraft(`staff-reply:${id}`, { body: replyBody }, (saved) => setReplyBody(saved.body ?? ''));

  const loadInquiry = useCallback(async () => {
    try {
      setInquiry(await apiFetch<Inquiry>(`/inquiries/${id}`));
    } catch {
      setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    loadInquiry();
    // サポートチームの回答がすぐ見えるよう定期的に再読み込みする
    const timer = setInterval(loadInquiry, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadInquiry]);

  // 通知から開いたときは、表示後すぐ返信欄に入力できるようにする
  const loaded = inquiry !== null;
  useEffect(() => {
    if (loaded && window.location.hash === '#reply') {
      replyRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      replyRef.current?.focus({ preventScroll: true });
    }
  }, [loaded]);

  if (notFound) {
    return (
      <main className="page space-y-4 text-center">
        <p className="text-muted">この問い合わせは見つかりませんでした（削除された可能性があります）</p>
        <Link href="/staff/inquiries" className="btn btn-soft">
          送った問い合わせへ
        </Link>
      </main>
    );
  }
  if (!inquiry) {
    return <main className="page text-center text-muted">読み込み中…</main>;
  }

  const insertText = (text: string) => {
    setReplyBody((prev) => (prev.trim() ? `${prev}\n${text}` : text));
    replyRef.current?.focus();
  };

  const canSend = (replyBody.trim() !== '' || replyImages.length > 0) && authorName.trim() !== '';

  const sendReply = async () => {
    if (!canSend || posting) return;
    setPosting(true);
    setError('');
    rememberName(authorName);
    try {
      await apiFetch(`/inquiries/${id}/comments`, {
        method: 'POST',
        json: { author_name: authorName, author_role: 'staff', body: replyBody, images: replyImages },
      });
      // 返信した問い合わせは「送った問い合わせ」にも表示する
      rememberSentInquiry(inquiry.id);
      setReplyBody('');
      setReplyImages([]);
      draft.clear();
      setSentMessage('サポートチームへ送りました');
      setTimeout(() => setSentMessage(''), 2500);
      await loadInquiry();
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました');
    } finally {
      setPosting(false);
    }
  };

  return (
    <main className="page space-y-10">
      <Link href="/staff/inquiries" className="link text-sm">
        ← 送った問い合わせへ
      </Link>

      {/* ---------- 問い合わせ本体 ---------- */}
      <section className="card space-y-6">
        <div className="space-y-3">
          <StatusBadge status={inquiry.status} />
          <h1 className="text-xl leading-snug font-bold sm:text-2xl">{inquiry.title}</h1>
          <p className="text-xs text-muted">
            {inquiry.reporter_name} ・ {formatDateTime(inquiry.created_at)}
          </p>
        </div>
        {inquiry.status === 'waiting_info' && (
          <p className="rounded-2xl bg-warn-soft px-5 py-4 text-sm text-warn-ink">
            サポートチームが追加の情報を待っています。下の「やり取り」を確認して返信してください。
          </p>
        )}
        <p className="leading-loose whitespace-pre-wrap">
          <Linkify text={inquiry.body} />
        </p>
        <AttachmentGallery attachments={inquiry.attachments} />
      </section>

      {/* ---------- やり取りの履歴 ---------- */}
      <CommentList comments={inquiry.comments} />

      {/* ---------- 返信 ---------- */}
      {inquiry.status === 'closed' ? (
        <p className="text-center text-sm text-muted">この問い合わせは対応が完了しています</p>
      ) : (
        <section id="reply" className="card space-y-5">
          <h2 className="text-lg font-bold">サポートチームへ返信</h2>
          <textarea
            ref={replyRef}
            className="input h-32 resize-y"
            placeholder="返信を入力（Ctrl+Enter で送信）"
            aria-label="返信"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                sendReply();
              }
            }}
          />
          <PhotoPreviews images={replyImages} onChange={setReplyImages} />
          <div className="flex flex-wrap items-center gap-2">
            <PhotoPicker images={replyImages} onChange={setReplyImages} onError={setError} />
            {TEMPLATES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => insertText(t)}
                className="rounded-full bg-sunken px-4 py-1.5 text-left text-xs transition hover:bg-primary-soft"
              >
                {t}
              </button>
            ))}
          </div>
          <NameField value={authorName} onChange={setAuthorName} placeholder="所属・お名前" label="所属・お名前" />
          {error && <p className="animate-fade-in text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-4">
            <div className="mr-auto">
              <DraftStatus
                draft={draft}
                onDiscard={() => {
                  setReplyBody('');
                  draft.clear();
                }}
              />
            </div>
            {sentMessage && <span className="animate-fade-in text-sm font-bold text-primary">✓ {sentMessage}</span>}
            <button
              onClick={sendReply}
              disabled={posting || !canSend}
              className="btn btn-primary px-8"
            >
              {posting ? '送信中…' : '送信'}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
