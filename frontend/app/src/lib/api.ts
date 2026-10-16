// バックエンドAPIの型とfetchヘルパー
// 型は backend/app/schemas.py と対応させている

import { loadNames } from '@/lib/names';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

export type InquiryStatus = 'open' | 'waiting_info' | 'first_answered' | 'closed';
export type AuthorRole = 'staff' | 'support' | 'ai';
export type ViewerRole = 'staff' | 'support';

export const SORT_LABELS = {
  newest: '新しい順',
  oldest: '古い順',
  updated: '更新が新しい順',
} as const;
export type SortKey = keyof typeof SORT_LABELS;

export const STATUS_LABELS: Record<InquiryStatus, string> = {
  open: '未対応',
  waiting_info: '情報待ち',
  first_answered: '一次回答提示済み',
  closed: '対応完了',
};

export const STATUS_COLORS: Record<InquiryStatus, string> = {
  open: 'bg-accent-soft text-accent-ink',
  waiting_info: 'bg-warn-soft text-warn-ink',
  first_answered: 'bg-info-soft text-info-ink',
  closed: 'bg-sunken text-muted',
};

export const ROLE_LABELS: Record<AuthorRole, string> = {
  staff: '現場スタッフ',
  support: 'サポートチーム',
  ai: 'AI',
};

export type InquirySummary = {
  id: number;
  title: string;
  reporter_name: string;
  status: InquiryStatus;
  summary: string | null;
  created_at: string;
  updated_at: string;
  comment_count: number;
  /** 最後のコメントの投稿者（support なら「回答あり」） */
  last_comment_role: AuthorRole | null;
};

export type Comment = {
  id: number;
  inquiry_id: number;
  author_name: string;
  author_role: AuthorRole;
  body: string;
  created_at: string;
  /** 返信に付けた写真 */
  attachments: Attachment[];
};

export type Inquiry = {
  id: number;
  title: string;
  body: string;
  reporter_name: string;
  status: InquiryStatus;
  summary: string | null;
  summary_generated_at: string | null;
  ai_missing_fields: string[];
  ai_questions: string[];
  ai_probable_cause: string | null;
  ai_action_required: boolean | null;
  ai_draft_answer: string | null;
  ai_checked_at: string | null;
  created_at: string;
  updated_at: string;
  comments: Comment[];
  attachments: Attachment[];
};

export type Attachment = {
  id: number;
  media_type: string;
  created_at: string;
};

export function attachmentUrl(id: number): string {
  return `${API_BASE_URL}/attachments/${id}`;
}

export type InquiryCreate = {
  title: string;
  body: string;
  reporter_name: string;
};

export type AppNotification = {
  id: number;
  target_role: ViewerRole;
  inquiry_id: number | null;
  message: string;
  is_read: boolean;
  created_at: string;
};

export type NotificationList = {
  unread_count: number;
  items: AppNotification[];
};

export type ChatImage = {
  /** Base64 で符号化した JPEG（画面で縮小してから送る） */
  data: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImage[];
};

/** ログイン中の権限（現場スタッフ / サポートチーム と、それぞれの管理者） */
export type LoginRole = 'staff' | 'support' | 'staff_admin' | 'support_admin';

/** ログイン中の利用者（GET /auth/me） */
export type Me = {
  role: LoginRole;
  employee_code: string;
  /** 従業員名簿の「所属・お名前」。名簿に無ければ空（管理者のみ） */
  employee_name: string;
};

