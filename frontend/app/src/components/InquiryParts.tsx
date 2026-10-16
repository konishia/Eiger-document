// 問い合わせ詳細画面の共通部品（現場スタッフ用・サポートチーム用の両方で使う）

import Linkify from '@/components/Linkify';
import { attachmentUrl, formatRelative, ROLE_LABELS, type Attachment, type AuthorRole, type Comment } from '@/lib/api';

const ROLE_STYLES: Record<AuthorRole, string> = {
  staff: 'bg-card',
  support: 'bg-info-soft',
  ai: 'bg-ai-soft',
};

/** 添付写真のサムネイル（タップで拡大） */
export function AttachmentGallery({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {attachments.map((a, i) => (
        <a
          key={a.id}
          href={attachmentUrl(a.id)}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-2xl transition duration-200 hover:scale-[1.03]"
        >
          <img src={attachmentUrl(a.id)} alt={`添付写真${i + 1}`} className="h-28 w-28 object-cover" />
        </a>
      ))}
    </div>
  );
}

/** やり取りの履歴 */
export function CommentList({ comments }: { comments: Comment[] }) {
  return (
    <section className="space-y-5">
      <h2 className="text-lg font-bold">やり取り</h2>
      {comments.length === 0 ? (
        <p className="text-sm text-muted">まだやり取りはありません</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className={`animate-fade-up rounded-3xl px-6 py-5 shadow-soft ${ROLE_STYLES[c.author_role]}`}>
              <p className="mb-2 text-xs text-muted">
                <span className="font-bold text-ink">{c.author_name}</span>
                {c.author_role !== 'ai' && `（${ROLE_LABELS[c.author_role]}）`} ・ {formatRelative(c.created_at)}
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                <Linkify text={c.body} />
              </p>
              {c.attachments.length > 0 && (
                <div className="mt-3">
                  <AttachmentGallery attachments={c.attachments} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
