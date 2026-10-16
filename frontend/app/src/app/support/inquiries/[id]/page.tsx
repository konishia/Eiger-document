'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import AuditTrail from '@/components/AuditTrail';
import DraftStatus from '@/components/DraftStatus';
import { AttachmentGallery, CommentList } from '@/components/InquiryParts';
import Linkify from '@/components/Linkify';
import NameField from '@/components/NameField';
import PhotoPicker, { PhotoPreviews } from '@/components/PhotoPicker';
import { apiFetch, formatDateTime, STATUS_LABELS, type ChatImage, type Inquiry, type InquiryStatus, withoutAiReplies } from '@/lib/api';
import { rememberName } from '@/lib/names';
import { useDraft } from '@/lib/useDraft';

// ワンタップで返信欄に入れられる定型文
const TEMPLATES = [
  '確認しますので、少々お待ちください。',
  'お手数ですが、予約番号（または注文番号）を教えてください。',
  'お客様に、アプリを最新版に更新して再起動していただくようご案内ください。',
  '確認が取れました。予約番号による手動処理で入園をご案内ください。',
  '対応が完了しました。ご協力ありがとうございました。',
];

const REFRESH_INTERVAL_MS = 15_000;

/** 返信後のステータスの既定値（初めて回答したら「一次回答提示済み」にする） */
function defaultNextStatus(status: InquiryStatus): InquiryStatus | '' {
  return status === 'open' || status === 'waiting_info' ? 'first_answered' : '';
}

