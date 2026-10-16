"""社内問い合わせ管理 API"""

import json
import os
import re
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session, selectinload, undefer
from starlette.exceptions import HTTPException as StarletteHTTPException

import ai_service
import audit
import auth
import dashboard
import faq
import push
from audit import Actor
from batch import run_summary_batch, start_scheduler
from database import get_db
from images import MAX_IMAGES_PER_INQUIRY, decode_image
from spreadsheet import read_first_sheet
from models import (
    AttachmentModel,
    AuditLogModel,
    CommentModel,
    EmployeeModel,
    FaqEntryModel,
    InquiryModel,
    NotificationModel,
    RequiredFieldModel,
    SampleModel,
)
from notifications import notify
from schemas import (
    AICheckResult,
    AuditLogList,
    AuditLogResponse,
    BatchResult,
    ChatReply,
    ChatRequest,
    CommentCreate,
    CommentResponse,
    DashboardResponse,
    EmployeeCreate,
    EmployeeImportRequest,
    EmployeeImportResult,
    SpreadsheetRequest,
    SpreadsheetResponse,
    EmployeeResponse,
    EmployeeUpdate,
    EscalateRequest,
    FaqStatus,
    InquiryCreate,
    InquiryResponse,
    InquirySummary,
    InquiryUpdate,
    LoginRequest,
    MeResponse,
    NotificationList,
    NotificationResponse,
    PasswordChangeRequest,
    PrecheckRequest,
    PushPublicKey,
    PushSubscribeRequest,
    PushUnsubscribeRequest,
    RequiredFieldCreate,
    RequiredFieldResponse,
    RequiredFieldUpdate,
    SampleCreate,
    SampleResponse,
)

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

TAGS = [
    {"name": "稼働確認", "description": "サーバーが動いているかの確認"},
    {"name": "ログイン", "description": "共通パスワード・管理者パスワードによるログインとパスワード変更"},
    {"name": "問い合わせ", "description": "問い合わせの作成・閲覧・編集・削除・検索と、やり取り（コメント）"},
    {"name": "AI", "description": "AIによる不足情報チェック・一次回答"},
    {"name": "かんたん問い合わせ（AIチャット）", "description": "来場者対応中の職員がAIに質問し、解決しなければサポートチームへ送る"},
    {"name": "添付写真", "description": "AIチャットで貼付された写真の取得"},
    {"name": "従業員名簿", "description": "ログインできる従業員コードと、問い合わせに自動で入れる名前（管理者が管理）"},
    {"name": "必須項目", "description": "サポートチームが定義する問い合わせの必須項目"},
    {"name": "よくある質問", "description": "AIが回答で引用する、お客様向けサポートサイトのFAQ"},
    {"name": "ダッシュボード", "description": "件数・平均対応時間・問い合わせが来る時間帯・カテゴリー別の傾向"},
    {"name": "監査ログ", "description": "誰が・いつ・何を変えたかの記録"},
    {"name": "通知", "description": "画面右上のベルに表示する通知"},
    {"name": "バッチ", "description": "自動要約バッチの手動実行"},
    {"name": "サンプル", "description": "テンプレートに含まれていた動作確認用のサンプル"},
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 日次の自動要約バッチを開始する
    stop_event = start_scheduler()
    # よくある質問（FAQ）を未取得・古い場合は取り込む
    faq.start_initial_refresh()
    yield
    stop_event.set()


app = FastAPI(
    title="社内問い合わせ管理API",
    description=(
        "現場スタッフとサポートチームが使う社内向け問い合わせツールのAPIです。\n\n"
        "稼働確認とログイン以外のAPIはログインが必要です。"
        "画面（http://localhost:3000）でログインしていれば、このページからもそのまま試せます。"
    ),
    version="1.0.0",
    openapi_tags=TAGS,
    lifespan=lifespan,
)

# CORS設定（フロントエンドからのアクセスを許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- エラーメッセージの日本語化 ----------

FIELD_LABELS = {
    "title": "件名",
    "body": "内容",
    "reporter_name": "起票者",
    "author_name": "投稿者名",
    "author_role": "投稿者の立場",
    "status": "ステータス",
    "new_status": "変更後のステータス",
    "password": "パスワード",
    "employee_code": "従業員コード",
    "site": "使うサイト",
    "current_password": "現在の管理者パスワード",
    "new_password": "新しいパスワード",
    "target": "変更するパスワード",
    "messages": "チャットのやり取り",
    "images": "写真",
    "content": "本文",
    "name": "項目名",
    "role": "宛先",
    "sort": "並び順",
}

HTTP_ERROR_MESSAGES = {
    "Not Found": "見つかりません",
    "Method Not Allowed": "この操作（メソッド）は使えません",
}


def _validation_message(error: dict) -> str:
    """Pydantic の入力チェックエラーを日本語にする"""
    ctx = error.get("ctx") or {}
    messages = {
        "missing": "入力してください",
        "string_too_short": f"{ctx.get('min_length')}文字以上で入力してください",
        "string_too_long": f"{ctx.get('max_length')}文字以内で入力してください",
        "too_short": f"{ctx.get('min_length')}件以上必要です",
        "too_long": f"{ctx.get('max_length')}件以内にしてください",
        "literal_error": f"指定できる値は {ctx.get('expected')} です",
        "int_parsing": "整数で指定してください",
        "bool_parsing": "true か false で指定してください",
        "string_type": "文字列で指定してください",
        "json_invalid": "JSONの形式が正しくありません",
    }
    if error["type"] == "value_error":
        return str(error["msg"]).removeprefix("Value error, ")
    return messages.get(error["type"], "入力内容が正しくありません")


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    details = []
    for error in exc.errors():
        field = next((FIELD_LABELS[p] for p in reversed(error["loc"]) if p in FIELD_LABELS), None)
        message = _validation_message(error)
        details.append(
            {"loc": list(error["loc"]), "msg": f"{field}：{message}" if field else message, "type": error["type"]}
        )
    return JSONResponse(status_code=422, content={"detail": details})


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = HTTP_ERROR_MESSAGES.get(exc.detail, exc.detail) if isinstance(exc.detail, str) else exc.detail
    return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=exc.headers)


