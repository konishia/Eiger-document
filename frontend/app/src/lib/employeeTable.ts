// 従業員名簿の一括読み込み：CSV・Excel・貼り付けた表から、従業員コードと名前を取り出す
// - 必要なのは「従業員コード」と「名前」の2つだけ。ほかの列（入社日・電話番号など）があっても無視する
// - 見出しの行があれば、見出しの名前から列を探す（列の順番は問わない。表題の行などが上にあってもよい）
//   - 「所属」「部署」などの列もあれば、名前の前に付ける（例: 入園ゲート 田中）
//   - 「姓」「名」に分かれていれば、つなげて名前にする
//   - 「有効」「状態」「在籍」などの列があれば、「無効」「退職」などの行を無効として読み込む（無ければすべて有効）
// - 見出しが無ければ、1列目: 従業員コード / 2列目: 所属・お名前 / 3列目: 有効（省略可）とみなす

import type { Employee } from '@/lib/api';

export const EMPLOYEE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
const INACTIVE_WORDS = ['無効', '0', 'false', 'no', 'いいえ', '×', '✕', 'x', '退職', '退職済', '退職済み', '停止', '休止', 'inactive', 'disabled'];
// 見出しを探す範囲（上に表題や空行があってもよいように、先頭の数行を見る）
const HEADER_SEARCH_ROWS = 10;

export type ImportRow = {
  line: number;
  code: string;
  name: string;
  is_active: boolean;
  /** 誤りがあればその内容 */
  error?: string;
  /** 今の名簿と比べた結果 */
  kind?: 'create' | 'update' | 'same';
};

type Columns = {
  code: number;
  name?: number;
  lastName?: number;
  firstName?: number;
  affiliation?: number;
  active?: number;
};

export type ImportPreview = {
  rows: ImportRow[];
  /** どの列を何として読んだかの説明 */
  columns: string;
  /** 表全体として読めない場合の理由 */
  error?: string;
};

/** 見出しを比べやすい形にする（全角→半角、小文字、空白・記号を除く） */
function normalizeHeader(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・･_\-()（）［］[\]【】.:：/／]/g, '');
}

const isCodeHeader = (h: string) =>
  /^(従業員|社員|職員|スタッフ|employee|staff|emp)(コード|番号|no|id|cd|code|number)$/.test(h) ||
  /^(コード|code|id|no|番号|個人コード|個人番号|ログインid)$/.test(h);
const isKana = (h: string) => /(カナ|かな|ｶﾅ|ふりがな|フリガナ|kana|ローマ字|romaji|english)/.test(h);
const isNameHeader = (h: string) =>
  !isKana(h) &&
  (/(氏名|名前)/.test(h) || /^(従業員名|社員名|職員名|スタッフ名|表示名|name|fullname|employeename|staffname)$/.test(h));
const isLastNameHeader = (h: string) => !isKana(h) && /^(姓|苗字|名字|lastname|familyname|surname)$/.test(h);
const isFirstNameHeader = (h: string) => !isKana(h) && /^(名|firstname|givenname)$/.test(h);
const isAffiliationHeader = (h: string) => /(所属|部署|部門|配属|持ち場|担当|チーム|エリア|department|dept|team|section)/.test(h);
const isActiveHeader = (h: string) =>
  /^(有効|有効無効|状態|ステータス|在籍|在籍状況|在籍区分|在籍状態|active|status|enabled)$/.test(h);

/** 見出しの行から列を探す。従業員コードと名前の列が両方見つかったときだけ返す */
function findColumns(cells: string[]): Columns | null {
  const headers = cells.map(normalizeHeader);
  const indexOf = (test: (h: string) => boolean, except: number[] = []) => {
    const i = headers.findIndex((h, index) => h !== '' && !except.includes(index) && test(h));
    return i === -1 ? undefined : i;
  };
  const code = indexOf(isCodeHeader);
  if (code === undefined) return null;
  const name = indexOf(isNameHeader, [code]);
  const lastName = name === undefined ? indexOf(isLastNameHeader, [code]) : undefined;
  const firstName = name === undefined ? indexOf(isFirstNameHeader, [code]) : undefined;
  if (name === undefined && lastName === undefined && firstName === undefined) return null;
  const used = [code, name, lastName, firstName].filter((i): i is number => i !== undefined);
  // 「所属・お名前」のように1つの列にまとまっている場合は、所属の列として二重に使わない
  const affiliation = indexOf(isAffiliationHeader, used);
  const active = indexOf(isActiveHeader, [...used, ...(affiliation === undefined ? [] : [affiliation])]);
  return { code, name, lastName, firstName, affiliation, active };
}

