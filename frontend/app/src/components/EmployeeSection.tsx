'use client';

import { useEffect, useState } from 'react';

import { useLoginRole, useSession } from '@/components/AuthGate';
import EmployeeImport from '@/components/EmployeeImport';
import { apiFetch, isAdminRole, siteOfRole, type Employee } from '@/lib/api';

/**
 * 従業員名簿（管理者のみ表示）
 * - 名簿は現場スタッフ用とサポートチーム用で別。管理者は自分のサイトの名簿だけを管理する
 * - 1人ずつ手入力するほか、Excel・CSVのファイルやコピー＆ペーストで一括で読み込める
 * - 一般のパスワードでは、ここに登録された有効な従業員コードでだけログインできる
 * - 登録した「所属・お名前」は、問い合わせ・返信の名前欄に自動で入る
 */
export default function EmployeeSection() {
  const role = useLoginRole();
  const { employee_code: myCode } = useSession();
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  // 削除するためにチェックした従業員
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const list = await apiFetch<Employee[]>('/employees');
    setEmployees(list);
    // 名簿から無くなった従業員のチェックは外す
    setSelectedIds((prev) => new Set(list.filter((emp) => prev.has(emp.id)).map((emp) => emp.id)));
  };

  useEffect(() => {
    if (isAdminRole(role)) load().catch(() => setEmployees([]));
  }, [role]);

  if (!isAdminRole(role)) return null;

  const site = siteOfRole(role);
  const siteLabel = site === 'staff' ? '現場スタッフ' : 'サポートチーム';

  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
      return false;
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() =>
      apiFetch('/employees', { method: 'POST', json: { code: code.normalize('NFKC').trim(), name } }),
    );
    if (ok) {
      setCode('');
      setName('');
      setShowAdd(false);
    }
  };

  const handleSaveName = async (employee: Employee) => {
    const ok = await run(() => apiFetch(`/employees/${employee.id}`, { method: 'PATCH', json: { name: editName } }));
    if (ok) setEditingId(null);
  };

  const handleToggle = (employee: Employee) =>
    run(() => apiFetch(`/employees/${employee.id}`, { method: 'PATCH', json: { is_active: !employee.is_active } }));

  const toggleSelected = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = !!employees && employees.length > 0 && employees.every((emp) => selectedIds.has(emp.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set((employees ?? []).map((emp) => emp.id)));

  const handleDeleteSelected = async () => {
    const targets = (employees ?? []).filter((emp) => selectedIds.has(emp.id));
    if (targets.length === 0) return;
    const names = targets
      .slice(0, 10)
      .map((emp) => `・${emp.code} ${emp.name}`)
      .join('\n');
    const more = targets.length > 10 ? `\n…ほか${targets.length - 10}人` : '';
    if (
      !confirm(
        `次の${targets.length}人を名簿から削除しますか？\n${names}${more}\n\n（退職などで一時的に止めるだけなら、削除せず無効にできます）`,
      )
    )
      return;
    setDeleting(true);
    await run(async () => {
      for (const emp of targets) await apiFetch(`/employees/${emp.id}`, { method: 'DELETE' });
    });
    setDeleting(false);
  };

  return (
    <section className="card space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">従業員名簿（{siteLabel}）</h2>
        <p className="text-sm text-muted">
          {siteLabel}用サイトにログインできる従業員コードです（{site === 'staff' ? 'サポートチーム' : '現場スタッフ'}
          の名簿とは別です）。登録した「所属・お名前」は、問い合わせ・返信の名前欄に自動で入ります。
          無効にした従業員コードではログインできません（管理者パスワードでのログインを除く）。
        </p>
      </div>

      {employees === null ? (
        <p className="text-sm text-muted">読み込み中…</p>
      ) : (
        <div>
          {/* 全選択と、選択した従業員の削除（名簿が空のときも場所が分かるよう、押せない状態で表示する） */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <label
              className={`flex items-center gap-3 text-sm font-bold ${employees.length === 0 ? 'opacity-40' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
                disabled={employees.length === 0}
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleAll}
              />
              すべて選択
              {selectedIds.size > 0 && <span className="font-normal text-muted">（{selectedIds.size}人を選択中）</span>}
            </label>
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={selectedIds.size === 0 || deleting}
              className="btn btn-ghost btn-sm hover:text-danger disabled:opacity-40"
            >
              {deleting ? '削除中…' : '選択した従業員を削除'}
            </button>
          </div>
          {employees.length === 0 && (
            <p className="mt-3 rounded-2xl border-2 border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              まだ登録されていません。登録するまで、一般のパスワードではログインできません。
            </p>
          )}
          <ul className="divide-y divide-line">
            {employees.map((emp) => (
              <li key={emp.id} className="flex items-center justify-between gap-4 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                  checked={selectedIds.has(emp.id)}
                  onChange={() => toggleSelected(emp.id)}
                  aria-label={`${emp.code}を選択`}
                />
                {editingId === emp.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveName(emp);
                    }}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                  >
                    <span className="w-24 shrink-0 font-bold tabular-nums">{emp.code}</span>
                    <input
                      className="input min-w-0 flex-1 py-2"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      aria-label={`${emp.code}の所属・お名前`}
                      maxLength={100}
                      autoFocus
                      required
                    />
                    <button type="button" onClick={() => setEditingId(null)} className="btn btn-ghost btn-sm">
                      やめる
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm">
                      保存
                    </button>
                  </form>
                ) : (
                  <>
                    <div className={`flex min-w-0 flex-1 items-baseline gap-3 transition ${emp.is_active ? '' : 'opacity-50'}`}>
                      <span className="w-24 shrink-0 font-bold tabular-nums">{emp.code}</span>
                      <span className="truncate text-sm">{emp.name}</span>
                      {emp.code === myCode && <span className="chip bg-primary-soft text-ink">ログイン中</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingId(emp.id);
                          setEditName(emp.name);
                        }}
                        className="btn btn-ghost btn-sm"
                      >
                        編集
                      </button>
                      {/* 有効／無効のスイッチ */}
                      <button
                        role="switch"
                        aria-checked={emp.is_active}
                        aria-label={`${emp.code}を${emp.is_active ? '無効' : '有効'}にする`}
                        onClick={() => handleToggle(emp)}
                        className={`relative h-7 w-12 rounded-full transition duration-300 ${emp.is_active ? 'bg-primary' : 'bg-line'}`}
                      >
                        <span
                          className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-card shadow-soft transition duration-300 ${emp.is_active ? 'translate-x-5' : ''}`}
                        />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="animate-fade-in text-sm text-danger">{error}</p>}

      {showAdd ? (
        <form onSubmit={handleCreate} className="animate-fade-up space-y-3">
          <input
            className="input"
            placeholder="従業員コード（例: A1234）"
            aria-label="従業員コード"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={20}
            autoCapitalize="characters"
            autoComplete="off"
            required
          />
          <input
            className="input"
            placeholder={`所属・お名前（例: ${site === 'staff' ? '入園ゲート 田中' : 'サポートチーム 鈴木'}）`}
            aria-label="所属・お名前"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="btn btn-ghost">
              やめる
            </button>
            <button type="submit" className="btn btn-primary">
              登録する
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} className="btn btn-soft">
          ＋ 従業員を登録
        </button>
      )}

      <EmployeeImport site={site} employees={employees ?? []} onImported={() => load()} />
    </section>
  );
}