# ---------- 稼働確認 ----------


@app.get("/", tags=["稼働確認"], summary="稼働確認")
def health_check():
    """サーバーが動いていれば {"status": "healthy"} を返す"""
    return {"status": "healthy"}


# ---------- ログイン ----------


@app.post("/auth/login", status_code=204, tags=["ログイン"], summary="ログイン")
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """従業員コードと、選んだサイトのパスワード（一般または管理者）でログインする

    一般のパスワードでは、従業員名簿に登録された（有効な）従業員コードだけを受け付ける。
    成功するとセッション Cookie が発行される
    """
    site_label = "現場スタッフ用" if payload.site == "staff" else "サポートチーム用"
    employee = auth.find_employee(db, payload.site, payload.employee_code)
    employee_name = employee.name if employee else ""
    try:
        role = auth.login(payload.site, payload.password, payload.employee_code, request, response, db)
    except HTTPException as e:
        anonymous = audit.actor_from_request(request, "anonymous", payload.employee_code, employee_name)
        audit.record(db, anonymous, "auth.login_failed", f"{site_label}サイトへのログインに失敗（{e.detail}）")
        db.commit()
        raise
    actor = audit.actor_from_request(request, role, payload.employee_code, employee_name)
    audit.record(db, actor, "auth.login", f"{auth.ROLE_LABELS[role]}パスワードでログイン")
    db.commit()


@app.post("/auth/logout", status_code=204, tags=["ログイン"], summary="ログアウト")
def logout(response: Response):
    """ログアウトする"""
    auth.logout(response)


@app.get("/auth/me", response_model=MeResponse, tags=["ログイン"], summary="ログイン状態の確認")
def me(request: Request, role: auth.Role = Depends(auth.require_login)):
    """ログイン中の権限（サイトと、管理者かどうか）と従業員コード・名簿上の名前を返す。未ログインなら 401"""
    return MeResponse(
        role=role, employee_code=auth.employee_code_of(request), employee_name=auth.employee_name_of(request)
    )


@app.post(
    "/auth/password",
    status_code=204,
    tags=["ログイン"],
    summary="パスワード変更（各サイトの管理者のみ）",
)
def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    admin: auth.Role = Depends(auth.require_admin),
):
    """自分のサイトの一般用パスワードまたは管理者パスワードを変更する

    そのサイトの管理者のみ実行でき（相手側のサイトのパスワードは 403）、変更した管理者以外はそのサイトの全員がログアウトされる
    """
    auth.change_password(
        admin, payload.target, payload.current_password, payload.new_password, request, response, db
    )
    actor = audit.actor_from_request(request, admin)
    audit.record(db, actor, "auth.password_change", f"{auth.ROLE_LABELS[payload.target]}パスワードを変更")
    db.commit()


# これより下の API はすべてログインが必要
api = APIRouter(dependencies=[Depends(auth.require_login)])
# サポートチーム用サイト（サポートチーム・管理者）だけが使える API に付ける
SUPPORT_ONLY = [Depends(auth.require_support)]


# ---------- サンプル ----------


@api.get("/samples", dependencies=SUPPORT_ONLY, response_model=list[SampleResponse], tags=["サンプル"], summary="サンプル一覧")
def get_samples(db: Session = Depends(get_db)):
    """サンプル一覧を取得する"""
    return db.query(SampleModel).all()


@api.post("/samples", dependencies=SUPPORT_ONLY, response_model=SampleResponse, status_code=201, tags=["サンプル"], summary="サンプル追加")
def create_sample(sample: SampleCreate, db: Session = Depends(get_db)):
    """サンプルを追加する"""
    db_sample = SampleModel(name=sample.name)
    db.add(db_sample)
    db.commit()
    db.refresh(db_sample)
    return db_sample


@api.delete("/samples/{sample_id}", dependencies=SUPPORT_ONLY, status_code=204, tags=["サンプル"], summary="サンプル削除")
def delete_sample(sample_id: int, db: Session = Depends(get_db)):
    """サンプルを削除する"""
    sample = db.query(SampleModel).filter(SampleModel.id == sample_id).first()
    if not sample:
        raise HTTPException(status_code=404, detail="サンプルが見つかりません")
    db.delete(sample)
    db.commit()


# ---------- 共通処理 ----------


def _get_inquiry_or_404(db: Session, inquiry_id: int) -> InquiryModel:
    inquiry = db.get(InquiryModel, inquiry_id)
    if not inquiry:
        raise HTTPException(status_code=404, detail="問い合わせが見つかりません")
    return inquiry


STATUS_LABELS = {"open": "未対応", "waiting_info": "情報待ち", "first_answered": "一次回答提示済み", "closed": "対応完了"}


def _change_status(inquiry: InquiryModel, new_status: str) -> dict[str, list[str | None]]:
    """ステータスを変え、対応完了日時を合わせる。監査ログ用の変更内容を返す（変わらなければ空）"""
    old_status = inquiry.status
    if new_status == old_status:
        return {}
    inquiry.status = new_status
    inquiry.closed_at = func.now() if new_status == "closed" else None
    return {"ステータス": [STATUS_LABELS[old_status], STATUS_LABELS[new_status]]}


def _active_required_fields(db: Session) -> list[RequiredFieldModel]:
    return list(
        db.scalars(
            select(RequiredFieldModel)
            .where(RequiredFieldModel.is_active.is_(True))
            .order_by(RequiredFieldModel.id)
        )
    )


def _text_for_check(inquiry: InquiryModel) -> str:
    """AIチェック対象の本文（現場スタッフが後から追記した回答も含める）"""
    additions = [c.body for c in inquiry.comments if c.author_role == "staff"]
    if not additions:
        return inquiry.body
    return inquiry.body + "\n\n# 追加で提供された情報\n" + "\n".join(additions)


