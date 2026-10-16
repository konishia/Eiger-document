"""Pydanticスキーマ（APIの入出力の型）

Swagger UI（/docs）に表示される名前・説明もすべて日本語で記載する。
"""

import json
from datetime import date as date_type
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from auth import EMPLOYEE_CODE_PATTERN, normalize_employee_code
from images import MAX_IMAGES_PER_MESSAGE

# ---------- サンプル ----------


class SampleCreate(BaseModel):
    model_config = ConfigDict(title="サンプル作成")

    name: str = Field(title="名前")


class SampleResponse(BaseModel):
    model_config = ConfigDict(title="サンプル", from_attributes=True)

    id: int = Field(title="ID")
    name: str = Field(title="名前")


# ---------- 問い合わせ ----------

InquiryStatus = Literal["open", "waiting_info", "first_answered", "closed"]
AuthorRole = Literal["staff", "support", "ai"]
TargetRole = Literal["staff", "support"]

STATUS_DESCRIPTION = "open（未対応） / waiting_info（情報待ち） / first_answered（一次回答提示済み） / closed（対応完了）"


class InquiryCreate(BaseModel):
    model_config = ConfigDict(title="問い合わせ作成")

    title: str = Field(min_length=1, max_length=200, title="件名")
    body: str = Field(min_length=1, title="内容")
    reporter_name: str = Field(min_length=1, max_length=100, title="起票者", description="所属・お名前")


class InquiryUpdate(BaseModel):
    """部分更新（指定した項目だけ更新する）"""

    model_config = ConfigDict(title="問い合わせ更新")

    title: str | None = Field(default=None, min_length=1, max_length=200, title="件名")
    body: str | None = Field(default=None, min_length=1, title="内容")
    reporter_name: str | None = Field(default=None, min_length=1, max_length=100, title="起票者")
    status: InquiryStatus | None = Field(default=None, title="ステータス", description=STATUS_DESCRIPTION)


class ChatImage(BaseModel):
    model_config = ConfigDict(title="貼付する写真")

    data: str = Field(title="画像データ", description="Base64 で符号化した画像（JPEG・PNG・GIF・WebP、5MB以下）")


class CommentCreate(BaseModel):
    model_config = ConfigDict(title="コメント作成")

    author_name: str = Field(min_length=1, max_length=100, title="投稿者名")
    author_role: Literal["staff", "support"] = Field(
        title="投稿者の立場", description="staff（現場スタッフ） / support（サポートチーム）"
    )
    body: str = Field(default="", title="本文")
    images: list[ChatImage] = Field(
        default_factory=list, max_length=MAX_IMAGES_PER_MESSAGE, title="貼付した写真", description="1回4枚まで"
    )
    new_status: InquiryStatus | None = Field(
        default=None,
        title="変更後のステータス",
        description="コメント投稿と同時にステータスも変えたい場合に指定（未指定なら変更しない）",
    )

    @model_validator(mode="after")
    def _not_empty(self) -> "CommentCreate":
        if not self.body.strip() and not self.images:
            raise ValueError("本文か写真のどちらかを入力してください")
        return self


class CommentResponse(BaseModel):
    model_config = ConfigDict(title="コメント", from_attributes=True)

    id: int = Field(title="ID")
    inquiry_id: int = Field(title="問い合わせID")
    author_name: str = Field(title="投稿者名")
    author_role: AuthorRole = Field(
        title="投稿者の立場", description="staff（現場スタッフ） / support（サポートチーム） / ai（AI自動投稿）"
    )
    body: str = Field(title="本文")
    created_at: datetime = Field(title="投稿日時")
    attachments: list["AttachmentResponse"] = Field(title="添付写真")


class AttachmentResponse(BaseModel):
    model_config = ConfigDict(title="添付写真", from_attributes=True)

    id: int = Field(title="ID", description="GET /attachments/{ID} で画像を取得できる")
    media_type: str = Field(title="画像形式")
    created_at: datetime = Field(title="添付日時")


CommentResponse.model_rebuild()


def _load_json_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return json.loads(str(value))


