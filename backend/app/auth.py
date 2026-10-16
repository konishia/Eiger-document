"""パスワードによるログイン（現場スタッフ / サポートチーム と、それぞれの管理者）

- ログイン画面で先に「現場スタッフ」「サポートチーム」のどちらかを選び、従業員コードとそのサイトのパスワードを入力する
  - 一般のパスワードでは、管理者が従業員名簿に登録した（有効な）従業員コードでだけログインできる
  - 管理者パスワードでは、名簿が空でも最初の登録ができるよう、どの従業員コードでもログインできる
  - 従業員コードは監査ログの「誰が」と、問い合わせの「所属・お名前」の自動入力に使う
  - 現場スタッフ用パスワード（初期値 000）: 現場スタッフ用サイト（/staff）だけを使える
  - サポートチーム用パスワード（初期値 111）: サポートチーム用サイト（/support）だけを使える
  - 現場スタッフ管理者パスワード: 現場スタッフ用サイトに管理者として入り、現場スタッフ側のパスワードを変更できる
  - サポートチーム管理者パスワード: サポートチーム用サイトに管理者として入り、サポートチーム側のパスワードを変更できる
- 管理者はサイトごとに別で、相手側のサイトのパスワードは変更できない
- パスワードはハッシュ化して DB（app_settings テーブル）に保存する
- DB にまだ無い場合は、環境変数 STAFF_PASSWORD（旧名 APP_PASSWORD）・SUPPORT_PASSWORD・
  STAFF_ADMIN_PASSWORD・SUPPORT_ADMIN_PASSWORD（旧名 ADMIN_PASSWORD）から初期値を作る
- ログインに成功すると、権限と有効期限を含む署名済みトークンを HttpOnly Cookie に保存する
- パスワードを変更すると、そのサイトで発行済みのトークンはすべて無効になる（変更した管理者以外は、そのサイトの全員がログアウト）
- 同じ接続元からパスワードを連続で間違えると、一定時間ログインできなくする
"""

import hashlib
import hmac
import os
import re
import secrets
import threading
import time
import unicodedata
from typing import Literal

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import AppSettingModel, EmployeeModel

# 権限（ログインしたパスワードの種類）
Role = Literal["staff", "support", "staff_admin", "support_admin"]
# ログイン画面で選ぶサイト
Site = Literal["staff", "support"]

# サイトごとの権限（管理者 → 一般 の順。ログイン時はこの順に照合する）
SITE_ROLES: dict[Site, tuple[Role, ...]] = {
    "staff": ("staff_admin", "staff"),
    "support": ("support_admin", "support"),
}
ROLES: tuple[Role, ...] = ("staff", "support", "staff_admin", "support_admin")
ADMIN_ROLES: tuple[Role, ...] = ("staff_admin", "support_admin")
INITIAL_PASSWORDS: dict[Role, str] = {
    "staff": os.getenv("STAFF_PASSWORD") or os.getenv("APP_PASSWORD") or "000",
    "support": os.getenv("SUPPORT_PASSWORD") or "111",
    "staff_admin": os.getenv("STAFF_ADMIN_PASSWORD", ""),
    "support_admin": os.getenv("SUPPORT_ADMIN_PASSWORD") or os.getenv("ADMIN_PASSWORD", ""),
}
# 現場スタッフ用は以前の「共通パスワード」、サポートチーム管理者は以前の「管理者」の保存場所をそのまま使う
PASSWORD_KEYS: dict[Role, str] = {
    "staff": "password_hash",
    "support": "support_password_hash",
    "staff_admin": "staff_admin_password_hash",
    "support_admin": "admin_password_hash",
}
ROLE_LABELS: dict[Role, str] = {
    "staff": "現場スタッフ用",
    "support": "サポートチーム用",
    "staff_admin": "現場スタッフ管理者",
    "support_admin": "サポートチーム管理者",
}

SESSION_SECRET = os.getenv("SESSION_SECRET", "")
SESSION_HOURS = int(os.getenv("SESSION_HOURS", "12"))
# 本番（HTTPS）では true にして Cookie を HTTPS 通信でのみ送るようにする
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false") == "true"
COOKIE_NAME = "park_support_session"
PBKDF2_ITERATIONS = 200_000

# 従業員コード（英数字・ハイフン・アンダースコア。Cookie に入れるので「.」は使えない）
EMPLOYEE_CODE_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,20}")

MAX_FAILURES = 5
LOCK_SECONDS = 10 * 60

