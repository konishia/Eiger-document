"""監査ログ（誰が・いつ・何を変えたか）の記録

- 「誰が」は、ログインした従業員コード・権限（現場スタッフ / サポートチーム / 各管理者）・名前・接続元で記録する
  - 名前は入力欄の名前（起票者・投稿者名）を使い、名前の欄が無い操作（編集・削除・設定変更など）では
    従業員名簿の名前を使う（名簿に無い管理者は、その端末で最後に使った名前 = X-Actor-Name ヘッダー）
- 記録はその操作と同じトランザクションで保存する（コミットは呼び出し元で行う）
- 問い合わせを削除しても記録は残る
"""

import json
from dataclasses import dataclass, replace
from urllib.parse import unquote

from fastapi import Depends, Request
from sqlalchemy.orm import Session

import auth
from models import AuditLogModel

# 変更前・変更後の値は長すぎると一覧が読みにくいので切り詰める
MAX_VALUE_LENGTH = 500

ACTION_LABELS = {
    "auth.login": "ログイン",
    "auth.login_failed": "ログイン失敗",
    "auth.password_change": "パスワード変更",
    "inquiry.create": "問い合わせ作成",
    "inquiry.update": "問い合わせ編集",
    "inquiry.delete": "問い合わせ削除",
    "inquiry.status": "ステータス変更（自動）",
    "comment.create": "返信",
    "ai.recheck": "AIチェック再実行",
    "required_field.create": "必須項目追加",
    "required_field.update": "必須項目編集",
    "required_field.delete": "必須項目削除",
    "employee.create": "従業員登録",
    "employee.update": "従業員編集",
    "employee.import": "従業員一括読み込み",
    "employee.delete": "従業員削除",
    "faq.refresh": "FAQ取り込み",
    "batch.summaries": "要約バッチ実行",
}


@dataclass(frozen=True)
class Actor:
    """操作した人"""

    role: str
    name: str = ""
    ip_address: str = ""
    employee_code: str = ""

    def named(self, name: str) -> "Actor":
        """入力欄の名前がある操作では、その名前を使う"""
        return replace(self, name=name.strip()[:100] or self.name)


# AIによる自動のステータス変更など、人が操作していない記録
SYSTEM = Actor(role="system", name="AIアシスタント")


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def actor_from_request(
    request: Request, role: str, employee_code: str | None = None, employee_name: str | None = None
) -> Actor:
    """操作者を作る（従業員コード・名前を省略すると、ログイン中の従業員のものを使う）"""
    code = auth.employee_code_of(request) if employee_code is None else employee_code
    name = auth.employee_name_of(request) if employee_name is None else employee_name
    if not name:
        # 画面は日本語の名前を encodeURIComponent してヘッダーに入れて送る
        name = unquote(request.headers.get("x-actor-name", "")).strip()[:100]
    return Actor(role=role, name=name, ip_address=client_ip(request), employee_code=code)


def current_actor(request: Request, role: auth.Role = Depends(auth.require_login)) -> Actor:
    """FastAPI dependency: ログイン中の操作者"""
    return actor_from_request(request, role)


def shorten(value: object) -> str | None:
    if value is None:
        return None
    text = value if isinstance(value, str) else str(value)
    return text if len(text) <= MAX_VALUE_LENGTH else text[:MAX_VALUE_LENGTH] + "…"


def diff(before: dict[str, object], after: dict[str, object]) -> dict[str, list[str | None]]:
    """変わった項目だけを {"項目": [変更前, 変更後]} の形にする"""
    return {k: [shorten(before.get(k)), shorten(v)] for k, v in after.items() if before.get(k) != v}


def added(label: str, value: object) -> dict[str, list[str | None]]:
    """新しく追加した内容を {"項目": [None, 内容]} の形にする"""
    return {label: [None, shorten(value)]}


def record(
    db: Session,
    actor: Actor,
    action: str,
    summary: str,
    inquiry_id: int | None = None,
    changes: dict[str, list[str | None]] | None = None,
) -> None:
    """監査ログを追加する（コミットは呼び出し元で行う）"""
    db.add(
        AuditLogModel(
            actor_role=actor.role,
            employee_code=actor.employee_code,
            actor_name=actor.name,
            ip_address=actor.ip_address,
            action=action,
            inquiry_id=inquiry_id,
            summary=summary[:300],
            changes=json.dumps(changes, ensure_ascii=False) if changes else None,
        )
    )
