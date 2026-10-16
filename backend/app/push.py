"""ポップアップ通知（Web Push）

サイトを開いていなくても、ブラウザ（またはホーム画面に追加したアプリ）に OS の通知として届ける。

- 送信元を証明する VAPID 鍵は、初回に自動で作って DB（app_settings）に保存する
- 通知は画面の応答を遅らせないよう別スレッドで送る
- 送り先のブラウザが通知を解除していた場合（404 / 410）は、その送り先を削除する
"""

import base64
import json
import logging
import os
import threading

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import SessionLocal
from models import AppSettingModel, PushSubscriptionModel

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = "vapid_private_key"
VAPID_PUBLIC_KEY = "vapid_public_key"
# 通知サービス（ブラウザ提供元）に伝える連絡先
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:park-support@example.com")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
NOTIFICATION_TITLE = "問い合わせ管理"

_keys_lock = threading.Lock()


def inquiry_url(target_role: str, inquiry_id: int | None) -> str:
    """通知をタップしたときに開く画面（現場スタッフ用 /staff、サポートチーム用 /support）"""
    site = f"{FRONTEND_URL}/{'staff' if target_role == 'staff' else 'support'}"
    if inquiry_id is None:
        return site
    return f"{site}/inquiries/{inquiry_id}#reply"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _vapid_keys(db: Session) -> tuple[str, str]:
    """(秘密鍵, 公開鍵) を返す。まだ無ければ作成して保存する"""
    with _keys_lock:
        private = db.get(AppSettingModel, VAPID_PRIVATE_KEY)
        public = db.get(AppSettingModel, VAPID_PUBLIC_KEY)
        if private is None or public is None:
            key = ec.generate_private_key(ec.SECP256R1())
            raw_private = key.private_numbers().private_value.to_bytes(32, "big")
            raw_public = key.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
            )
            private = AppSettingModel(key=VAPID_PRIVATE_KEY, value=_b64url(raw_private))
            public = AppSettingModel(key=VAPID_PUBLIC_KEY, value=_b64url(raw_public))
            db.merge(private)
            db.merge(public)
            db.commit()
        return private.value, public.value


def public_key(db: Session) -> str:
    """ブラウザが通知を購読するときに使う公開鍵"""
    return _vapid_keys(db)[1]


def save_subscription(db: Session, endpoint: str, p256dh: str, auth: str, target_role: str) -> None:
    """送り先を登録する（同じブラウザなら宛先を更新する）"""
    subscription = db.scalar(select(PushSubscriptionModel).where(PushSubscriptionModel.endpoint == endpoint))
    if subscription is None:
        subscription = PushSubscriptionModel(endpoint=endpoint)
        db.add(subscription)
    subscription.p256dh = p256dh
    subscription.auth = auth
    subscription.target_role = target_role
    db.commit()


def delete_subscription(db: Session, endpoint: str) -> None:
    subscription = db.scalar(select(PushSubscriptionModel).where(PushSubscriptionModel.endpoint == endpoint))
    if subscription is not None:
        db.delete(subscription)
        db.commit()


def _send(target_role: str, payload: str) -> None:
    with SessionLocal() as db:
        private_key, _ = _vapid_keys(db)
        subscriptions = db.scalars(
            select(PushSubscriptionModel).where(PushSubscriptionModel.target_role == target_role)
        ).all()
        for s in subscriptions:
            try:
                webpush(
                    subscription_info={"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}},
                    data=payload,
                    vapid_private_key=private_key,
                    vapid_claims={"sub": VAPID_SUBJECT},
                    ttl=60 * 60 * 24,
                    timeout=10,
                )
            except WebPushException as e:
                status = e.response.status_code if e.response is not None else None
                if status in (404, 410):
                    # ブラウザ側で通知が解除されている
                    db.delete(s)
                    db.commit()
                else:
                    logger.warning("ポップアップ通知の送信に失敗しました: status=%s", status)
            except Exception:
                logger.exception("ポップアップ通知の送信中にエラーが発生しました")


def send_push(target_role: str, message: str, inquiry_id: int | None) -> None:
    """宛先のブラウザすべてにポップアップ通知を送る（別スレッドで実行）"""
    url = inquiry_url(target_role, inquiry_id)
    payload = json.dumps(
        {"title": NOTIFICATION_TITLE, "body": message, "url": url, "tag": f"inquiry-{inquiry_id}"},
        ensure_ascii=False,
    )
    threading.Thread(target=_send, args=(target_role, payload), daemon=True).start()