function describe(columns: Columns, header: string[] | null): string {
  if (!header) return '見出しなし（1列目: 従業員コード、2列目: 所属・お名前、3列目: 有効）として読みました';
  const label = (i: number | undefined) => (i === undefined ? null : `「${header[i]}」`);
  const name =
    columns.name !== undefined ? label(columns.name) : [label(columns.lastName), label(columns.firstName)].filter(Boolean).join('＋');
  const parts = [
    `従業員コード: ${label(columns.code)}`,
    `名前: ${columns.affiliation !== undefined ? `${label(columns.affiliation)}＋` : ''}${name}`,
    columns.active !== undefined ? `有効: ${label(columns.active)}` : '有効: 列なし（すべて有効）',
  ];
  return `列の判定 … ${parts.join('、')}`;
}

/** 表（行 × 列）を、読み込む行の一覧にする。今の名簿と比べて追加・更新・変更なしも判定する */
export function toImportPreview(table: string[][], current: Employee[]): ImportPreview {
  const cell = (cells: string[], i: number | undefined) => (i === undefined ? '' : (cells[i] ?? '').trim());

  // 見出しの行を探す
  let headerIndex = -1;
  let columns: Columns = { code: 0, name: 1, active: 2 };
  for (let i = 0; i < Math.min(table.length, HEADER_SEARCH_ROWS); i++) {
    const found = findColumns(table[i]);
    if (found) {
      headerIndex = i;
      columns = found;
      break;
    }
  }
  if (headerIndex === -1) {
    // 見出しらしき行はあるのに、従業員コードか名前の列が見つからない場合は、列の順番で読まずに知らせる
    const partial = table.slice(0, HEADER_SEARCH_ROWS).find((cells) => {
      const headers = cells.map(normalizeHeader);
      return headers.some(isCodeHeader) || headers.some((h) => isNameHeader(h) || isLastNameHeader(h));
    });
    if (partial) {
      const headers = partial.map(normalizeHeader);
      const missing = headers.some(isCodeHeader) ? '名前（「氏名」「名前」など）' : '従業員コード（「従業員コード」「社員番号」など）';
      return {
        rows: [],
        columns: '',
        error: `見出しから${missing}の列が見つかりません。見出しの名前を確かめてください（見出し: ${partial.filter((c) => c.trim()).join('、')}）`,
      };
    }
  }

  const byCode = new Map(current.map((e) => [e.code, e]));
  const firstLine = new Map<string, number>();
  const rows: ImportRow[] = [];
  table.forEach((cells, index) => {
    if (index <= headerIndex) return; // 見出しと、その上の表題など
    const line = index + 1;
    const rawCode = cell(cells, columns.code);
    const personName =
      columns.name !== undefined
        ? cell(cells, columns.name)
        : [cell(cells, columns.lastName), cell(cells, columns.firstName)].filter(Boolean).join(' ');
    if (!rawCode && !personName) return; // 空行
    const affiliation = cell(cells, columns.affiliation);
    const name = [affiliation, personName].filter(Boolean).join(' ');
    const rawActive = cell(cells, columns.active);
    const code = rawCode.normalize('NFKC').trim();
    const is_active = !INACTIVE_WORDS.includes(rawActive.normalize('NFKC').toLowerCase());
    const row: ImportRow = { line, code, name, is_active };
    if (!code) {
      row.error = '従業員コードが空欄です';
    } else if (!EMPLOYEE_CODE_PATTERN.test(code)) {
      row.error = '従業員コードは英数字・ハイフン・アンダースコアの20文字以内にしてください';
    } else if (firstLine.has(code)) {
      row.error = `${firstLine.get(code)}行目と従業員コードが重複しています`;
    } else if (!personName) {
      row.error = '名前が空欄です';
    } else if (name.length > 100) {
      row.error = '所属・お名前は100文字以内にしてください';
    } else {
      const existing = byCode.get(code);
      row.kind = !existing
        ? 'create'
        : existing.name !== name || existing.is_active !== is_active
          ? 'update'
          : 'same';
    }
    if (code && !firstLine.has(code)) firstLine.set(code, line);
    rows.push(row);
  });
  return { rows, columns: describe(columns, headerIndex === -1 ? null : table[headerIndex]) };
}

/** CSV（またはタブ区切り）を行と列に分ける。"..." で囲んだ値の中のカンマ・改行にも対応する */
export function parseDelimited(text: string): string[][] {
  // 最初の空でない行で、タブとカンマの多いほうを区切り文字とする（Excel からのコピーはタブ区切り）
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter = count('\t') > 0 && count('\t') >= count(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 文字コードを判定して文字列にする（UTF-8 で読めなければ Shift_JIS とみなす） */
export function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

/** ファイルを Base64（data URL の接頭辞なし）にする */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