def _run_ai_check(db: Session, inquiry: InquiryModel, auto_request: bool = True) -> AICheckResult:
    """AIチェックを実行し、結果を問い合わせに反映する

    - 不足なし: 一次回答の下書きを保存する（スタッフが採用・修正の上で送信する）
    - 不足あり・auto_request=True: AIが追加確認事項をコメントとして自動投稿し、ステータスを「情報待ち」にする
    - 不足あり・auto_request=False: 自動投稿はせず、不足情報を聞き返す返信の下書きを保存する
      （AIチャットから送られた問い合わせ用。サポートチームがすぐ返信できるようにする）
    """
    result = ai_service.check_inquiry(
        inquiry.title, _text_for_check(inquiry), _active_required_fields(db), faq.all_entries(db)
    )

    inquiry.ai_missing_fields = json.dumps(result.missing_fields, ensure_ascii=False)
    inquiry.ai_questions = json.dumps(result.questions, ensure_ascii=False)
    inquiry.ai_probable_cause = result.probable_cause
    inquiry.ai_action_required = result.action_required
    inquiry.ai_draft_answer = result.draft_answer
    inquiry.ai_checked_at = func.now()

    changes: dict[str, list[str | None]] = {}
    if not result.is_complete and not auto_request:
        questions = "\n".join(f"・{q}" for q in result.questions)
        inquiry.ai_draft_answer = "お問い合わせありがとうございます。確認のため、次の情報を教えてください。\n" + questions
    elif not result.is_complete:
        questions = "\n".join(f"・{q}" for q in result.questions)
        inquiry.comments.append(
            CommentModel(
                author_name="AIアシスタント",
                author_role="ai",
                body=f"回答のために以下の情報が不足しています。追加でご提供ください。\n{questions}",
            )
        )
        if inquiry.status != "closed":
            changes = _change_status(inquiry, "waiting_info")
        notify(db, "staff", f"#{inquiry.id}「{inquiry.title}」にAIから追加確認があります", inquiry.id)
    elif inquiry.status == "waiting_info":
        # 情報が揃ったのでサポートチームの対応待ちに戻す
        changes = _change_status(inquiry, "open")
    if changes:
        reason = "不足情報があるため" if inquiry.status == "waiting_info" else "必要な情報がそろったため"
        audit.record(
            db, audit.SYSTEM, "inquiry.status", f"#{inquiry.id}「{inquiry.title}」のステータスを{reason}自動で変更",
            inquiry.id, changes,
        )

    db.commit()
    db.refresh(inquiry)
    return result


def _split_keywords(q: str) -> list[str]:
    """全角スペース・半角スペース区切りでキーワードに分割する"""
    return [k for k in re.split(r"\s+", ai_service.normalize(q)) if k]


def _create_inquiry(
    db: Session,
    payload: InquiryCreate,
    notice: str,
    actor: Actor,
    auto_request: bool = True,
    images: list[tuple[str, bytes]] | None = None,
) -> InquiryModel:
    """問い合わせを保存してサポートチームへ通知し、AIチェックを実行する"""
    inquiry = InquiryModel(**payload.model_dump(), status="open")
    for media_type, data in images or []:
        inquiry.all_attachments.append(AttachmentModel(media_type=media_type, data=data))
    db.add(inquiry)
    db.commit()
    db.refresh(inquiry)
    photo_note = f"（写真{len(images)}枚）" if images else ""
    audit.record(
        db, actor.named(payload.reporter_name), "inquiry.create",
        f"{notice}: #{inquiry.id}「{inquiry.title}」を作成{photo_note}", inquiry.id,
        {**audit.added("件名", payload.title), **audit.added("内容", payload.body)},
    )
    notify(db, "support", f"{notice}: #{inquiry.id}「{inquiry.title}」（{inquiry.reporter_name}）", inquiry.id)
    _run_ai_check(db, inquiry, auto_request)
    return inquiry


SortKey = Literal["newest", "oldest", "updated"]

# 同じ日時の場合は ID で並びを確定させる（作成日時は秒単位のため）
SORT_ORDERS = {
    "newest": (InquiryModel.created_at.desc(), InquiryModel.id.desc()),
    "oldest": (InquiryModel.created_at.asc(), InquiryModel.id.asc()),
    "updated": (InquiryModel.updated_at.desc(), InquiryModel.id.desc()),
}


# ---------- 問い合わせ ----------


@api.get("/inquiries", response_model=list[InquirySummary], tags=["問い合わせ"], summary="問い合わせ一覧・検索")
def list_inquiries(
    q: str = Query(default="", description="検索キーワード（スペース区切りで AND 検索・部分一致）"),
    status: str | None = Query(default=None, description="ステータスで絞り込み"),
    sort: SortKey = Query(default="newest", description="並び順（newest: 新しい順 / oldest: 古い順 / updated: 更新が新しい順）"),
    ids: str | None = Query(
        default=None,
        pattern=r"^\d+(,\d+)*$",
        description="指定したIDの問い合わせだけを返す（カンマ区切り。現場スタッフ用サイトの「送った問い合わせ」で使う）",
    ),
    db: Session = Depends(get_db),
    current: auth.Role = Depends(auth.require_login),
):
    """問い合わせ一覧を取得する（キーワード検索・絞り込み・並べ替え対応）

    現場スタッフは、自分が送った問い合わせ（ids 指定）だけを取得できる
    """
    if auth.site_of(current) == "staff" and not ids:
        raise HTTPException(status_code=403, detail="問い合わせの一覧はサポートチームのみ見られます")
    stmt = select(InquiryModel).options(selectinload(InquiryModel.comments)).order_by(*SORT_ORDERS[sort])
    if ids:
        stmt = stmt.where(InquiryModel.id.in_([int(i) for i in ids.split(",")][:200]))

    # 各キーワードが「件名・本文・要約・起票者・コメント」のいずれかに部分一致すること（AND）
    # AIの自動コメントは質問の定型文（記入例を含む）なので検索対象から外す
    conditions = []
    for keyword in _split_keywords(q):
        conditions.append(
            or_(
                InquiryModel.title.contains(keyword, autoescape=True),
                InquiryModel.body.contains(keyword, autoescape=True),
                InquiryModel.summary.contains(keyword, autoescape=True),
                InquiryModel.reporter_name.contains(keyword, autoescape=True),
                InquiryModel.comments.any(
                    and_(
                        CommentModel.author_role != "ai",
                        CommentModel.body.contains(keyword, autoescape=True),
                    )
                ),
            )
        )
    if conditions:
        stmt = stmt.where(and_(*conditions))
    if status:
        stmt = stmt.where(InquiryModel.status == status)

    return [
        InquirySummary(
            id=i.id,
            title=i.title,
            reporter_name=i.reporter_name,
            status=i.status,
            summary=i.summary,
            created_at=i.created_at,
            updated_at=i.updated_at,
            comment_count=len(i.comments),
            last_comment_role=i.comments[-1].author_role if i.comments else None,
        )
        for i in db.scalars(stmt)
    ]


