'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import DateTimeField, { isDateTimeField } from '@/components/DateTimeField';
import Linkify from '@/components/Linkify';
import NameField from '@/components/NameField';
import PhotoPicker, { PhotoPreviews } from '@/components/PhotoPicker';
import {
  apiFetch,
  inquiryPath,
  type AICheckResult,
  type ChatImage,
  type ChatMessage,
  type ChatReply,
  type Inquiry,
  type RequiredField,
} from '@/lib/api';
import { jpegDataUrl } from '@/lib/image';
import { rememberName } from '@/lib/names';
import { rememberSentInquiry } from '@/lib/sent';
import { useDraft } from '@/lib/useDraft';

const CHAT_STORAGE_KEY = 'quick-chat';

const EXAMPLES = [
  '年間パスのQRコードが入園ゲートで読み取れません',
  'お客様が年間パスの顔写真を登録できないと言っています',
  'クレジットカードで決済したのに購入完了にならないそうです',
];

type SavedChat = { messages: ChatMessage[]; lastReply: ChatReply | null };

function loadChat(): SavedChat {
  try {
    const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedChat;
  } catch {
    // 読み込めなければ新しい会話から始める
  }
  return { messages: [], lastReply: null };
}

function saveChat(chat: SavedChat) {
  try {
    sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chat));
  } catch {
    // 写真が多く保存容量を超えた場合は、写真を除いて保存する
    try {
      const withoutImages = chat.messages.map(({ role, content }) => ({ role, content }));
      sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ ...chat, messages: withoutImages }));
    } catch {
      // 保存できなくても会話は続けられる
    }
  }
}

/**
 * かんたん問い合わせ（AIチャット）
 * - 来場者対応中の困りごとをAIにチャットで質問できる（写真も貼付できる）
 * - AIで解決できなければ、会話ごとサポートチームへ送る
 * - 使った名前は端末に記憶し、次回から選べる。URLパラメータ ?name=入園ゲート%20田中 で事前入力もできる（持ち場に貼るQRコード用）
 */
