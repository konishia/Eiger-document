'use client';

import { useEffect, useState } from 'react';

import type { components } from '@/types/api';

type Sample = components['schemas']['SampleResponse'];

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

export default function Home() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [name, setName] = useState('');

  const loadSamples = async () => {
    const res = await fetch(`${API_BASE_URL}/samples`);
    setSamples(await res.json());
  };

  useEffect(() => {
    loadSamples();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch(`${API_BASE_URL}/samples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setName('');
    loadSamples();
  };

  const handleDelete = async (id: number) => {
    await fetch(`${API_BASE_URL}/samples/${id}`, { method: 'DELETE' });
    loadSamples();
  };

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold">Sample App</h1>

      <form onSubmit={handleCreate} className="mb-6 flex gap-2">
        <input
          className="flex-1 rounded border border-gray-300 px-3 py-2"
          placeholder="名前を入力"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600">
          追加
        </button>
      </form>

      <ul className="space-y-2">
        {samples.map((sample) => (
          <li key={sample.id} className="flex items-center justify-between rounded border border-gray-200 p-2">
            <span>{sample.name}</span>
            <button onClick={() => handleDelete(sample.id)} className="text-sm text-red-500 hover:underline">
              削除
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
