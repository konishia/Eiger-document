"""ダッシュボードの集計（件数・平均対応時間・問い合わせが来る時間帯・カテゴリー別の傾向）

- 集計対象は、期間内に作成された問い合わせ
- 初回回答までの時間: 作成から、サポートチームが最初に返信するまで（AIの自動投稿は含めない）
- 解決までの時間: 作成から、対応完了にするまで
- カテゴリー: 件名と内容から、park_cases.py の事例（QRが読み取れない など）にキーワードで振り分ける
  （どれにも当てはまらなければ「その他」）
"""

import statistics
from collections import Counter
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

import park_cases
from ai_service import normalize
from models import InquiryModel
from schemas import CategoryStat, DailyCount, DashboardResponse, HourlyCount, WeekdayCount

OTHER_CATEGORY = "その他"
STATUSES = ("open", "waiting_info", "first_answered", "closed")


def category_of(inquiry: InquiryModel) -> str:
    case = park_cases.find_case(normalize(f"{inquiry.title}\n{inquiry.body}"))
    return case.name if case else OTHER_CATEGORY


def _first_response_minutes(inquiry: InquiryModel) -> float | None:
    first = next((c for c in inquiry.comments if c.author_role == "support"), None)
    if first is None:
        return None
    return max((first.created_at - inquiry.created_at).total_seconds() / 60, 0)


def _resolution_minutes(inquiry: InquiryModel) -> float | None:
    if inquiry.status != "closed" or inquiry.closed_at is None:
        return None
    return max((inquiry.closed_at - inquiry.created_at).total_seconds() / 60, 0)


def _avg(values: list[float]) -> float | None:
    return round(statistics.mean(values), 1) if values else None


def _median(values: list[float]) -> float | None:
    return round(statistics.median(values), 1) if values else None


def build(db: Session, days: int | None) -> DashboardResponse:
    now = datetime.now()
    today = now.date()
    since = datetime.combine(today - timedelta(days=days - 1), datetime.min.time()) if days else None

    stmt = select(InquiryModel).options(selectinload(InquiryModel.comments))
    if since:
        stmt = stmt.where(InquiryModel.created_at >= since)
    inquiries = list(db.scalars(stmt))

    previous_total = None
    if since and days:
        previous_since = since - timedelta(days=days)
        previous_total = db.scalar(
            select(func.count())
            .select_from(InquiryModel)
            .where(InquiryModel.created_at >= previous_since, InquiryModel.created_at < since)
        )
    unresolved_total = db.scalar(
        select(func.count()).select_from(InquiryModel).where(InquiryModel.status != "closed")
    )

    first_responses = [m for i in inquiries if (m := _first_response_minutes(i)) is not None]
    resolutions = [m for i in inquiries if (m := _resolution_minutes(i)) is not None]

    # 日別の件数（期間の初日から今日まで、0件の日も含める）
    start: date = since.date() if since else min((i.created_at.date() for i in inquiries), default=today)
    per_day = Counter(i.created_at.date() for i in inquiries)
    daily = [
        DailyCount(date=start + timedelta(days=n), count=per_day[start + timedelta(days=n)])
        for n in range((today - start).days + 1)
    ]

    per_hour = Counter(i.created_at.hour for i in inquiries)
    per_weekday = Counter(i.created_at.weekday() for i in inquiries)

    # カテゴリー別（件数の多い順。事例に無いものは最後に「その他」）
    grouped: dict[str, list[InquiryModel]] = {}
    for inquiry in inquiries:
        grouped.setdefault(category_of(inquiry), []).append(inquiry)
    categories = []
    for name, items in grouped.items():
        responses = [m for i in items if (m := _first_response_minutes(i)) is not None]
        resolved = [m for i in items if (m := _resolution_minutes(i)) is not None]
        categories.append(
            CategoryStat(
                name=name,
                count=len(items),
                unresolved_count=sum(1 for i in items if i.status != "closed"),
                avg_first_response_minutes=_avg(responses),
                avg_resolution_minutes=_avg(resolved),
            )
        )
    categories.sort(key=lambda c: (c.name == OTHER_CATEGORY, -c.count))

    status_counts = Counter(i.status for i in inquiries)
    return DashboardResponse(
        days=days,
        since=since,
        total=len(inquiries),
        previous_total=previous_total,
        unresolved_total=unresolved_total or 0,
        status_counts={s: status_counts[s] for s in STATUSES},
        avg_first_response_minutes=_avg(first_responses),
        median_first_response_minutes=_median(first_responses),
        first_response_count=len(first_responses),
        avg_resolution_minutes=_avg(resolutions),
        median_resolution_minutes=_median(resolutions),
        resolution_count=len(resolutions),
        daily=daily,
        hourly=[HourlyCount(hour=h, count=per_hour[h]) for h in range(24)],
        weekday=[WeekdayCount(weekday=w, count=per_weekday[w]) for w in range(7)],
        categories=categories,
    )
