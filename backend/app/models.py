"""SQLAlchemyモデル"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.mysql import MEDIUMBLOB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class SampleModel(Base):
    __tablename__ = "samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)


class InquiryModel(Base):
    """問い合わせ"""

    __tablename__ = "inquiries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    reporter_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # open（未対応） / waiting_info（情報待ち） / first_answered（一次回答提示済み） / closed（対応完了）
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", index=True)
    # 対応完了にした日時（ダッシュボードの平均対応時間に使う。対応完了から戻したら空に戻す）
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # 自動要約（日次バッチで生成）
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # AIチェック結果（JSON文字列で保持）
    ai_missing_fields: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_questions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # AI一次回答の下書き（スタッフが採用・修正の上送信する）
    ai_probable_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_action_required: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    ai_draft_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    comments: Mapped[list["CommentModel"]] = relationship(
        back_populates="inquiry",
        cascade="all, delete-orphan",
        order_by="CommentModel.created_at",
    )
    # 問い合わせに付いた写真すべて（コメントに付けた写真も含む。問い合わせを消すと一緒に消える）
    all_attachments: Mapped[list["AttachmentModel"]] = relationship(
        back_populates="inquiry",
        cascade="all, delete-orphan",
        order_by="AttachmentModel.id",
    )

    @property
    def attachments(self) -> list["AttachmentModel"]:
        """問い合わせ本文に付いた写真（コメントに付けた写真は各コメントに表示する）"""
        return [a for a in self.all_attachments if a.comment_id is None]


class CommentModel(Base):
    """問い合わせに対するコメント・返信（やり取りの履歴）"""

    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    inquiry_id: Mapped[int] = mapped_column(
        ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # staff（現場スタッフ） / support（サポートチーム） / ai（AI自動投稿）
    author_role: Mapped[str] = mapped_column(String(20), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    inquiry: Mapped[InquiryModel] = relationship(back_populates="comments")
    attachments: Mapped[list["AttachmentModel"]] = relationship(
        back_populates="comment",
        order_by="AttachmentModel.id",
    )


class AttachmentModel(Base):
    """問い合わせ・返信に添付された写真（AIチャットや返信欄で貼付されたもの）"""

    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    inquiry_id: Mapped[int] = mapped_column(
        ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 返信（コメント）に付けた写真ならそのコメント。問い合わせ本文の写真なら空
    comment_id: Mapped[int | None] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    media_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # 画像本体（MySQL では最大 16MB の MEDIUMBLOB）
    data: Mapped[bytes] = mapped_column(
        LargeBinary().with_variant(MEDIUMBLOB(), "mysql"), nullable=False, deferred=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    inquiry: Mapped[InquiryModel] = relationship(back_populates="all_attachments")
    comment: Mapped[CommentModel | None] = relationship(back_populates="attachments")


class NotificationModel(Base):
    """通知（画面右上のベルに表示される）"""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # 通知の宛先: support（サポートチーム） / staff（現場スタッフ）
    target_role: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    inquiry_id: Mapped[int | None] = mapped_column(
        ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=True, index=True
    )
    message: Mapped[str] = mapped_column(String(300), nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class PushSubscriptionModel(Base):
    """ポップアップ通知（Web Push）の送り先となるブラウザ"""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # ブラウザごとに発行される送り先のURL
    endpoint: Mapped[str] = mapped_column(String(700), nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(String(200), nullable=False)
    auth: Mapped[str] = mapped_column(String(100), nullable=False)
    # 通知の宛先: support（サポートチーム） / staff（現場スタッフ）
    target_role: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class FaqEntryModel(Base):
    """よくある質問（参照元のサポートサイトから取り込んだもの）"""

    __tablename__ = "faq_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    url: Mapped[str] = mapped_column(String(700), nullable=False, unique=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    question: Mapped[str] = mapped_column(String(300), nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class AppSettingModel(Base):
    """アプリ全体の設定値（共通パスワードのハッシュなど）"""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class RequiredFieldModel(Base):
    """サポートチームが定義する問い合わせの必須項目"""

    __tablename__ = "required_fields"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # AI未使用時の簡易判定に使うキーワード（カンマ区切り。どれか1つが本文に含まれていれば記載ありとみなす）
    keywords: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AuditLogModel(Base):
    """監査ログ（誰が・いつ・何を変えたか）

    問い合わせを削除しても記録は残すため、問い合わせへの外部キーは張らない
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), index=True)
    # 操作した権限: staff / support / staff_admin / support_admin / system（AI・自動処理） / anonymous（ログイン前）
    actor_role: Mapped[str] = mapped_column(String(20), nullable=False)
    # ログイン時に入力した従業員コード（分からなければ空）
    employee_code: Mapped[str] = mapped_column(String(20), nullable=False, default="", index=True)
    # 操作した人の名前（入力欄の名前、または画面で最後に使った名前。分からなければ空）
    actor_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # 操作の種類（inquiry.create / inquiry.update / inquiry.delete / comment.create など）
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    inquiry_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # 一覧に表示する説明（例: #12「QRが読めない」のステータスを変更）
    summary: Mapped[str] = mapped_column(String(300), nullable=False)
    # 変更内容（JSON文字列。{"項目": ["変更前", "変更後"]}）
    changes: Mapped[str | None] = mapped_column(Text, nullable=True)


class EmployeeModel(Base):
    """従業員名簿（管理者が登録する。一般のパスワードでは、ここに登録された従業員コードでだけログインできる）"""

    __tablename__ = "employees"
    # 名簿はサイトごとに分ける（同じ従業員コードでも、現場スタッフ用とサポートチーム用は別の人として扱う）
    __table_args__ = (UniqueConstraint("site", "code", name="uq_employees_site_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # staff（現場スタッフ用） / support（サポートチーム用）
    site: Mapped[str] = mapped_column(String(20), nullable=False, default="staff")
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    # 問い合わせ・返信の「所属・お名前」に自動で入れる（例: 入園ゲート 田中）
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # 退職・異動などで使わなくなったら無効にする（記録に残っているコードの意味が分かるよう、消さずに残せる）
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
