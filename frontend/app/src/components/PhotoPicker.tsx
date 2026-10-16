'use client';

import { useRef, useState } from 'react';

import type { ChatImage } from '@/lib/api';
import { compressImage, jpegDataUrl } from '@/lib/image';

type PhotoSource = 'camera' | 'album' | 'file';

// 📷ボタンで選べる写真の入手方法
const PHOTO_SOURCES: { key: PhotoSource; icon: string; label: string }[] = [
  { key: 'camera', icon: '📸', label: 'カメラで撮影' },
  { key: 'album', icon: '🖼️', label: 'アルバムから選ぶ' },
  { key: 'file', icon: '📁', label: 'ファイルから選ぶ' },
];

export const MAX_PHOTOS = 4;

type Props = {
  images: ChatImage[];
  onChange: (images: ChatImage[]) => void;
  onError: (message: string) => void;
  /** メニューを開く向き（入力欄が画面下にあるチャットでは上に開く） */
  openUpward?: boolean;
};

/** 📷ボタン。「カメラで撮影」「アルバムから選ぶ」「ファイルから選ぶ」から写真を選び、縮小して追加する */
export default function PhotoPicker({ images, onChange, onError, openUpward = false }: Props) {
  const [open, setOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (source: PhotoSource) => {
    setOpen(false);
    const refs = { camera: cameraRef, album: albumRef, file: fileRef };
    refs[source].current?.click();
  };

  const handleFiles = async (files: FileList | null, input: HTMLInputElement) => {
    if (!files) return;
    const room = MAX_PHOTOS - images.length;
    if (files.length > room) onError(`写真は1回に${MAX_PHOTOS}枚まで送れます`);
    try {
      const added = await Promise.all(Array.from(files).slice(0, room).map(compressImage));
      onChange([...images, ...added.map((data) => ({ data }))]);
    } catch (err) {
      onError(err instanceof Error ? err.message : '写真を読み込めませんでした');
    } finally {
      // 同じ写真をもう一度選べるようにする
      input.value = '';
    }
  };

  return (
    <div className="relative shrink-0">
      {/* 写真の選び方ごとにファイル入力を用意する（スマートフォンでは開く画面が変わる） */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files, e.target)}
      />
      <input
        ref={albumRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files, e.target)}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".jpg,.jpeg,.png,.gif,.webp,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files, e.target)}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={images.length >= MAX_PHOTOS}
        className="btn btn-ghost h-11 w-11 p-0 text-xl"
        aria-label="写真を貼付"
        aria-haspopup="menu"
        aria-expanded={open}
        title="写真を貼付"
      >
        📷
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className={`absolute left-0 z-30 w-56 animate-pop-in overflow-hidden rounded-3xl border border-line bg-card p-2 shadow-soft ${openUpward ? 'bottom-full mb-3 origin-bottom-left' : 'top-full mt-2 origin-top-left'}`}
          >
            {PHOTO_SOURCES.map((source) => (
              <button
                key={source.key}
                type="button"
                role="menuitem"
                onClick={() => pick(source.key)}
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition hover:bg-sunken"
              >
                <span className="text-lg" aria-hidden>
                  {source.icon}
                </span>
                {source.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 送信前の写真のプレビュー（×で取り消せる） */
export function PhotoPreviews({ images, onChange }: { images: ChatImage[]; onChange: (images: ChatImage[]) => void }) {
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img, i) => (
        <div key={i} className="relative animate-pop-in">
          <img src={jpegDataUrl(img.data)} alt={`送信する写真${i + 1}`} className="h-16 w-16 rounded-2xl object-cover" />
          <button
            type="button"
            onClick={() => onChange(images.filter((_, j) => j !== i))}
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-ink text-xs text-card"
            aria-label={`写真${i + 1}を取り消す`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