_failures: dict[str, list[float]] = {}
_failures_lock = threading.Lock()


def site_of(role: Role) -> Site:
    """権限が使えるサイト"""
    return "staff" if role in SITE_ROLES["staff"] else "support"


# ---------- パスワードのハッシュ ----------


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    _, iterations, salt_hex, digest_hex = stored.split("$")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
    return hmac.compare_digest(digest.hex(), digest_hex)


def _stored_hash(db: Session, role: Role) -> str | None:
    """保存済みのパスワードハッシュを返す（無ければ環境変数の初期値から作成する。初期値も無ければ None）"""
    setting = db.get(AppSettingModel, PASSWORD_KEYS[role])
    if setting is None:
        initial = INITIAL_PASSWORDS[role]
        if not initial:
            return None
        setting = AppSettingModel(key=PASSWORD_KEYS[role], value=_hash_password(initial))
        db.add(setting)
        db.commit()
    return setting.value


# ---------- セッショントークン ----------


def _signing_key(db: Session, site: Site) -> bytes:
    # 署名鍵にそのサイトのパスワードハッシュを含めるので、どれかを変えるとそのサイトの古いトークンは使えなくなる
    material = ":".join([SESSION_SECRET, site, *(str(_stored_hash(db, r)) for r in SITE_ROLES[site])])
    return hashlib.sha256(material.encode()).digest()


def _sign(key: bytes, expires_at: int, role: Role, employee_code: str) -> str:
    return hmac.new(key, f"{expires_at}.{role}.{employee_code}".encode(), hashlib.sha256).hexdigest()


def _issue_cookie(response: Response, db: Session, role: Role, employee_code: str) -> None:
    expires_at = int(time.time()) + SESSION_HOURS * 3600
    signature = _sign(_signing_key(db, site_of(role)), expires_at, role, employee_code)
    response.set_cookie(
        COOKIE_NAME,
        # 従業員コードも署名に含めるので、Cookie を書き換えて別の人になりすますことはできない
        f"{expires_at}.{role}.{employee_code}.{signature}",
        max_age=SESSION_HOURS * 3600,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
    )


def _session_from_token(token: str, db: Session) -> tuple[Role, str] | None:
    """Cookie のトークンから（権限, 従業員コード）を取り出す。不正・期限切れなら None"""
    parts = token.split(".")
    # 従業員コードを入れる前の形式（3つに分かれる）のトークンは、もう一度ログインしてもらう
    if len(parts) != 4:
        return None
    expires_str, role, employee_code, signature = parts
    if not expires_str.isdigit() or role not in ROLES or not EMPLOYEE_CODE_PATTERN.fullmatch(employee_code):
        return None
    expected = _sign(_signing_key(db, site_of(role)), int(expires_str), role, employee_code)
    if not hmac.compare_digest(signature, expected):
        return None
    if int(expires_str) <= time.time():
        return None
    return role, employee_code


# ---------- 従業員コード ----------


def normalize_employee_code(value: str) -> str:
    """全角で入力されても使えるよう半角にし、前後の空白を除く"""
    return unicodedata.normalize("NFKC", value).strip()


def employee_code_of(request: Request) -> str:
    """ログイン中の従業員コード（require_login を通った後で使う。分からなければ空）"""
    return getattr(request.state, "employee_code", "")


def find_employee(db: Session, site: Site, code: str, active_only: bool = False) -> EmployeeModel | None:
    """従業員コードから、そのサイトの名簿の従業員を探す（名簿は現場スタッフ用とサポートチーム用で別）"""
    if not code:
        return None
    stmt = select(EmployeeModel).where(EmployeeModel.site == site, EmployeeModel.code == code)
    if active_only:
        stmt = stmt.where(EmployeeModel.is_active.is_(True))
    return db.scalar(stmt)


# ---------- 連続失敗の制限 ----------


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _ensure_not_locked(client: str) -> None:
    now = time.time()
    recent = [t for t in _failures.get(client, []) if now - t < LOCK_SECONDS]
    _failures[client] = recent
    if len(recent) >= MAX_FAILURES:
        raise HTTPException(status_code=429, detail="パスワードを続けて間違えたため、10分間操作できません")


def _record_failure(client: str) -> None:
    _failures.setdefault(client, []).append(time.time())


# ---------- 公開する処理 ----------


