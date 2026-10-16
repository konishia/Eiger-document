import type { DraftState } from '@/lib/useDraft';

function formatTime(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 下書きの自動保存の状態（「下書きを保存しました 10:15」）と、復元した下書きの破棄ボタン */
export default function DraftStatus({ draft, onDiscard }: { draft: DraftState; onDiscard: () => void }) {
  if (!draft.savedAt) return null;
  return (
    <p className="flex animate-fade-in flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-live="polite">
      <span>
        {draft.restored ? '前回の下書きを復元しました' : '下書きを自動保存しました'}（{formatTime(draft.savedAt)}）
      </span>
      <button
        type="button"
        onClick={() => {
          if (confirm('下書きを破棄しますか？（入力した内容は消えます）')) onDiscard();
        }}
        className="link"
      >
        下書きを破棄
      </button>
    </p>
  );
}