class InquirySummary(BaseModel):
    """一覧表示用"""

    model_config = ConfigDict(title="問い合わせ（一覧用）", from_attributes=True)

    id: int = Field(title="ID")
    title: str = Field(title="件名")
    reporter_name: str = Field(title="起票者")
    status: InquiryStatus = Field(title="ステータス", description=STATUS_DESCRIPTION)
    summary: str | None = Field(title="要約")
    created_at: datetime = Field(title="作成日時")
    updated_at: datetime = Field(title="更新日時")
    comment_count: int = Field(default=0, title="コメント数")
    last_comment_role: AuthorRole | None = Field(
        default=None, title="最後のコメントの投稿者", description="support なら「サポートチームから回答あり」"
    )


class InquiryResponse(BaseModel):
    """詳細表示用"""

    model_config = ConfigDict(title="問い合わせ（詳細）", from_attributes=True)

    id: int = Field(title="ID")
    title: str = Field(title="件名")
    body: str = Field(title="内容")
    reporter_name: str = Field(title="起票者")
    status: InquiryStatus = Field(title="ステータス", description=STATUS_DESCRIPTION)
    summary: str | None = Field(title="要約")
    summary_generated_at: datetime | None = Field(title="要約の生成日時")
    ai_missing_fields: list[str] = Field(title="AIが判定した不足項目")
    ai_questions: list[str] = Field(title="AIによる追加確認事項")
    ai_probable_cause: str | None = Field(title="AIによる想定原因")
    ai_action_required: bool | None = Field(title="AIによる対応要否", description="true: 要対応 / false: 対応不要")
    ai_draft_answer: str | None = Field(title="AIによる返信の下書き")
    ai_checked_at: datetime | None = Field(title="AIチェック日時")
    created_at: datetime = Field(title="作成日時")
    updated_at: datetime = Field(title="更新日時")
    comments: list[CommentResponse] = Field(title="やり取りの履歴")
    attachments: list[AttachmentResponse] = Field(title="添付写真")

    @field_validator("ai_missing_fields", "ai_questions", mode="before")
    @classmethod
    def _parse_lists(cls, value: object) -> list[str]:
        """DBにはJSON文字列で保存しているのでリストに戻す"""
        return _load_json_list(value)


# ---------- 必須項目定義 ----------


class RequiredFieldCreate(BaseModel):
    model_config = ConfigDict(title="必須項目作成")

    name: str = Field(min_length=1, max_length=100, title="項目名")
    description: str = Field(default="", title="説明")
    keywords: str = Field(default="", title="簡易判定キーワード", description="カンマ区切り。AI未使用時の判定に使う")
    is_active: bool = Field(default=True, title="有効")


class RequiredFieldUpdate(BaseModel):
    model_config = ConfigDict(title="必須項目更新")

    name: str | None = Field(default=None, min_length=1, max_length=100, title="項目名")
    description: str | None = Field(default=None, title="説明")
    keywords: str | None = Field(default=None, title="簡易判定キーワード")
    is_active: bool | None = Field(default=None, title="有効")


class RequiredFieldResponse(BaseModel):
    model_config = ConfigDict(title="必須項目", from_attributes=True)

    id: int = Field(title="ID")
    name: str = Field(title="項目名")
    description: str = Field(title="説明")
    keywords: str = Field(title="簡易判定キーワード")
    is_active: bool = Field(title="有効")


# ---------- AI ----------


class PrecheckRequest(BaseModel):
    """保存前（入力中）のAIチェック用"""

    model_config = ConfigDict(title="入力中のAIチェック")

    title: str = Field(default="", title="件名")
    body: str = Field(default="", title="内容")


class AICheckResult(BaseModel):
    """AIチェック結果"""

    model_config = ConfigDict(title="AIチェック結果")

    is_complete: bool = Field(title="必須項目がすべて揃っているか")
    missing_fields: list[str] = Field(title="不足項目")
    questions: list[str] = Field(title="追加確認事項")
    probable_cause: str | None = Field(default=None, title="想定原因")
    action_required: bool | None = Field(default=None, title="対応要否")
    draft_answer: str | None = Field(default=None, title="一次回答の下書き")
    engine: Literal["claude", "rule"] = Field(
        title="判定方法", description="claude（AI判定） / rule（APIキー未設定などによるキーワード簡易判定）"
    )


class BatchResult(BaseModel):
    model_config = ConfigDict(title="バッチ実行結果")

    summarized_count: int = Field(title="要約した件数")


class FaqStatus(BaseModel):
    model_config = ConfigDict(title="FAQの取り込み状況")

    count: int = Field(title="取り込んだ件数")
    fetched_at: datetime | None = Field(title="最後に取り込んだ日時")
    source_url: str = Field(title="参照元")