@api.post("/inquiries", response_model=InquiryResponse, status_code=201, tags=["問い合わせ"], summary="問い合わせ作成")
def create_inquiry(payload: InquiryCreate, db: Session = Depends(get_db), actor: Actor = Depends(audit.current_actor)):
    """問い合わせを作成し、AIチェック（不足情報の指摘 or 一次回答の下書き）を実行する"""
    return _create_inquiry(db, payload, "新しい問い合わせ", actor)


@api.get("/inquiries/{inquiry_id}", response_model=InquiryResponse, tags=["問い合わせ"], summary="問い合わせ詳細")
def get_inquiry(inquiry_id: int, db: Session = Depends(get_db)):
    """問い合わせの詳細（やり取りの履歴・添付写真を含む）を取得する"""
    return _get_inquiry_or_404(db, inquiry_id)


@api.patch("/inquiries/{inquiry_id}", dependencies=SUPPORT_ONLY, response_model=InquiryResponse, tags=["問い合わせ"], summary="問い合わせ編集")
def update_inquiry(
    inquiry_id: int, payload: InquiryUpdate, db: Session = Depends(get_db), actor: Actor = Depends(audit.current_actor)
):
    """問い合わせを編集する（ステータス変更もここで行う）"""
    inquiry = _get_inquiry_or_404(db, inquiry_id)
    values = payload.model_dump(exclude_unset=True)
    new_status = values.pop("status", None)
    before = {FIELD_LABELS[key]: getattr(inquiry, key) for key in values}
    for key, value in values.items():
        setattr(inquiry, key, value)
    changes = audit.diff(before, {FIELD_LABELS[key]: value for key, value in values.items()})
    if new_status:
        changes |= _change_status(inquiry, new_status)
    if changes:
        audit.record(db, actor, "inquiry.update", f"#{inquiry.id}「{inquiry.title}」を編集", inquiry.id, changes)
    db.commit()
    db.refresh(inquiry)
    return inquiry


@api.delete("/inquiries/{inquiry_id}", dependencies=SUPPORT_ONLY, status_code=204, tags=["問い合わせ"], summary="問い合わせ削除")
def delete_inquiry(inquiry_id: int, db: Session = Depends(get_db), actor: Actor = Depends(audit.current_actor)):
    """問い合わせを削除する（コメント・添付写真も一緒に削除される。監査ログは残る）"""
    inquiry = _get_inquiry_or_404(db, inquiry_id)
    audit.record(
        db, actor, "inquiry.delete",
        f"#{inquiry.id}「{inquiry.title}」を削除（やり取り{len(inquiry.comments)}件・写真{len(inquiry.all_attachments)}枚も削除）",
        inquiry.id,
        {
            "件名": [inquiry.title, None],
            "起票者": [inquiry.reporter_name, None],
            "ステータス": [STATUS_LABELS[inquiry.status], None],
            "内容": [audit.shorten(inquiry.body), None],
        },
    )
    db.delete(inquiry)
    db.commit()


@api.post(
    "/inquiries/{inquiry_id}/comments",
    response_model=CommentResponse,
    status_code=201,
    tags=["問い合わせ"],
    summary="コメント・返信の追加",
)
def create_comment(
    inquiry_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current: auth.Role = Depends(auth.require_login),
    actor: Actor = Depends(audit.current_actor),
):
    """コメント・返信を追加する

    写真も貼付できる。「情報待ち」の問い合わせに現場スタッフが返信した場合は、追加情報を含めて AI チェックをやり直す
    """
    if payload.author_role != auth.site_of(current):
        raise HTTPException(status_code=403, detail="ログインしたサイトの立場でのみ返信できます")
    if auth.site_of(current) == "staff" and payload.new_status:
        raise HTTPException(status_code=403, detail="ステータスはサポートチームのみ変更できます")
    inquiry = _get_inquiry_or_404(db, inquiry_id)
    # 写真は中身を検証してから保存する（不正なら 400 で何も保存しない）
    images = [decode_image(img.data) for img in payload.images]
    if len(inquiry.all_attachments) + len(images) > MAX_IMAGES_PER_INQUIRY * 3:
        raise HTTPException(status_code=400, detail="この問い合わせに付けられる写真の上限に達しています")

    body = payload.body.strip() or f"（写真{len(images)}枚を送信しました）"
    comment = CommentModel(author_name=payload.author_name, author_role=payload.author_role, body=body)
    inquiry.comments.append(comment)
    for media_type, data in images:
        inquiry.all_attachments.append(AttachmentModel(media_type=media_type, data=data, comment=comment))
    changes = audit.added("返信", body)
    if payload.new_status:
        changes |= _change_status(inquiry, payload.new_status)
    photo_note = f"（写真{len(images)}枚）" if images else ""
    audit.record(
        db, actor.named(payload.author_name), "comment.create",
        f"#{inquiry.id}「{inquiry.title}」に返信{photo_note}", inquiry.id, changes,
    )
    # 相手側へ通知する（職員の返信 → サポートチーム、サポートチームの回答 → 職員）
    if payload.author_role == "staff":
        target, notice = "support", f"#{inquiry.id}「{inquiry.title}」に現場スタッフから返信があります"
    else:
        target, notice = "staff", f"#{inquiry.id}「{inquiry.title}」にサポートチームから回答があります"
    notify(db, target, notice, inquiry.id)
    db.commit()
    db.refresh(comment)

    if payload.author_role == "staff" and inquiry.status == "waiting_info":
        _run_ai_check(db, inquiry)
    return comment


