// 名前記入欄の履歴（この端末で使った名前を覚えておき、次回から選べるようにする）

const STORAGE_KEY = 'saved-names';
const MAX_NAMES = 10;
// 以前のバージョンで1件だけ覚えていた名前（初回に履歴へ引き継ぐ）
const LEGACY_KEYS = ['quick-input-reporter-name', 'reply-author-name'];

export function loadNames(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as string[];
    const legacy = LEGACY_KEYS.map((k) => localStorage.getItem(k)?.trim()).filter((n): n is string => !!n);
    const names = [...new Set(legacy)];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
    return names;
  } catch {
    return [];
  }
}

function save(names: string[]): string[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch {
    // 保存できない環境では覚えない
  }
  return names;
}

/** 使った名前を履歴の先頭に追加する */
export function rememberName(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return loadNames();
  return save([trimmed, ...loadNames().filter((n) => n !== trimmed)].slice(0, MAX_NAMES));
}

/** 履歴から名前を消す */
export function forgetName(name: string): string[] {
  return save(loadNames().filter((n) => n !== name));
}