# ---------- ログイン ----------

LoginRole = Literal["staff", "support", "staff_admin", "support_admin"]
ROLE_DESCRIPTION = (
    "staff（現場スタッフ） / support（サポートチーム） / "
    "staff_admin（現場スタッフ管理者） / support_admin（サポートチーム管理者）"
)


def _validate_employee_code(value: object) -> str:
    """全角で入力されても半角にしてから、従業員コードの形式を確認する"""
    code = normalize_employee_code(str(value or ""))
    if not code:
        raise ValueError("入力してください")
    if not EMPLOYEE_CODE_PATTERN.fullmatch(code):
        raise ValueError("英数字・ハイフン（-）・アンダースコア（_）の20文字以内で入力してください")
    return code


class LoginRequest(BaseModel):
    model_config = ConfigDict(title="ログイン")

    site: Literal["staff", "support"] = Field(
        title="使うサイト", description="staff（現場スタッフ用） / support（サポートチーム用）"
    )
    employee_code: str = Field(
        title="従業員コード",
        description="英数字・ハイフン・アンダースコアで20文字まで（全角で入力しても半角にする）。監査ログに記録する",
    )
    password: str = Field(
        title="パスワード", description="選んだサイトのパスワード（そのサイトの管理者パスワードでも入れる）"
    )

    @field_validator("employee_code", mode="before")
    @classmethod
    def _check_employee_code(cls, value: object) -> str:
        return _validate_employee_code(value)


class MeResponse(BaseModel):
    model_config = ConfigDict(title="ログイン中の利用者")

    role: LoginRole = Field(title="権限", description=ROLE_DESCRIPTION)
    employee_code: str = Field(title="従業員コード")
    employee_name: str = Field(
        title="所属・お名前", description="従業員名簿の名前。問い合わせ・返信の名前欄に自動で入れる（名簿に無ければ空）"
    )


# ---------- 従業員名簿 ----------


class EmployeeCreate(BaseModel):
    model_config = ConfigDict(title="従業員の登録")

    code: str = Field(title="従業員コード", description="英数字・ハイフン・アンダースコアで20文字まで")
    name: str = Field(min_length=1, max_length=100, title="所属・お名前", description="例: 入園ゲート 田中")
    is_active: bool = Field(default=True, title="有効")

    @field_validator("code", mode="before")
    @classmethod
    def _check_code(cls, value: object) -> str:
        return _validate_employee_code(value)


class EmployeeUpdate(BaseModel):
    model_config = ConfigDict(title="従業員の編集")

    name: str | None = Field(default=None, min_length=1, max_length=100, title="所属・お名前")
    is_active: bool | None = Field(default=None, title="有効", description="無効にするとその従業員コードではログインできない")


class EmployeeResponse(BaseModel):
    model_config = ConfigDict(title="従業員", from_attributes=True)

    id: int = Field(title="ID")
    code: str = Field(title="従業員コード")
    name: str = Field(title="所属・お名前")
    is_active: bool = Field(title="有効")
    created_at: datetime = Field(title="登録日時")


class PasswordChangeRequest(BaseModel):
    model_config = ConfigDict(title="パスワード変更")

    target: LoginRole = Field(
        title="変更するパスワード", description=ROLE_DESCRIPTION + "。自分のサイトのものだけ変更できる"
    )
    current_password: str = Field(
        title="現在の管理者パスワード", description="本人確認のため、ログイン中の管理者自身のパスワードを入力する"
    )
    new_password: str = Field(min_length=3, max_length=128, title="新しいパスワード")


# ---------- 通知 ----------


class NotificationResponse(BaseModel):
    model_config = ConfigDict(title="通知", from_attributes=True)

    id: int = Field(title="ID")
    target_role: TargetRole = Field(title="宛先", description="staff（現場スタッフ） / support（サポートチーム）")
    inquiry_id: int | None = Field(title="問い合わせID")
    message: str = Field(title="メッセージ")
    is_read: bool = Field(title="既読")
    created_at: datetime = Field(title="通知日時")


class NotificationList(BaseModel):
    model_config = ConfigDict(title="通知一覧")

    unread_count: int = Field(title="未読件数")
    items: list[NotificationResponse] = Field(title="通知（新しい順）")