@api.post("/inquiries/{inquiry_id}/ai-check", dependencies=SUPPORT_ONLY, response_model=InquiryResponse, tags=["AI"], summary="AIチェックの再実行")
def rerun_ai_check(inquiry_id: int, db: Session = Depends(get_db), actor: Actor = Depends(audit.current_actor)):
    """AIチェックを再実行する"""
    inquiry = _get_inquiry_or_404(db, inquiry_id)
    audit.record(db, actor, "ai.recheck", f"#{inquiry.id}「{inquiry.title}」のAIチェックを再実行", inquiry.id)
    _run_ai_check(db, inquiry)
    return inquiry


@api.post("/ai/precheck", response_model=AICheckResult, tags=["AI"], summary="入力中のAIチェック")
def precheck(payload: PrecheckRequest, db: Session = Depends(get_db)):
    """保存前に入力内容をAIチェックする（入力画面でその場で不足を指摘するため）"""
    return ai_service.check_inquiry(payload.title, payload.body, _active_required_fields(db), faq.all_entries(db))


# ---------- 必須項目の定義（サポートチームが管理） ----------


def _required_field_values(field: RequiredFieldModel) -> dict[str, object]:
    """監査ログに残す必須項目の内容"""
    return {
        "項目名": field.name,
        "説明": field.description,
        "簡易判定キーワード": field.keywords,
        "有効": "有効" if field.is_active is not False else "無効",
    }


@api.get("/required-fields", response_model=list[RequiredFieldResponse], tags=["必須項目"], summary="必須項目一覧")
def list_required_fields(db: Session = Depends(get_db)):
    """必須項目の一覧を取得する"""
    return db.scalars(select(RequiredFieldModel).order_by(RequiredFieldModel.id)).all()


@api.post(
    "/required-fields",
    dependencies=SUPPORT_ONLY,
    response_model=RequiredFieldResponse, status_code=201, tags=["必須項目"], summary="必須項目追加"
)
def create_required_field(
    payload: RequiredFieldCreate, db: Session = Depends(get_db), actor: Actor = Depends(audit.current_actor)
):
    """必須項目を追加する"""
    field = RequiredFieldModel(**payload.model_dump())
    db.add(field)
    audit.record(
        db, actor, "required_field.create", f"必須項目「{field.name}」を追加", None,
        audit.diff({}, _required_field_values(field)),
    )
    db.commit()
    db.refresh(field)
    return field


@api.patch(
    "/required-fields/{field_id}",
    dependencies=SUPPORT_ONLY,
    response_model=RequiredFieldResponse, tags=["必須項目"], summary="必須項目編集"
)
def update_required_field(
    field_id: int,
    payload: RequiredFieldUpdate,
    db: Session = Depends(get_db),
    actor: Actor = Depends(audit.current_actor),
):
    """必須項目を編集する"""
    field = db.get(RequiredFieldModel, field_id)
    if not field:
        raise HTTPException(status_code=404, detail="必須項目が見つかりません")
    before = _required_field_values(field)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(field, key, value)
    changes = audit.diff(before, _required_field_values(field))
    if changes:
        audit.record(db, actor, "required_field.update", f"必須項目「{field.name}」を編集", None, changes)
    db.commit()
    db.refresh(field)
    return field


@api.delete("/required-fields/{field_id}", dependencies=SUPPORT_ONLY, status_code=204, tags=["必須項目"], summary="必須項目削除")
def delete_required_field(field_id: int, db: Session = Depends(get_db), actor: Actor = Depends(audit.current_actor)):
    """必須項目を削除する"""
    field = db.get(RequiredFieldModel, field_id)
    if not field:
        raise HTTPException(status_code=404, detail="必須項目が見つかりません")
    audit.record(
        db, actor, "required_field.delete", f"必須項目「{field.name}」を削除", None,
        audit.diff(_required_field_values(field), {k: None for k in _required_field_values(field)}),
    )
    db.delete(field)
    db.commit()


# ---------- 従業員名簿（管理者が管理。現場スタッフ用とサポートチーム用で別の名簿） ----------

ADMIN_ONLY = [Depends(auth.require_admin)]


def _admin_site(role: auth.Role = Depends(auth.require_admin)) -> auth.Site:
    """管理者が管理する名簿のサイト（自分のサイトの名簿だけを見て・変更できる）"""
    return auth.site_of(role)


def _employee_values(employee: EmployeeModel) -> dict[str, object]:
    """監査ログに残す従業員の内容"""
    return {
        "従業員コード": employee.code,
        "所属・お名前": employee.name,
        "有効": "有効" if employee.is_active is not False else "無効",
    }


def _get_employee_or_404(db: Session, site: auth.Site, employee_id: int) -> EmployeeModel:
    employee = db.get(EmployeeModel, employee_id)
    # ほかのサイトの名簿の従業員は、無いものとして扱う
    if not employee or employee.site != site:
        raise HTTPException(status_code=404, detail="従業員が見つかりません")
    return employee


@api.get("/employees", dependencies=ADMIN_ONLY, response_model=list[EmployeeResponse], tags=["従業員名簿"], summary="従業員名簿（管理者のみ）")
def list_employees(site: auth.Site = Depends(_admin_site), db: Session = Depends(get_db)):
    """自分のサイトの名簿に登録された従業員を、従業員コードの順に返す"""
    return db.scalars(select(EmployeeModel).where(EmployeeModel.site == site).order_by(EmployeeModel.code)).all()


@api.post(
    "/employees",
    dependencies=ADMIN_ONLY,
    response_model=EmployeeResponse, status_code=201, tags=["従業員名簿"], summary="従業員の登録（管理者のみ）"
)
def create_employee(
    payload: EmployeeCreate,
    site: auth.Site = Depends(_admin_site),
    db: Session = Depends(get_db),
    actor: Actor = Depends(audit.current_actor),
):
    """従業員を自分のサイトの名簿に登録する（登録すると、そのサイトの一般のパスワードでその従業員コードを使ってログインできる）"""
    if auth.find_employee(db, site, payload.code):
        raise HTTPException(status_code=409, detail=f"従業員コード「{payload.code}」はもう登録されています")
    employee = EmployeeModel(site=site, code=payload.code, name=payload.name.strip(), is_active=payload.is_active)
    db.add(employee)
    audit.record(
        db, actor, "employee.create", f"従業員「{employee.code} {employee.name}」を登録", None,
        audit.diff({}, _employee_values(employee)),
    )
    db.commit()
    db.refresh(employee)
    return employee


