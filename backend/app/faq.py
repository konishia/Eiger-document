"""よくある質問（FAQ）の取り込みと検索

参照元: https://support.terravie.co.jp/faq/
- FAQ の一覧ページから各質問のページをたどり、質問・回答・URL・カテゴリを DB（faq_entries）に保存する
- 起動時（未取得、または1日以上経過している場合）と、日次バッチで更新する
- 取得は1件ずつ間隔をあけて行い、相手のサーバーに負荷をかけない
- AI の回答で該当する FAQ を引用するほか、AI が使えない場合はキーワードの一致度で FAQ を探す
"""

import html
import logging
import math
import re
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import SessionLocal
from models import FaqEntryModel

logger = logging.getLogger(__name__)

FAQ_INDEX_URL = "https://support.terravie.co.jp/faq/"
USER_AGENT = "ParkSupportFAQReader/1.0 (internal inquiry tool)"
REQUEST_INTERVAL_SECONDS = 1.0
REFRESH_AFTER = timedelta(days=1)

_refresh_lock = threading.Lock()


# ---------- 取り込み ----------


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as res:
        return res.read().decode("utf-8", errors="replace")


def _html_to_text(fragment: str) -> str:
    """HTML の断片を、段落・改行を残したプレーンテキストにする"""
    text = re.sub(r"(?i)<br\s*/?>", "\n", fragment)
    text = re.sub(r"(?i)</(p|li|h[1-6]|div|tr)>", "\n", text)
    text = re.sub(r"(?i)<li[^>]*>", "・", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _parse_index(page: str) -> list[tuple[str, str, str]]:
    """一覧ページから (URL, 質問, カテゴリ) を取り出す。カテゴリはページ上で直前にある見出し"""
    events: list[tuple[int, str, tuple[str, ...]]] = []
    for m in re.finditer(r'class="epkb-cat-name[^"]*"[^>]*>([^<]+)<', page):
        events.append((m.start(), "category", (html.unescape(m.group(1).strip()),)))
    for m in re.finditer(
        r'<a href="(https://support\.terravie\.co\.jp/faq/[^"]+)"[^>]*class="epkb-mp-article".*?'
        r'eckb-article-title__text"\s*>([^<]+)<',
        page,
        re.S,
    ):
        events.append((m.start(), "article", (m.group(1), html.unescape(m.group(2).strip()))))

    entries: dict[str, tuple[str, str, str]] = {}
    category = ""
    for _, kind, values in sorted(events):
        if kind == "category":
            category = values[0]
        elif values[0] not in entries:
            entries[values[0]] = (values[0], values[1], category)
    return list(entries.values())


def _parse_answer(page: str) -> str:
    m = re.search(r'<div id="eckb-article-content-body">(.*?)<div id="eckb-article-content-footer">', page, re.S)
    return _html_to_text(m.group(1)) if m else ""


def refresh_faq(db: Session) -> int:
    """FAQ を取り込み直す。取り込んだ件数を返す（失敗した場合は保存済みの内容を残す）"""
    with _refresh_lock:
        items = _parse_index(_get(FAQ_INDEX_URL))
        if not items:
            raise RuntimeError("FAQ の一覧を読み取れませんでした（ページの構成が変わった可能性があります）")

        existing = {e.url: e for e in db.scalars(select(FaqEntryModel))}
        seen = set()
        for url, question, category in items:
            time.sleep(REQUEST_INTERVAL_SECONDS)
            try:
                answer = _parse_answer(_get(url))
            except Exception:
                logger.warning("FAQ の取得に失敗しました: %s", urllib.parse.unquote(url))
                if url in existing:
                    seen.add(url)
                continue
            entry = existing.get(url) or FaqEntryModel(url=url)
            entry.question = question[:300]
            entry.category = category[:100]
            entry.answer = answer
            entry.fetched_at = func.now()
            db.add(entry)
            seen.add(url)

        # サイトから消えた質問は削除する
        for url, entry in existing.items():
            if url not in seen:
                db.delete(entry)
        db.commit()
        logger.info("FAQ を %d 件取り込みました", len(seen))
        return len(seen)


def refresh_if_stale() -> None:
    """未取得、または前回の取得から1日以上たっていれば取り込む（起動時に別スレッドで呼ぶ）"""
    try:
        with SessionLocal() as db:
            latest = db.scalar(select(func.max(FaqEntryModel.fetched_at)))
            if latest is None or datetime.now() - latest > REFRESH_AFTER:
                refresh_faq(db)
    except Exception:
        logger.exception("FAQ の取り込みに失敗しました")


def start_initial_refresh() -> None:
    threading.Thread(target=refresh_if_stale, daemon=True).start()


# ---------- 検索・AI 用 ----------


def all_entries(db: Session) -> list[FaqEntryModel]:
    return list(db.scalars(select(FaqEntryModel).order_by(FaqEntryModel.id)))


def entries_for_prompt(entries: list[FaqEntryModel]) -> str:
    """AI に渡す FAQ の一覧（番号で参照させる）"""
    blocks = []
    for e in entries:
        blocks.append(f"[FAQ{e.id}]（{e.category}）Q: {e.question}\nA: {e.answer}")
    return "\n\n".join(blocks)


def _bigrams(text: str) -> set[str]:
    text = re.sub(r"[\s、。？！?!「」（）()・/／]+", "", unicodedata.normalize("NFKC", text).lower())
    return {text[i : i + 2] for i in range(len(text) - 1)}


def scored_search(entries: list[FaqEntryModel], text: str) -> list[tuple[float, FaqEntryModel]]:
    """文字の2文字組（バイグラム）で FAQ との近さを 0〜1 で採点する（AI が使えない場合用）

    どの FAQ にも出てくる語（「チケット」など）より、少数の FAQ にしか出てこない語（「入園日」「変更」など）を
    重く数える（IDF による重み付け）。質問文との一致を重視し、回答文との一致も加味する。
    """
    query = _bigrams(text)
    if not query or not entries:
        return []
    docs = [(e, _bigrams(e.question), _bigrams(e.answer)) for e in entries]
    n = len(docs)
    df: dict[str, int] = {}
    for _, q, a in docs:
        for b in q | a:
            df[b] = df.get(b, 0) + 1
    idf = {b: math.log((n + 1) / (df.get(b, 0) + 1)) + 0.1 for b in query}
    total = sum(idf.values())

    scored = []
    for e, q, a in docs:
        score = (0.7 * sum(idf[b] for b in query & q) + 0.3 * sum(idf[b] for b in query & a)) / total
        scored.append((score, e))
    scored.sort(key=lambda s: s[0], reverse=True)
    return scored


def search(entries: list[FaqEntryModel], text: str, limit: int = 1, threshold: float = 0.22) -> list[FaqEntryModel]:
    """近い FAQ を返す（一定以上の近さのものだけ）"""
    return [e for score, e in scored_search(entries, text)[:limit] if score >= threshold]


def quote(entry: FaqEntryModel) -> str:
    """回答に載せる引用文"""
    return f"よくある質問より引用：「{entry.question}」\n{entry.answer}\n（出典：{urllib.parse.unquote(entry.url)}）"