export default function QuickInquiryPage() {
  const [name, setName] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastReply, setLastReply] = useState<ChatReply | null>(null);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // サポートチームへの送信フォーム
  const [showEscalate, setShowEscalate] = useState(false);
  const [title, setTitle] = useState('');
  const [escalating, setEscalating] = useState(false);
  const [escalated, setEscalated] = useState<Inquiry | null>(null);
  // 送る前に聞き出す、足りない必須項目（発生日時・予約番号など）とその回答
  const [requiredFields, setRequiredFields] = useState<RequiredField[]>([]);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [fieldAnswers, setFieldAnswers] = useState<Record<string, string>>({});
  const [checkingFields, setCheckingFields] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  // 入力途中の質問を下書きとして自動保存する（送ると入力欄が空になり消える）
  useDraft('staff-chat', { input }, (saved) => setInput(saved.input ?? ''));

  useEffect(() => {
    const saved = loadChat();
    setMessages(saved.messages);
    setLastReply(saved.lastReply);
    // 持ち場のQRコードなどから開いたときは、URLの名前を使う
    const fromUrl = new URLSearchParams(window.location.search).get('name');
    if (fromUrl) setName(fromUrl);
    apiFetch<RequiredField[]>('/required-fields')
      .then((fields) => setRequiredFields(fields.filter((f) => f.is_active)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    saveChat({ messages, lastReply });
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, lastReply]);

  const send = async (text: string, images: ChatImage[] = pendingImages) => {
    if ((!text.trim() && images.length === 0) || sending) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text.trim(), images }];
    setMessages(next);
    setInput('');
    setPendingImages([]);
    setSending(true);
    setError('');
    try {
      const reply = await apiFetch<ChatReply>('/chat', { method: 'POST', json: { messages: next } });
      setMessages([...next, { role: 'assistant', content: reply.answer }]);
      setLastReply(reply);
      setTitle(reply.suggested_title);
      // AIで解決できない場合は、そのままサポートチームへ送れるようにする
      if (reply.can_resolve) setShowEscalate(false);
      else openEscalate(reply.suggested_title, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました');
      setMessages(messages);
      setInput(text);
      setPendingImages(images);
    } finally {
      setSending(false);
    }
  };

  /** 送信フォームを開き、チャットの内容に足りない必須項目をその場で聞き出す */
  const openEscalate = async (suggestedTitle = title, conversation = messages) => {
    const firstQuestion = conversation.find((m) => m.role === 'user' && m.content)?.content ?? '写真の確認依頼';
    const nextTitle = suggestedTitle || firstQuestion.split('\n')[0].slice(0, 30);
    setTitle(nextTitle);
    setShowEscalate(true);
    setMissingFields([]);
    setFieldAnswers({});
    setCheckingFields(true);
    try {
      const body = conversation
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join('\n');
      const result = await apiFetch<AICheckResult>('/ai/precheck', { method: 'POST', json: { title: nextTitle, body } });
      setMissingFields(result.missing_fields);
    } catch {
      // 確認できなくても、そのまま送信はできる
    } finally {
      setCheckingFields(false);
    }
  };

  const handleEscalate = async (e: React.FormEvent) => {
    e.preventDefault();
    // 聞き出す項目はすべて必須（分からない場合はスペースだけ入力して空欄として送れる）
    if (missingFields.some((f) => !fieldAnswers[f])) {
      setError('すべての項目を入力してください');
      return;
    }
    setError('');
    setEscalating(true);
    rememberName(name);
    // 聞き出した情報を、職員のメッセージとしてやり取りに加えて送る
    const addedInfo = missingFields.map((f) => `【${f}】${fieldAnswers[f].trim()}`).join('\n');
    const conversation: ChatMessage[] = addedInfo ? [...messages, { role: 'user', content: addedInfo }] : messages;
    try {
      const inquiry = await apiFetch<Inquiry>('/chat/escalate', {
        method: 'POST',
        json: { title, reporter_name: name, messages: conversation },
      });
      rememberSentInquiry(inquiry.id);
      setEscalated(inquiry);
      setMessages([]);
      setLastReply(null);
      setShowEscalate(false);
      setTitle('');
      setMissingFields([]);
      setFieldAnswers({});
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました');
    } finally {
      setEscalating(false);
    }
  };

  const reset = () => {
    setMessages([]);
    setLastReply(null);
    setShowEscalate(false);
    setTitle('');
    setEscalated(null);
    setPendingImages([]);
    setError('');
  };

  if (escalated) {
    return (
      <main className="page">
        <div className="card animate-pop-in space-y-6 text-center">
          <div className="text-5xl" aria-hidden>
            📨
          </div>
          <div className="space-y-2">
            <p className="text-lg font-bold">サポートチームへ送りました</p>
            <p className="text-sm text-muted">回答が届いたら 🔔 でお知らせします</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={inquiryPath('staff', escalated.id)} className="btn btn-soft">
              送った内容を見る
            </Link>
            <button onClick={reset} className="btn btn-primary">
              新しい相談
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page flex min-h-[calc(100vh-4.5rem)] flex-col">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="page-title">かんたん問い合わせ</h1>
          <p className="text-sm text-muted">
            困ったことをAIにすぐ聞けます（
            <Link href="/staff/new" className="link">
              フォームで送る
            </Link>
            ）
          </p>
        </div>
        {messages.length > 0 && (
          <button onClick={reset} className="btn btn-ghost btn-sm">
            新しい相談
          </button>
        )}
      </div>

      {messages.length === 0 && (
        <div className="mb-8 space-y-3">
          {EXAMPLES.map((ex, i) => (
            <button
              key={ex}
              onClick={() => send(ex, [])}
              className="block w-full animate-fade-up rounded-2xl border border-line bg-card px-5 py-4 text-left text-sm shadow-soft transition duration-200 hover:-translate-y-0.5 hover:border-primary/50"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      <ul className="mb-6 flex-1 space-y-5">
        {messages.map((m, i) => (
          <li key={i} className={`flex animate-pop-in ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] space-y-2 rounded-3xl px-5 py-3 text-sm leading-relaxed ${
                m.role === 'user' ? 'rounded-br-lg bg-primary text-on-primary' : 'rounded-bl-lg bg-card shadow-soft'
              }`}
            >
              {m.images && m.images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {m.images.map((img, j) => (
                    <img key={j} src={jpegDataUrl(img.data)} alt={`貼付した写真${j + 1}`} className="h-28 rounded-2xl object-cover" />
                  ))}
                </div>
              )}
              {m.content && (
                <p className="whitespace-pre-wrap">
                  <Linkify text={m.content} />
                </p>
              )}
            </div>
          </li>
        ))}
        {sending && (
          <li className="flex animate-fade-in justify-start">
            <div className="rounded-3xl rounded-bl-lg bg-card px-5 py-3 text-sm text-muted shadow-soft">
              <span className="inline-block animate-pulse">考えています…</span>
            </div>
          </li>
        )}
      </ul>

      {lastReply && !sending && !showEscalate && (
        <div className="mb-6 flex animate-fade-up flex-wrap justify-center gap-3">
          <button onClick={reset} className="btn btn-soft">
            ✓ 解決した
          </button>
          <button onClick={() => openEscalate()} className="btn btn-ghost">
            解決しない → サポートへ
          </button>
        </div>
      )}

      {showEscalate && (
        <form onSubmit={handleEscalate} className="mb-6 animate-pop-in space-y-5 rounded-3xl bg-accent-soft p-6">
          <div className="space-y-1">
            <p className="font-bold text-accent-ink">
              {lastReply && !lastReply.can_resolve ? 'AIでは解決できませんでした' : 'サポートチームへ送ります'}
            </p>
            <p className="text-xs text-accent-ink">このやり取り（写真も）がそのまま届きます</p>
          </div>

          {/* サポートチームがすぐ対応できるよう、足りない情報をその場で聞き出す */}
          {checkingFields && <p className="animate-fade-in text-sm text-accent-ink">必要な情報がそろっているか確認しています…</p>}
          {!checkingFields && missingFields.length > 0 && (
            <div className="animate-fade-up space-y-4 rounded-2xl bg-card p-5">
              <p className="text-sm font-bold">サポートチームがすぐ対応できるよう、次の情報を教えてください</p>
              {missingFields.map((field) => {
                const description = requiredFields.find((f) => f.name === field)?.description;
                const setAnswer = (value: string) => setFieldAnswers((prev) => ({ ...prev, [field]: value }));
                return (
                  <div key={field} className="space-y-1">
                    <span className="block text-sm font-bold">
                      {field}
                      <span className="ml-1 text-danger">*</span>
                    </span>
                    {/* 発生日時などはカレンダーから選べるようにする */}
                    {isDateTimeField(field) ? (
                      <DateTimeField label={field} onChange={setAnswer} required />
                    ) : (
                      <input
                        className="input"
                        aria-label={field}
                        placeholder={description || field}
                        value={fieldAnswers[field] ?? ''}
                        onChange={(e) => setAnswer(e.target.value)}
                        required
                      />
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-muted">* はすべて入力が必要です。分からない場合はスペースキーで空欄にしてください</p>
            </div>
          )}

          <input
            className="input"
            placeholder="件名"
            aria-label="件名"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <NameField
            value={name}
            onChange={setName}
            placeholder="所属・お名前（例: 入園ゲート 田中）"
            label="所属・お名前"
            required
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowEscalate(false)} className="btn btn-ghost">
              やめる
            </button>
            <button type="submit" disabled={escalating || checkingFields} className="btn btn-accent">
              {escalating ? '送信中…' : 'サポートチームへ送る'}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mb-3 animate-fade-in text-center text-sm text-danger">{error}</p>}

      <div className="sticky bottom-4 space-y-3 rounded-3xl border border-line bg-card p-3 shadow-soft">
        {pendingImages.length > 0 && (
          <div className="px-1 pt-1">
            <PhotoPreviews images={pendingImages} onChange={setPendingImages} />
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2"
        >
          <PhotoPicker images={pendingImages} onChange={setPendingImages} onError={setError} openUpward />
          <textarea
            className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl bg-transparent px-2 py-2.5 text-sm focus:outline-none"
            rows={1}
            placeholder="困っていることを入力"
            aria-label="質問"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button
            type="submit"
            disabled={sending || (!input.trim() && pendingImages.length === 0)}
            className="btn btn-primary h-11 shrink-0"
          >
            送信
          </button>
        </form>
      </div>
      <div ref={bottomRef} />
    </main>
  );
}