# ---------- ポップアップ通知（Web Push） ----------


class PushPublicKey(BaseModel):
    model_config = ConfigDict(title="通知用の公開鍵")

    public_key: str = Field(title="公開鍵", description="ブラウザで通知を購読するときの applicationServerKey")


class PushKeys(BaseModel):
    model_config = ConfigDict(title="通知の暗号鍵")

    p256dh: str = Field(max_length=200, title="p256dh")
    auth: str = Field(max_length=100, title="auth")


class PushSubscribeRequest(BaseModel):
    model_config = ConfigDict(title="ポップアップ通知の登録")

    endpoint: str = Field(max_length=700, pattern=r"^https://", title="送り先URL", description="ブラウザが発行したURL")
    keys: PushKeys = Field(title="暗号鍵")
    role: TargetRole = Field(title="宛先", description="staff（現場スタッフ） / support（サポートチーム）")


class PushUnsubscribeRequest(BaseModel):
    model_config = ConfigDict(title="ポップアップ通知の解除")

    endpoint: str = Field(max_length=700, title="送り先URL")


# ---------- 来場者対応チャット ----------


class ChatMessage(BaseModel):
    model_config = ConfigDict(title="チャットのメッセージ")

    role: Literal["user", "assistant"] = Field(title="発言者", description="user（職員） / assistant（AI）")
    content: str = Field(default="", title="本文")
    images: list[ChatImage] = Field(
        default_factory=list, max_length=MAX_IMAGES_PER_MESSAGE, title="貼付した写真", description="1メッセージ4枚まで"
    )

    @model_validator(mode="after")
    def _not_empty(self) -> "ChatMessage":
        if not self.content.strip() and not self.images:
            raise ValueError("本文か写真のどちらかを入力してください")
        if self.images and self.role != "user":
            raise ValueError("写真を貼付できるのは職員のメッセージだけです")
        return self


class ChatRequest(BaseModel):
    model_config = ConfigDict(title="チャットの質問")

    messages: list[ChatMessage] = Field(min_length=1, title="会話の履歴", description="最後は職員の質問にする")


class FaqReference(BaseModel):
    model_config = ConfigDict(title="引用したFAQ")

    question: str = Field(title="質問")
    url: str = Field(title="出典URL")


class ChatReply(BaseModel):
    model_config = ConfigDict(title="チャットの回答")

    answer: str = Field(title="AIの回答")
    faq_refs: list[FaqReference] = Field(default_factory=list, title="引用したFAQ", description="回答で引用したよくある質問")
    can_resolve: bool = Field(
        title="解決の見込み", description="職員の案内だけで解決できる見込みか（false ならサポートチームへの送信をすすめる）"
    )
    suggested_title: str = Field(title="件名の候補", description="サポートチームへ送る場合の件名")
    engine: Literal["claude", "rule"] = Field(title="回答方法", description="claude（AI） / rule（キーワード簡易判定）")


class EscalateRequest(BaseModel):
    """チャットで解決できなかった内容をサポートチームへ送る"""

    model_config = ConfigDict(title="サポートチームへの送信")

    title: str = Field(min_length=1, max_length=200, title="件名")
    reporter_name: str = Field(min_length=1, max_length=100, title="起票者", description="所属・お名前")
    messages: list[ChatMessage] = Field(min_length=1, title="チャットのやり取り")


# ---------- ダッシュボード ----------


class DailyCount(BaseModel):
    model_config = ConfigDict(title="日別の件数")

    date: date_type = Field(title="日付")
    count: int = Field(title="件数")


class HourlyCount(BaseModel):
    model_config = ConfigDict(title="時間帯別の件数")

    hour: int = Field(title="時（0〜23）")
    count: int = Field(title="件数")


class WeekdayCount(BaseModel):
    model_config = ConfigDict(title="曜日別の件数")

    weekday: int = Field(title="曜日", description="0（月）〜 6（日）")
    count: int = Field(title="件数")


class CategoryStat(BaseModel):
    model_config = ConfigDict(title="カテゴリー別の集計")

    name: str = Field(title="カテゴリー", description="よくある事例（QRが読み取れない など）。当てはまらなければ「その他」")
    count: int = Field(title="件数")
    unresolved_count: int = Field(title="未完了の件数")
    avg_first_response_minutes: float | None = Field(title="初回回答までの平均（分）")
    avg_resolution_minutes: float | None = Field(title="解決までの平均（分）")


