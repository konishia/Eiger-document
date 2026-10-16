"""チャットに貼付された写真の検証

申告された形式を信用せず、ファイル先頭のバイト列（シグネチャ）から実際の画像形式を判定する。
"""

import base64
import binascii

from fastapi import HTTPException

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGES_PER_MESSAGE = 4
MAX_IMAGES_PER_INQUIRY = 10


def detect_media_type(data: bytes) -> str | None:
    """画像のシグネチャから形式を判定する（対応外なら None）"""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def decode_image(encoded: str) -> tuple[str, bytes]:
    """Base64 の画像を検証して (形式, バイト列) を返す。不正なら 400 エラー"""
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status_code=400, detail="写真のデータが壊れています") from e
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="写真は1枚あたり5MB以下にしてください")
    media_type = detect_media_type(data)
    if media_type is None:
        raise HTTPException(
            status_code=400, detail="対応していない形式です（JPEG・PNG・GIF・WebP の写真を貼付してください）"
        )
    return media_type, data
