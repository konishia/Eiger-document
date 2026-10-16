'use client';

import { useMemo, useRef, useState } from 'react';

import { apiFetch, type Employee, type ViewerRole } from '@/lib/api';
import { decodeText, fileToBase64, parseDelimited, toImportPreview, type ImportRow } from '@/lib/employeeTable';

// 従業員名簿を、CSV・Excelのファイル、またはコピー＆ペーストで一括で読み込む
// - 必要なのは「従業員コード」と「名前」だけ。見出しから列を探すので、ほかの列があっても、列の順番が違ってもよい
//   （列の探し方は lib/employeeTable.ts）
// - CSV は Excel で「CSV UTF-8」「CSV」どちらで保存したファイルでも読める（文字コードを自動で判定する）
// - Excel（.xlsx / .xls）はサーバーで表にしてから、ここで内容を確認する
// - Excel・Googleスプレッドシート・Wordの表などからコピーした内容（タブ区切り）も貼り付けて読める
// - 貼り付け欄にファイルそのもの（エクスプローラーでコピーしたファイル）を貼り付けた場合は、ファイルとして読む

const MAX_FILE_BYTES = 2 * 1024 * 1024;
// ひな形の例（名簿はサイトごとに別なので、例もサイトに合わせる）
const TEMPLATES: Record<ViewerRole, string> = {
  staff: '従業員コード,所属・お名前,有効\r\nG001,入園ゲート 田中,有効\r\nA001,動物エリア 佐藤,有効\r\n',
  support: '従業員コード,所属・お名前,有効\r\nS001,サポートチーム 鈴木,有効\r\nS002,サポートチーム 佐藤,有効\r\n',
};
const EXCEL_FILE = /\.(xlsx|xlsm|xls)$/i;

type ImportResult = { created: number; updated: number; unchanged: number };

const KIND_LABELS = { create: '追加', update: '更新', same: '変更なし' } as const;