/** サポートチーム用の問い合わせ詳細（編集・削除・返信。ステータスは返信と一緒に変える） */
export default function SupportInquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);

  // 編集
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editReporter, setEditReporter] = useState('');
  const [editBody, setEditBody] = useState('');

  // 返信フォーム
  const [authorName, setAuthorName] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replyImages, setReplyImages] = useState<ChatImage[]>([]);
  const [nextStatus, setNextStatus] = useState<InquiryStatus | ''>('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [posting, setPosting] = useState(false);
  const [sentMessage, setSentMessage] = useState('');
  const [error, setError] = useState('');
  const replyRef = useRef<HTMLTextAreaElement>(null);
  // 送信後のステータスの既定値を決めるのは最初の読み込み時だけ（選び直した内容を上書きしない）
  const statusApplied = useRef(false);
  // 返信の本文を、問い合わせごとに下書きとして自動保存する
  const draft = useDraft(`support-reply:${id}`, { body: replyBody }, (saved) => setReplyBody(saved.body ?? ''));
  // 送信や再読み込みのたびに変更履歴を読み直す
  const [historyVersion, setHistoryVersion] = useState(0);

  const loadInquiry = useCallback(async () => {
    const data = await apiFetch<Inquiry>(`/inquiries/${id}`);
    setInquiry(data);
    setHistoryVersion((v) => v + 1);
    return data;
  }, [id]);

  useEffect(() => {
    loadInquiry().then((data) => {
      if (!statusApplied.current) {
        statusApplied.current = true;
        setNextStatus(defaultNextStatus(data.status));
      }
    });

    // 相手の返信がすぐ見えるよう定期的に再読み込みする
    const timer = setInterval(loadInquiry, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadInquiry]);

  // 一覧の「返信する」や通知から開いたときは、表示後すぐ返信欄に入力できるようにする
  const loaded = inquiry !== null;
  useEffect(() => {
    if (loaded && window.location.hash === '#reply') {
      replyRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      replyRef.current?.focus({ preventScroll: true });
    }
  }, [loaded]);

  if (!inquiry) {
    return <main className="page text-center text-muted">読み込み中…</main>;
  }

  const startEdit = () => {
    setEditTitle(inquiry.title);
    setEditReporter(inquiry.reporter_name);
    setEditBody(withoutAiReplies(inquiry.body));
    setMenuOpen(false);
    setEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`/inquiries/${id}`, {
      method: 'PATCH',
      json: { title: editTitle, reporter_name: editReporter, body: editBody },
    });
    setEditing(false);
    loadInquiry();
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!confirm('この問い合わせを削除しますか？（やり取りの履歴・写真も削除されます）')) return;
    await apiFetch(`/inquiries/${id}`, { method: 'DELETE' });
    router.push('/support');
  };

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
        json: {
          author_name: authorName,
          author_role: 'support',
          body: replyBody,
          images: replyImages,
          new_status: nextStatus || null,
        },
      });
      setReplyBody('');
      setReplyImages([]);
      draft.clear();
      setSentMessage('送信しました');
      setTimeout(() => setSentMessage(''), 2500);
      const data = await loadInquiry();
      setNextStatus(defaultNextStatus(data.status));
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました');
    } finally {
      setPosting(false);
    }
  };

  return (
    <main className="page space-y-10">
      <Link href="/support" className="link text-sm">
        ← 一覧へ
      </Link>

      {/* ---------- 問い合わせ本体 ---------- */}
      <section className="card space-y-6">
        {editing ? (
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} aria-label="件名" required />
            <input
              className="input"
              value={editReporter}
              onChange={(e) => setEditReporter(e.target.value)}
              aria-label="起票者"
              required
            />
            <textarea
              className="input h-56"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              aria-label="内容"
              required
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="btn btn-ghost">
                やめる
              </button>
              <button type="submit" className="btn btn-primary">
                保存
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-3">
                <h1 className="text-xl leading-snug font-bold sm:text-2xl">{inquiry.title}</h1>
                <p className="text-xs text-muted">
                  {inquiry.reporter_name} ・ {formatDateTime(inquiry.created_at)}
                </p>
              </div>
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="btn btn-ghost h-10 w-10 p-0 text-lg"
                  aria-label="その他の操作"
                  aria-expanded={menuOpen}
                >
                  ⋯
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
                    <div className="absolute right-0 z-20 mt-2 w-36 origin-top-right animate-pop-in overflow-hidden rounded-2xl border border-line bg-card p-1 shadow-soft">
                      <button onClick={startEdit} className="w-full rounded-xl px-4 py-2 text-left text-sm hover:bg-sunken">
                        編集する
                      </button>
                      <button
                        onClick={handleDelete}
                        className="w-full rounded-xl px-4 py-2 text-left text-sm text-danger hover:bg-danger-soft"
                      >
                        削除する
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <p className="leading-loose whitespace-pre-wrap">
              <Linkify text={withoutAiReplies(inquiry.body)} />
            </p>

            <AttachmentGallery attachments={inquiry.attachments} />

            {inquiry.summary && <p className="rounded-2xl bg-sunken px-5 py-4 text-sm text-muted">{inquiry.summary}</p>}
          </>
        )}
      </section>

      {/* ---------- 返信（すぐ返信できるよう上部に置く） ---------- */}
      <section id="reply" className="card space-y-5">
        <h2 className="text-lg font-bold">返信</h2>

        <textarea
          ref={replyRef}
          className="input h-36 resize-y"
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

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <PhotoPicker images={replyImages} onChange={setReplyImages} onError={setError} />
            <button onClick={() => setShowTemplates((v) => !v)} className="btn btn-ghost btn-sm" aria-expanded={showTemplates}>
              {showTemplates ? '▲' : '▼'} 定型文
            </button>
          </div>
          {showTemplates && (
            <div className="flex animate-fade-up flex-wrap gap-2">
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
          )}
        </div>

        <NameField value={authorName} onChange={setAuthorName} placeholder="あなたの名前" label="あなたの名前" />

        <div className="flex justify-end">
          <select
            className="input w-auto py-2.5 text-sm"
            value={nextStatus}
            onChange={(e) => setNextStatus(e.target.value as InquiryStatus | '')}
            aria-label="送信後のステータス"
          >
            <option value="">ステータスはそのまま</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                送信後「{label}」にする
              </option>
            ))}
          </select>
        </div>

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

      {/* ---------- やり取りの履歴 ---------- */}
      <CommentList comments={inquiry.comments} />

      {/* ---------- 変更履歴（監査ログ） ---------- */}
      <AuditTrail inquiryId={inquiry.id} version={historyVersion} />
    </main>
  );
}