class DashboardResponse(BaseModel):
    model_config = ConfigDict(title="ダッシュボード")

    days: int | None = Field(title="集計期間（日）", description="空なら全期間")
    since: datetime | None = Field(title="集計の開始日時")
    total: int = Field(title="期間内の問い合わせ件数")
    previous_total: int | None = Field(title="直前の同じ長さの期間の件数", description="全期間のときは空")
    unresolved_total: int = Field(title="現在の未完了件数（期間に関係なく）")
    status_counts: dict[InquiryStatus, int] = Field(title="ステータス別の件数（期間内）")
    avg_first_response_minutes: float | None = Field(title="初回回答までの平均（分）")
    median_first_response_minutes: float | None = Field(title="初回回答までの中央値（分）")
    first_response_count: int = Field(title="初回回答済みの件数")
    avg_resolution_minutes: float | None = Field(title="解決までの平均（分）")
    median_resolution_minutes: float | None = Field(title="解決までの中央値（分）")
    resolution_count: int = Field(title="対応完了の件数")
    daily: list[DailyCount] = Field(title="日別の件数")
    hourly: list[HourlyCount] = Field(title="時間帯別の件数")
    weekday: list[WeekdayCount] = Field(title="曜日別の件数")
    categories: list[CategoryStat] = Field(title="カテゴリー別の集計（件数の多い順）")


# ---------- 監査ログ ----------


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(title="監査ログ", from_attributes=True)

    id: int = Field(title="ID")
    created_at: datetime = Field(title="日時")
    actor_role: str = Field(
        title="操作した権限",
        description=ROLE_DESCRIPTION + " / system（AI・自動処理） / anonymous（ログイン前）",
    )
    employee_code: str = Field(title="従業員コード", description="ログイン時に入力した従業員コード。分からなければ空")
    actor_name: str = Field(title="操作した人の名前", description="本人の申告による名前。分からなければ空")
    ip_address: str = Field(title="接続元")
    action: str = Field(title="操作の種類")
    inquiry_id: int | None = Field(title="問い合わせID")
    inquiry_exists: bool = Field(default=False, title="問い合わせが残っているか", description="削除済みなら false")
    summary: str = Field(title="内容")
    changes: dict[str, list[str | None]] = Field(title="変更内容", description='{"項目": ["変更前", "変更後"]}')

    @field_validator("changes", mode="before")
    @classmethod
    def _parse_changes(cls, value: object) -> dict:
        """DBにはJSON文字列で保存しているので辞書に戻す"""
        if value is None:
            return {}
        return value if isinstance(value, dict) else json.loads(str(value))


class AuditLogList(BaseModel):
    model_config = ConfigDict(title="監査ログ一覧")

    total: int = Field(title="条件に合う件数")
    items: list[AuditLogResponse] = Field(title="記録（新しい順）")


class EmployeeImportRow(BaseModel):
    model_config = ConfigDict(title="一括読み込みの1行")

    line: int = Field(title="ファイルの行番号", description="エラーの場所を伝えるために使う")
    code: str = Field(max_length=100, title="従業員コード")
    name: str = Field(max_length=300, title="所属・お名前")
    is_active: bool = Field(default=True, title="有効")


class EmployeeImportRequest(BaseModel):
    model_config = ConfigDict(title="従業員名簿の一括読み込み")

    rows: list[EmployeeImportRow] = Field(min_length=1, max_length=5000, title="読み込む行")


class SpreadsheetRequest(BaseModel):
    model_config = ConfigDict(title="Excelファイルの読み取り")

    data: str = Field(max_length=3 * 1024 * 1024, title="ファイル", description="Excelファイル（.xlsx / .xls）を Base64 にしたもの（2MBまで）")


class SpreadsheetResponse(BaseModel):
    model_config = ConfigDict(title="Excelファイルの中身")

    sheet: str = Field(title="読み取ったシート名", description="データのある最初のシート")
    rows: list[list[str]] = Field(title="表", description="行 × 列。セルは見えている文字に近い文字列にしたもの")


class EmployeeImportResult(BaseModel):
    model_config = ConfigDict(title="一括読み込みの結果")

    created: int = Field(title="追加した人数")
    updated: int = Field(title="更新した人数")
    unchanged: int = Field(title="変更がなかった人数")