/** 従業員名簿の1人 */
export type Employee = {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

/** 権限が使えるサイト */
export function siteOfRole(role: LoginRole): ViewerRole {
  return role === 'staff' || role === 'staff_admin' ? 'staff' : 'support';
}

/** 管理者（自分のサイトのパスワードを変更できる）かどうか */
export function isAdminRole(role: LoginRole): boolean {
  return role === 'staff_admin' || role === 'support_admin';
}

export type ChatReply = {
  answer: string;
  /** 回答で引用したよくある質問 */
  faq_refs: { question: string; url: string }[];
  can_resolve: boolean;
  suggested_title: string;
  engine: 'claude' | 'rule';
};

export type AICheckResult = {
  is_complete: boolean;
  missing_fields: string[];
  questions: string[];
  probable_cause: string | null;
  action_required: boolean | null;
  draft_answer: string | null;
  engine: 'claude' | 'rule';
};

export type RequiredField = {
  id: number;
  name: string;
  description: string;
  keywords: string;
  is_active: boolean;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSONを送受信する fetch のラッパー。エラー時は例外を投げる。未ログインならログイン画面へ移動する */
export async function apiFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const headers: Record<string, string> = {};
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  // 監査ログの「誰が」に使う、この端末で最後に使った名前（日本語なのでURLエンコードして送る）
  const actorName = loadNames()[0];
  if (actorName) headers['X-Actor-Name'] = encodeURIComponent(actorName);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    // ログインのセッション Cookie を送受信する
    credentials: 'include',
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/') && window.location.pathname !== '/login') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    let message = `APIエラー (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === 'string') message = data.detail;
      // 入力チェックのエラーは項目ごとのメッセージをまとめて表示する
      if (Array.isArray(data.detail)) message = data.detail.map((d: { msg: string }) => d.msg).join('／');
    } catch {
      // JSON以外のエラー本文はそのまま既定のメッセージを使う
    }
    throw new ApiError(res.status, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** 開いているサイト（現場スタッフ用 /staff、サポートチーム用 /support）。どちらでもなければ null */
export function siteOf(pathname: string): ViewerRole | null {
  if (pathname === '/staff' || pathname.startsWith('/staff/')) return 'staff';
  if (pathname === '/support' || pathname.startsWith('/support/')) return 'support';
  return null;
}

/** サイトごとの問い合わせ詳細画面のURL */
export function inquiryPath(site: ViewerRole, id: number, toReply = false): string {
  return `/${site}/inquiries/${id}${toReply ? '#reply' : ''}`;
}

/** 「3分前」「昨日」のような、ぱっと見て分かる日時 */
export function formatRelative(value: string): string {
  const diffMin = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return '昨日';
  if (diffDay < 7) return `${diffDay}日前`;
  return new Date(value).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 「15分」「2時間30分」「1日4時間」のような、かかった時間の表示 */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  const total = Math.round(minutes);
  if (total < 60) return `${total}分`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return hours > 0 ? `${days}日${hours}時間` : `${days}日`;
  return mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
}

// ---------- ダッシュボード ----------

export type CategoryStat = {
  name: string;
  count: number;
  unresolved_count: number;
  avg_first_response_minutes: number | null;
  avg_resolution_minutes: number | null;
};

export type Dashboard = {
  days: number | null;
  since: string | null;
  total: number;
  previous_total: number | null;
  unresolved_total: number;
  status_counts: Record<InquiryStatus, number>;
  avg_first_response_minutes: number | null;
  median_first_response_minutes: number | null;
  first_response_count: number;
  avg_resolution_minutes: number | null;
  median_resolution_minutes: number | null;
  resolution_count: number;
  daily: { date: string; count: number }[];
  hourly: { hour: number; count: number }[];
  /** 0（月）〜 6（日） */
  weekday: { weekday: number; count: number }[];
  categories: CategoryStat[];
};

// ---------- 監査ログ ----------

export type AuditLog = {
  id: number;
  created_at: string;
  actor_role: LoginRole | 'system' | 'anonymous';
  /** ログイン時に入力した従業員コード */
  employee_code: string;
  actor_name: string;
  ip_address: string;
  action: string;
  inquiry_id: number | null;
  /** 問い合わせが残っているか（削除済みなら false） */
  inquiry_exists: boolean;
  summary: string;
  /** {"項目": [変更前, 変更後]} */
  changes: Record<string, [string | null, string | null]>;
};

export type AuditLogList = {
  total: number;
  items: AuditLog[];
};

export const ACTOR_ROLE_LABELS: Record<AuditLog['actor_role'], string> = {
  staff: '現場スタッフ',
  support: 'サポートチーム',
  staff_admin: '現場スタッフ管理者',
  support_admin: 'サポートチーム管理者',
  system: '自動処理',
  anonymous: 'ログイン前',
};

/** 操作の種類（backend/app/audit.py の ACTION_LABELS と対応） */
export const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'ログイン',
  'auth.login_failed': 'ログイン失敗',
  'auth.password_change': 'パスワード変更',
  'inquiry.create': '問い合わせ作成',
  'inquiry.update': '問い合わせ編集',
  'inquiry.delete': '問い合わせ削除',
  'inquiry.status': 'ステータス自動変更',
  'comment.create': '返信',
  'ai.recheck': 'AIチェック再実行',
  'required_field.create': '必須項目追加',
  'required_field.update': '必須項目編集',
  'required_field.delete': '必須項目削除',
  'employee.create': '従業員登録',
  'employee.update': '従業員編集',
  'employee.import': '従業員一括読み込み',
  'employee.delete': '従業員削除',
  'faq.refresh': 'FAQ取り込み',
  'batch.summaries': '要約バッチ実行',
};

/**
 * AIチャットから送られた問い合わせの内容から、AIの回答・考察（【AI】で始まる部分）を除く
 * 以前は「【職員】…」「【AI】…」と交互に保存していたので、職員の発言だけを残して見出しも外す
 */
export function withoutAiReplies(body: string): string {
  if (!body.startsWith('【職員】')) return body;
  return body
    .split(/\n\n(?=【(?:職員|AI)】)/)
    .filter((part) => !part.startsWith('【AI】'))
    .map((part) => part.replace(/^【職員】/, ''))
    .join('\n\n');
}
