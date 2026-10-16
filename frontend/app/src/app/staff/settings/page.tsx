'use client';

import EmployeeSection from '@/components/EmployeeSection';
import PasswordSection from '@/components/PasswordSection';

/** 現場スタッフ用サイトの設定（現場スタッフ管理者がパスワードの変更と従業員名簿の管理をする） */
export default function StaffSettingsPage() {
  return (
    <main className="page space-y-8">
      <h1 className="page-title">設定</h1>
      <PasswordSection />
      <EmployeeSection />
    </main>
  );
}
