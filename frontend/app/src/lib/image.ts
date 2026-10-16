// チャットに貼付する写真の縮小
// スマートフォンの写真は大きいので、送信前に長辺 1600px の JPEG にして通信量を減らす

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

/** 画像ファイルを縮小し、Base64（data URL の接頭辞なし）の JPEG にする */
export async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('写真（画像ファイル）を選んでください');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('この写真は読み込めませんでした（JPEG・PNG の写真を選んでください）'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('写真を処理できませんでした');
    // 透過PNGが黒くならないよう白で塗ってから描く
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 表示用の data URL */
export function jpegDataUrl(base64: string): string {
  return `data:image/jpeg;base64,${base64}`;
}
