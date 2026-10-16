"""通知

- 画面右上のベルに出す通知を DB に保存する（宛先: サポートチーム / 現場スタッフ）
- 環境変数 NOTIFY_WEBHOOK_URL を設定すると、Slack・Teams などの Incoming Webhook にも送る
"""

import json
import logging
import os
import threading
import urllib.request

from sqlalchemy.orm import Session

from models import NotificationModel
from push import inquiry_url, send_push

logger = logging.getLogger(__name__)

NOTIFY_WEBHOOK_URL = os.getenv("NOTIFY_WEBHOOK_URL", "")


def _post_webhook(text: str) -> None:
    try:
        req = urllib.request.Request(
            NOTIFY_WEBHOOK_URL,
            data=json.dumps({"text": text}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10).close()
    except Exception:
        logger.exception("Webhook 通知の送信に失敗しました")


def notify(
    db: Session,
    target_role: str,
    message: str,
    inquiry_id: int | None = None,
) -> None:
    """通知を追加する（コミットは呼び出し元で行う）。登録済みのブラウザにはポップアップ通知も送る"""
    db.add(NotificationModel(target_role=target_role, inquiry_id=inquiry_id, message=message[:300]))
    send_push(target_role, message, inquiry_id)

    if NOTIFY_WEBHOOK_URL:
        link = f"\n{inquiry_url(target_role, inquiry_id)}" if inquiry_id else ""
        who = "サポートチーム" if target_role == "support" else "現場スタッフ"
        # 画面の応答を遅らせないよう別スレッドで送る
        threading.Thread(
            target=_post_webhook, args=(f"[{who}宛] {message}{link}",), daemon=True
        ).start()