MAX_IMPORT_ERRORS = 20


@api.post(
    "/employees/read-excel",
    dependencies=ADMIN_ONLY,
    response_model=SpreadsheetResponse, tags=["従業員名簿"], summary="Excelファイルの読み取り（管理者のみ）"
)
def read_employee_excel(payload: SpreadsheetRequest):
    """一括読み込み用に、Excelファイル（.xlsx / .xls）のデータのある最初のシートを表にして返す（保存はしない）

    列の判定や内容の確認は画面で行い、読み込みは /employees/import で行う
    """
    sheet, rows = read_first_sheet(payload.data)
    return SpreadsheetResponse(sheet=sheet, rows=rows)


@api.post(
    "/employees/import",
    dependencies=ADMIN_ONLY,
    response_model=EmployeeImportResult, tags=["従業員名簿"], summary="従業員名簿の一括読み込み（管理者のみ）"
)
def import_employees(
    payload: EmployeeImportRequest,
    site: auth.Site = Depends(_admin_site),
    db: Session = Depends(get_db),
    actor: Actor = Depends(audit.current_actor),
):
    """ファイル・貼り付けから読み込んだ従業員を、自分のサイトの名簿にまとめて登録する（画面でCSV・Excel・貼り付けた内容を読み取って送る）

    - 名簿に無い従業員コードは追加し、ある従業員コードは名前・有効を上書きする
    - 読み込む内容に無い従業員はそのまま残す（削除はしない）
    - 1行でも誤りがあれば何も保存せず、行番号つきで誤りを返す
    """
    errors: list[str] = []
    rows: dict[str, tuple[str, bool]] = {}
    first_line: dict[str, int] = {}
    for row in payload.rows:
        code = auth.normalize_employee_code(row.code)
        name = row.name.strip()
        if not auth.EMPLOYEE_CODE_PATTERN.fullmatch(code):
            errors.append(f"{row.line}行目：従業員コード「{row.code}」は英数字・ハイフン・アンダースコアの20文字以内にしてください")
        elif code in rows:
            errors.append(f"{row.line}行目：従業員コード「{code}」が{first_line[code]}行目と重複しています")
        if not name:
            errors.append(f"{row.line}行目：所属・お名前が空欄です")
        elif len(name) > 100:
            errors.append(f"{row.line}行目：所属・お名前は100文字以内にしてください")
        if code not in rows:
            rows[code] = (name, row.is_active)
            first_line[code] = row.line
    if errors:
        more = f"\n（ほか{len(errors) - MAX_IMPORT_ERRORS}件）" if len(errors) > MAX_IMPORT_ERRORS else ""
        raise HTTPException(status_code=400, detail="\n".join(errors[:MAX_IMPORT_ERRORS]) + more)

    existing = {
        e.code: e
        for e in db.scalars(select(EmployeeModel).where(EmployeeModel.site == site, EmployeeModel.code.in_(list(rows))))
    }
    created: list[str] = []
    updated: list[str] = []
    for code, (name, is_active) in rows.items():
        employee = existing.get(code)
        if employee is None:
            db.add(EmployeeModel(site=site, code=code, name=name, is_active=is_active))
            created.append(f"{code} {name}")
        elif employee.name != name or employee.is_active != is_active:
            employee.name, employee.is_active = name, is_active
            updated.append(f"{code} {name}")
    unchanged = len(rows) - len(created) - len(updated)

    changes = {}
    if created:
        changes |= audit.added("追加", "、".join(created))
    if updated:
        changes |= audit.added("更新", "、".join(updated))
    audit.record(
        db, actor, "employee.import",
        f"従業員名簿を一括読み込み（追加{len(created)}人・更新{len(updated)}人・変更なし{unchanged}人）", None, changes,
    )
    db.commit()
    return EmployeeImportResult(created=len(created), updated=len(updated), unchanged=unchanged)


@api.patch(
    "/employees/{employee_id}",
    dependencies=ADMIN_ONLY,
    response_model=EmployeeResponse, tags=["従業員名簿"], summary="従業員の編集（管理者のみ）"
)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    site: auth.Site = Depends(_admin_site),
    db: Session = Depends(get_db),
    actor: Actor = Depends(audit.current_actor),
):
    """名前の変更や、有効・無効の切り替えをする（無効にするとその従業員コードではログインできない）"""
    employee = _get_employee_or_404(db, site, employee_id)
    before = _employee_values(employee)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(employee, key, value.strip() if isinstance(value, str) else value)
    changes = audit.diff(before, _employee_values(employee))
    if changes:
        audit.record(db, actor, "employee.update", f"従業員「{employee.code} {employee.name}」を編集", None, changes)
    db.commit()
    db.refresh(employee)
    return employee


@api.delete("/employees/{employee_id}", dependencies=ADMIN_ONLY, status_code=204, tags=["従業員名簿"], summary="従業員の削除（管理者のみ）")
def delete_employee(
    employee_id: int,
    site: auth.Site = Depends(_admin_site),
    db: Session = Depends(get_db),
    actor: Actor = Depends(audit.current_actor),
):
    """従業員を自分のサイトの名簿から削除する（監査ログには従業員コードが残る）"""
    employee = _get_employee_or_404(db, site, employee_id)
    audit.record(
        db, actor, "employee.delete", f"従業員「{employee.code} {employee.name}」を削除", None,
        audit.diff(_employee_values(employee), {k: None for k in _employee_values(employee)}),
    )
    db.delete(employee)
    db.commit()


# ---------- かんたん問い合わせ（AIチャット） ----------