def login(
    site: Site, password: str, employee_code: str, request: Request, response: Response, db: Session
) -> Role:
    """選んだサイトのパスワードを確認し、正しければ権限と従業員コードつきのセッション Cookie を発行する"""
    client = _client(request)
    with _failures_lock:
        _ensure_not_locked(client)
        # 各サイトには、そのサイトの管理者パスワードでも入れる
        role = next((r for r in SITE_ROLES[site] if _verify_password(password, _stored_hash(db, r))), None)
        # 一般のパスワードでは、そのサイトの名簿に登録された（有効な）従業員コードだけを受け付ける
        # 管理者は名簿が空でも最初の登録ができるよう、どのコードでも入れる
        registered = find_employee(db, site, employee_code, active_only=True) is not None
        if role is None or (role not in ADMIN_ROLES and not registered):
            _record_failure(client)
            # どちらが違うかを教えると、登録済みの従業員コードを探られるので区別しない
            raise HTTPException(status_code=401, detail="従業員コードかパスワードが違います")
        _failures.pop(client, None)
    _issue_cookie(response, db, role, employee_code)
    return role


def change_password(
    admin: Role,
    target: Role,
    current_admin_password: str,
    new_password: str,
    request: Request,
    response: Response,
    db: Session,
) -> None:
    """自分のサイトのパスワードを変更する（そのサイトの管理者のみ）

    変更した管理者には新しい Cookie を発行し、そのサイトの他の人はログアウトされる
    """
    site = site_of(admin)
    if target not in SITE_ROLES[site]:
        raise HTTPException(status_code=403, detail="自分のサイトのパスワードだけを変更できます")

    client = _client(request)
    with _failures_lock:
        _ensure_not_locked(client)
        if not _verify_password(current_admin_password, _stored_hash(db, admin)):
            _record_failure(client)
            raise HTTPException(status_code=400, detail="現在の管理者パスワードが違います")
        _failures.pop(client, None)

    # 同じサイトに同じパスワードがあると、どの権限でログインしたか区別できない
    for other in SITE_ROLES[site]:
        if other != target and _verify_password(new_password, _stored_hash(db, other)):
            raise HTTPException(
                status_code=400, detail=f"{ROLE_LABELS[other]}パスワードと同じです。別のものにしてください"
            )

    setting = db.get(AppSettingModel, PASSWORD_KEYS[target])
    if setting is None:
        setting = AppSettingModel(key=PASSWORD_KEYS[target], value="")
        db.add(setting)
    setting.value = _hash_password(new_password)
    db.commit()
    _issue_cookie(response, db, admin, employee_code_of(request))


def logout(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, httponly=True, secure=COOKIE_SECURE, samesite="lax")


def require_login(request: Request, db: Session = Depends(get_db)) -> Role:
    """FastAPI dependency: ログインしていなければ 401 を返す。ログイン中なら権限を返す

    従業員コードは request.state.employee_code に入れる（employee_code_of で取り出す）
    """
    session = _session_from_token(request.cookies.get(COOKIE_NAME, ""), db)
    if session is None:
        raise HTTPException(status_code=401, detail="ログインが必要です")
    role, employee_code = session
    employee = find_employee(db, site_of(role), employee_code)
    # 名簿で無効にした・消した従業員は、ログイン中でも使えなくする（管理者は除く）
    if role not in ADMIN_ROLES and (employee is None or not employee.is_active):
        raise HTTPException(status_code=401, detail="ログインが必要です")
    request.state.employee_code = employee_code
    request.state.employee_name = employee.name if employee else ""
    return role


def employee_name_of(request: Request) -> str:
    """ログイン中の従業員の名簿上の名前（require_login を通った後で使う。名簿に無ければ空）"""
    return getattr(request.state, "employee_name", "")


def require_support(role: Role = Depends(require_login)) -> Role:
    """FastAPI dependency: サポートチーム（またはその管理者）でなければ 403 を返す"""
    if site_of(role) != "support":
        raise HTTPException(status_code=403, detail="この操作はサポートチームのみ行えます")
    return role


def require_admin(role: Role = Depends(require_login)) -> Role:
    """FastAPI dependency: 管理者（どちらかのサイト）でなければ 403 を返す"""
    if role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="この操作は管理者のみ行えます")
    return role


def require_support_admin(role: Role = Depends(require_login)) -> Role:
    """FastAPI dependency: サポートチームの管理者でなければ 403 を返す"""
    if role != "support_admin":
        raise HTTPException(status_code=403, detail="この操作はサポートチームの管理者のみ行えます")
    return role
