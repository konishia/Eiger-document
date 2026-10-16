// 現場スタッフがこの端末から送った問い合わせ（「送った問い合わせ」画面で状況を確認するため）

const STORAGE_KEY = 'sent-inquiry-ids';
const MAX_IDS = 100;

export function loadSentInquiryIds(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

/** 送った問い合わせを覚えておく（新しいものを先頭に） */
export function rememberSentInquiry(id: number): void {
  try {
    const ids = [id, ...loadSentInquiryIds().filter((i) => i !== id)].slice(0, MAX_IDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 保存できない環境では一覧に出ない（問い合わせ自体は送られている）
  }
}

/** 削除された問い合わせなどを一覧から外す */
export function keepSentInquiryIds(existing: number[]): void {
  try {
    const set = new Set(existing);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadSentInquiryIds().filter((i) => set.has(i))));
  } catch {
    // 保存できなくても表示には影響しない
  }
}