def _resolved_examples(db: Session, limit: int = 20) -> list[str]:
    """AIの参考にする、過去に回答済みの問い合わせ（新しい順）"""
    inquiries = db.scalars(
        select(InquiryModel)
        .where(InquiryModel.status.in_(["first_answered", "closed"]))
        .options(selectinload(InquiryModel.comments))
        .order_by(InquiryModel.updated_at.desc())
        .limit(limit)
    )
    examples = []
    for i in inquiries:
        answers = [c.body for c in i.comments if c.author_role == "support"]
        if answers:
            content = " ".join((i.summary or i.body).split())[:120]
            answer = " ".join(answers[-1].split())[:200]
            examples.append(f"{i.title}（{content}）→ 回答: {answer}")
    return examples


@api.post("/chat", response_model=ChatReply, tags=["かんたん問い合わせ（AIチャット）"], summary="AIに質問する")
def chat(payload: ChatRequest, db: Session = Depends(get_db)):
    """来場者対応中の現場スタッフの質問にAIが答える（会話の履歴ごと送る。写真も貼付できる）"""
    if payload.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="最後のメッセージは職員の質問にしてください")
    messages = []
    for m in payload.messages:
        # 写真は中身を検証し、実際の形式を付けて AI に渡す
        images = []
        for img in m.images:
            media_type, _ = decode_image(img.data)
            images.append({"media_type": media_type, "data": img.data})
        messages.append({"role": m.role, "content": m.content, "images": images})
    return ai_service.chat(messages, _resolved_examples(db), faq.all_entries(db))


@api.post(
    "/chat/escalate",
    response_model=InquiryResponse,
    status_code=201,
    tags=["かんたん問い合わせ（AIチャット）"],
    summary="サポートチームへ送る",
)
def escalate_chat(payload: EscalateRequest, db: Session = Depends(get_db), actor: Actor = Depends(audit.current_actor)):
    """AIで解決できなかったチャットを、問い合わせとしてサポートチームへ送る（貼付した写真も添付される）

    問い合わせの内容には職員の発言だけを入れる（AIの回答・考察はサポートチームには送らない）
    """
    images: list[tuple[str, bytes]] = []
    lines = []
    for m in payload.messages:
        if m.role != "user":
            continue
        for img in m.images:
            images.append(decode_image(img.data))
        photo_note = f"［写真{len(m.images)}枚を貼付］" if m.images else ""
        lines.append(f"{photo_note}{m.content}")
    if len(images) > MAX_IMAGES_PER_INQUIRY:
        raise HTTPException(status_code=400, detail=f"写真は1件の問い合わせにつき{MAX_IMAGES_PER_INQUIRY}枚までです")

    inquiry = InquiryCreate(
        title=payload.title,
        body="\n\n".join(lines),
        reporter_name=payload.reporter_name,
    )
    # 職員への自動の聞き返しはせず、サポートチームがすぐ返信できるよう返信の下書きを用意する
    return _create_inquiry(db, inquiry, "AIで解決できない問い合わせ", actor, auto_request=False, images=images)


# ---------- 添付写真 ----------


@api.get(
    "/attachments/{attachment_id}",
    tags=["添付写真"],
    summary="添付写真の取得",
    response_class=Response,
    responses={200: {"content": {"image/*": {}}, "description": "画像"}},
)
def get_attachment(attachment_id: int, db: Session = Depends(get_db)):
    """添付写真の画像を返す"""
    attachment = db.get(AttachmentModel, attachment_id, options=[undefer(AttachmentModel.data)])
    if not attachment:
        raise HTTPException(status_code=404, detail="写真が見つかりません")
    return Response(
        content=attachment.data,
        media_type=attachment.media_type,
        # ログイン中の人だけが見る画像なので共有キャッシュには残さない。形式の推測も禁止する
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


# ---------- 通知 ----------


def _ensure_own_site(target_role: str, current: auth.Role) -> None:
    """ログインしたサイト（現場スタッフ用 / サポートチーム用）宛ての通知だけを扱えるようにする"""
    if target_role != auth.site_of(current):
        raise HTTPException(status_code=403, detail="ログインしたサイト宛ての通知だけを見られます")


@api.get("/notifications", response_model=NotificationList, tags=["通知"], summary="通知一覧")
def list_notifications(
    role: Literal["staff", "support"] = Query(description="通知の宛先（staff: 現場スタッフ / support: サポートチーム）"),
    db: Session = Depends(get_db),
    current: auth.Role = Depends(auth.require_login),
):
    _ensure_own_site(role, current)
    """通知の一覧（新しい順に最大30件）と未読件数を取得する"""
    items = db.scalars(
        select(NotificationModel)
        .where(NotificationModel.target_role == role)
        .order_by(NotificationModel.id.desc())
        .limit(30)
    ).all()
    unread_count = db.scalar(
        select(func.count())
        .select_from(NotificationModel)
        .where(NotificationModel.target_role == role, NotificationModel.is_read.is_(False))
    )
    return NotificationList(
        unread_count=unread_count or 0,
        items=[NotificationResponse.model_validate(n) for n in items],
    )


@api.post("/notifications/{notification_id}/read", status_code=204, tags=["通知"], summary="通知を既読にする")
def read_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current: auth.Role = Depends(auth.require_login),
):
    """通知を既読にする"""
    notification = db.get(NotificationModel, notification_id)
    if not notification or notification.target_role != auth.site_of(current):
        raise HTTPException(status_code=404, detail="通知が見つかりません")
    notification.is_read = True
    db.commit()


@api.post("/notifications/read-all", status_code=204, tags=["通知"], summary="通知をすべて既読にする")
def read_all_notifications(
    role: Literal["staff", "support"] = Query(description="通知の宛先（staff: 現場スタッフ / support: サポートチーム）"),
    db: Session = Depends(get_db),
    current: auth.Role = Depends(auth.require_login),
):
    _ensure_own_site(role, current)
    """宛先の通知をすべて既読にする"""
    db.execute(update(NotificationModel).where(NotificationModel.target_role == role).values(is_read=True))
    db.commit()


# ---------- ポップアップ通知（Web Push） ----------