function downloadTemplate(site: ViewerRole) {
  // Excel で文字化けしないよう、先頭に BOM を付けた UTF-8 で保存する
  const blob = new Blob(['﻿' + TEMPLATES[site]], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `従業員名簿_${site === 'staff' ? '現場スタッフ' : 'サポートチーム'}_ひな形.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PASTE_LABEL = '貼り付けた内容';

/** 従業員名簿の一括読み込み（ファイルを選ぶ、または貼り付ける → 内容を確認 → 読み込む） */
export default function EmployeeImport({
  site,
  employees,
  onImported,
}: {
  site: ViewerRole;
  employees: Employee[];
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  // 貼り付け欄の内容（貼り付け後に欄の中で直すこともできる）
  const [pasted, setPasted] = useState('');
  // 読み取った表（行 × 列）。追加・更新の判定は、名簿を読み直したらその時点の内容でやり直す
  const [table, setTable] = useState<string[][] | null>(null);
  const preview = useMemo(() => (table === null ? null : toImportPreview(table, employees)), [table, employees]);
  const rows = preview && !preview.error ? preview.rows : null;
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const reset = () => {
    setTable(null);
    setFileName('');
    setPasted('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handlePastedChange = (value: string) => {
    setError('');
    setMessage('');
    setPasted(value);
    if (value.trim() === '') {
      setTable(null);
      setFileName('');
      return;
    }
    setFileName(PASTE_LABEL);
    setTable(parseDelimited(value));
  };

  // ファイルそのものを貼り付けた場合（エクスプローラーでコピーしたファイルなど）は、ファイルとして読む
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = e.clipboardData.files[0];
    if (file) {
      e.preventDefault();
      handleFile(file);
    }
  };

  const handleFile = async (file: File | undefined) => {
    setError('');
    setMessage('');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('ファイルが大きすぎます（2MBまで）');
      return;
    }
    setReading(true);
    try {
      let next: string[][];
      let label = file.name;
      if (EXCEL_FILE.test(file.name)) {
        const res = await apiFetch<{ sheet: string; rows: string[][] }>('/employees/read-excel', {
          method: 'POST',
          json: { data: await fileToBase64(file) },
        });
        next = res.rows;
        label = `${file.name}（シート「${res.sheet}」）`;
      } else {
        next = parseDelimited(decodeText(await file.arrayBuffer()));
      }
      const checked = toImportPreview(next, employees);
      if (!checked.error && checked.rows.length === 0) {
        setError('読み込める行がありません');
        return;
      }
      setPasted('');
      setFileName(label);
      setTable(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ファイルを読み取れませんでした');
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleImport = async () => {
    if (!rows) return;
    setImporting(true);
    setError('');
    try {
      const result = await apiFetch<ImportResult>('/employees/import', {
        method: 'POST',
        json: { rows: rows.map(({ line, code, name, is_active }) => ({ line, code, name, is_active })) },
      });
      setMessage(`読み込みました（追加 ${result.created}人・更新 ${result.updated}人・変更なし ${result.unchanged}人）`);
      reset();
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  const errorCount = rows?.filter((r) => r.error).length ?? 0;
  const count = (kind: ImportRow['kind']) => rows?.filter((r) => r.kind === kind).length ?? 0;

  return (
    <div className="space-y-4 rounded-2xl bg-sunken p-5">
      <div className="space-y-1">
        <h3 className="font-bold">ファイル・貼り付けで一括で読み込む</h3>
        <p className="text-xs text-muted">
          Excel・CSVのファイルを選ぶか、名簿をコピーして下の欄に貼り付けてください。必要なのは「従業員コード」と「名前」の列だけで、
          見出しから列を自動で探します（「所属」「有効」などの列があれば一緒に読みます。見出しが無ければ 1列目: 従業員コード、2列目:
          所属・お名前、3列目: 有効）。名簿にある従業員コードは上書きし、読み込む内容に無い従業員はそのまま残します。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`btn btn-soft cursor-pointer ${reading ? 'pointer-events-none opacity-60' : ''}`}>
          {reading ? '読み取り中…' : '📄 ファイルを選ぶ（Excel・CSV）'}
          <input
            ref={inputRef}
            type="file"
            disabled={reading}
            accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
        <button type="button" onClick={() => downloadTemplate(site)} className="btn btn-ghost btn-sm">
          ひな形をダウンロード
        </button>
      </div>
      <textarea
        className="input min-h-28 font-mono text-xs"
        placeholder={'ここに貼り付け（Ctrl+V / ⌘+V）\n例）Excelで見出しの行ごと名簿を選んでコピー\n従業員コード\t氏名\nA1234\t田中 太郎'}
        aria-label="従業員名簿を貼り付け"
        value={pasted}
        onChange={(e) => handlePastedChange(e.target.value)}
        onPaste={handlePaste}
        spellCheck={false}
      />

      {preview?.error && <p className="animate-fade-in text-sm text-danger">{preview.error}</p>}

      {rows && preview && (
        <div className="animate-fade-up space-y-3">
          <p className="text-sm">
            <span className="font-bold">{fileName}</span>：{rows.length}行
            <span className="ml-2 text-muted">
              追加 {count('create')}・更新 {count('update')}・変更なし {count('same')}
              {errorCount > 0 && <span className="ml-1 font-bold text-danger">・誤り {errorCount}</span>}
            </span>
            <span className="mt-1 block text-xs text-muted">{preview.columns}</span>
          </p>
          <div className="max-h-72 overflow-auto rounded-2xl border border-line bg-card">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-sunken text-muted">
                <tr>
                  <th className="px-3 py-2 text-right font-bold">行</th>
                  <th className="px-3 py-2 text-left font-bold">従業員コード</th>
                  <th className="px-3 py-2 text-left font-bold">所属・お名前</th>
                  <th className="px-3 py-2 text-left font-bold">有効</th>
                  <th className="px-3 py-2 text-left font-bold">結果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.line} className={r.error ? 'bg-danger-soft' : ''}>
                    <td className="px-3 py-1.5 text-right text-muted tabular-nums">{r.line}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.code}</td>
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5">{r.is_active ? '有効' : '無効'}</td>
                    <td className={`px-3 py-1.5 ${r.error ? 'text-danger' : r.kind === 'same' ? 'text-muted' : 'font-bold'}`}>
                      {r.error ?? (r.kind ? KIND_LABELS[r.kind] : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {errorCount > 0 && (
            <p className="text-sm text-danger">
              {fileName === PASTE_LABEL
                ? '貼り付け欄で誤りのある行を直してください（誤りがあると読み込めません）'
                : '誤りのある行を直したファイルを選び直してください（誤りがあると読み込めません）'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={reset} className="btn btn-ghost">
              やめる
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || errorCount > 0 || rows.length === 0}
              className="btn btn-primary"
            >
              {importing ? '読み込み中…' : `${rows.length}人を読み込む`}
            </button>
          </div>
        </div>
      )}

      {error && <p className="animate-fade-in text-sm whitespace-pre-wrap text-danger">{error}</p>}
      {message && <p className="animate-fade-in text-sm font-bold text-primary">✓ {message}</p>}
    </div>
  );
}
