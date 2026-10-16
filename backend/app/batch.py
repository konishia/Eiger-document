"""自動要約バッチ（あわせて FAQ も毎日取り込み直す）

- アプリ起動中は毎日 SUMMARY_BATCH_HOUR 時（既定: 3時）に自動実行する
- 手動実行: `POST /batch/summaries` または `python batch.py`
"""

import logging
import os
import threading
from datetime import datetime, timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

import faq
from ai_service import summarize
from database import SessionLocal
from models import InquiryModel

logger = logging.getLogger(__name__)

SUMMARY_BATCH_HOUR = int(os.getenv("SUMMARY_BATCH_HOUR", "3"))


def run_summary_batch(db: Session) -> int:
    """要約が未作成、または要約作成後に更新された問い合わせを要約する。処理件数を返す"""
    targets = db.scalars(
        select(InquiryModel).where(
            or_(
                InquiryModel.summary_generated_at.is_(None),
                InquiryModel.updated_at > InquiryModel.summary_generated_at,
            )
        )
    ).all()

    for inquiry in targets:
        comments = [f"{c.author_name}: {c.body}" for c in inquiry.comments]
        summary = summarize(inquiry.title, inquiry.body, comments)
        # 要約の保存で updated_at（最終更新日時）が進まないよう、元の値のまま SET する
        db.execute(
            update(InquiryModel)
            .where(InquiryModel.id == inquiry.id)
            .values(
                summary=summary,
                summary_generated_at=func.now(),
                updated_at=InquiryModel.updated_at,
            )
        )
        db.commit()

    logger.info("要約バッチ完了: %d 件", len(targets))
    return len(targets)


def _seconds_until_next_run() -> float:
    now = datetime.now()
    next_run = now.replace(hour=SUMMARY_BATCH_HOUR, minute=0, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    return (next_run - now).total_seconds()


def _scheduler_loop(stop_event: threading.Event) -> None:
    while not stop_event.wait(_seconds_until_next_run()):
        try:
            with SessionLocal() as db:
                run_summary_batch(db)
        except Exception:
            logger.exception("要約バッチでエラーが発生しました")
        # よくある質問（FAQ）も毎日取り込み直す
        faq.refresh_if_stale()


def start_scheduler() -> threading.Event:
    """日次バッチのスケジューラをバックグラウンドで開始する。停止用の Event を返す"""
    stop_event = threading.Event()
    threading.Thread(target=_scheduler_loop, args=(stop_event,), daemon=True).start()
    return stop_event


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    with SessionLocal() as session:
        print(f"{run_summary_batch(session)} 件を要約しました")