@api.get("/push/public-key", response_model=PushPublicKey, tags=["通知"], summary="ポップアップ通知の公開鍵")
def get_push_public_key(db: Session = Depends(get_db)):
    """ブラウザでポップアップ通知を購読するときに使う公開鍵を返す"""
    return PushPublicKey(public_key=push.public_key(db))


@api.post("/push/subscriptions", status_code=204, tags=["通知"], summary="ポップアップ通知の登録")
def subscribe_push(
    payload: PushSubscribeRequest,
    db: Session = Depends(get_db),
    current: auth.Role = Depends(auth.require_login),
):
    """このブラウザにポップアップ通知を送るよう登録する（登録済みなら宛先を更新する）"""
    _ensure_own_site(payload.role, current)
    push.save_subscription(db, payload.endpoint, payload.keys.p256dh, payload.keys.auth, payload.role)


@api.post("/push/unsubscribe", status_code=204, tags=["通知"], summary="ポップアップ通知の解除")
def unsubscribe_push(payload: PushUnsubscribeRequest, db: Session = Depends(get_db)):
    """このブラウザへのポップアップ通知をやめる"""
    push.delete_subscription(db, payload.endpoint)


# ---------- よくある質問（FAQ） ----------


def _faq_status(db: Session) -> FaqStatus:
    return FaqStatus(
        count=db.scalar(select(func.count()).select_from(FaqEntryModel)) or 0,
        fetched_at=db.scalar(select(func.max(FaqEntryModel.fetched_at))),
        source_url=faq.FAQ_INDEX_URL,
    )


@api.get("/faq/status", dependencies=SUPPORT_ONLY, response_model=FaqStatus, tags=["よくある質問"], summary="FAQの取り込み状況")
def get_faq_status(db: Session = Depends(get_db)):
    """AIが引用に使うFAQの件数と、最後に取り込んだ日時を返す"""
    return _faq_status(db)


@api.post(
    "/faq/refresh",
    response_model=FaqStatus,
    dependencies=[Depends(auth.require_support_admin)],
    tags=["よくある質問"],
    summary="FAQを今すぐ取り込む（管理者のみ）",
)
def refresh_faq(db: Session = Depends(get_db), actor: Actor = Depends(audit.current_actor)):
    """参照元のサポートサイトからFAQを取り込み直す（通常は毎日自動。1分ほどかかる）"""
    try:
        faq.refresh_faq(db)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FAQを取り込めませんでした：{e}") from e
    status = _faq_status(db)
    audit.record(db, actor, "faq.refresh", f"FAQを取り込み直し（{status.count}件）")
    db.commit()
    return status


# ---------- バッチ ----------


@api.post("/batch/summaries", dependencies=SUPPORT_ONLY, response_model=BatchResult, tags=["バッチ"], summary="要約バッチの手動実行")
def run_summaries(db: Session = Depends(get_db), actor: Actor = Depends(audit.current_actor)):
    """自動要約バッチを手動で実行する（通常は毎日自動実行）"""
    count = run_summary_batch(db)
    audit.record(db, actor, "batch.summaries", f"要約バッチを手動で実行（{count}件を要約）")
    db.commit()
    return BatchResult(summarized_count=count)


# ---------- ダッシュボード ----------


@api.get("/dashboard", dependencies=SUPPORT_ONLY, response_model=DashboardResponse, tags=["ダッシュボード"], summary="ダッシュボードの集計")
def get_dashboard(
    days: int | None = Query(default=None, ge=1, le=365, description="直近何日分を集計するか（指定しなければ全期間）"),
    db: Session = Depends(get_db),
):
    """件数・平均対応時間・問い合わせが来る時間帯・カテゴリー別の傾向を集計する"""
    return dashboard.build(db, days)


# ---------- 監査ログ ----------


@api.get("/audit-logs", dependencies=SUPPORT_ONLY, response_model=AuditLogList, tags=["監査ログ"], summary="監査ログ一覧")
def list_audit_logs(
    action: str | None = Query(
        default=None,
        max_length=50,
        description="操作の種類で絞り込み（前方一致。例: inquiry. で問い合わせの操作すべて、auth.login で完全一致）",
    ),
    inquiry_id: int | None = Query(default=None, description="問い合わせIDで絞り込み"),
    q: str = Query(default="", description="キーワード（名前・内容・接続元に部分一致）"),
    limit: int = Query(default=50, ge=1, le=200, description="取得件数"),
    offset: int = Query(default=0, ge=0, description="読み飛ばす件数（次のページを読むとき）"),
    db: Session = Depends(get_db),
):
    """誰が・いつ・何を変えたかの記録を新しい順に返す（サポートチームのみ）"""
    conditions = []
    if action:
        conditions.append(AuditLogModel.action.startswith(action, autoescape=True))
    if inquiry_id is not None:
        conditions.append(AuditLogModel.inquiry_id == inquiry_id)
    for keyword in _split_keywords(q):
        conditions.append(
            or_(
                AuditLogModel.actor_name.contains(keyword, autoescape=True),
                AuditLogModel.employee_code.contains(keyword, autoescape=True),
                AuditLogModel.summary.contains(keyword, autoescape=True),
                AuditLogModel.changes.contains(keyword, autoescape=True),
                AuditLogModel.ip_address.contains(keyword, autoescape=True),
            )
        )
    total = db.scalar(select(func.count()).select_from(AuditLogModel).where(*conditions)) or 0
    items = db.scalars(
        select(AuditLogModel)
        .where(*conditions)
        .order_by(AuditLogModel.created_at.desc(), AuditLogModel.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    # 削除済みの問い合わせへのリンクを出さないよう、残っているかを調べる
    inquiry_ids = {i.inquiry_id for i in items if i.inquiry_id is not None}
    existing = set(db.scalars(select(InquiryModel.id).where(InquiryModel.id.in_(inquiry_ids)))) if inquiry_ids else set()
    return AuditLogList(
        total=total,
        items=[
            AuditLogResponse.model_validate(i).model_copy(update={"inquiry_exists": i.inquiry_id in existing})
            for i in items
        ],
    )


app.include_router(api)
