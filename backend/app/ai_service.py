"""AI処理（不足情報チェック・一次回答・要約）

ANTHROPIC_API_KEY が設定されていれば Claude API で判定し、
未設定・API エラー時はキーワードによる簡易判定（ルールベース）にフォールバックする。
"""

import logging
import os
import unicodedata

import anthropic
from pydantic import BaseModel

import faq
import park_cases
from models import FaqEntryModel, RequiredFieldModel
from schemas import AICheckResult

logger = logging.getLogger(__name__)

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-5")

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic | None:
    """APIキーが設定されている場合のみクライアントを返す"""
    global _client
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    if _client is None:
        _client = anthropic.Anthropic(timeout=60.0, max_retries=2)
    return _client


def _call_claude[T: BaseModel](system: str, user: str, output_format: type[T]) -> T | None:
    """Claude に構造化出力で問い合わせる。失敗時は None を返す"""
    client = _get_client()
    if client is None:
        return None
    try:
        response = client.messages.parse(
            model=ANTHROPIC_MODEL,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=output_format,
            # 安全分類器で拒否された場合にサーバー側で別モデルへ自動フォールバックする
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            extra_body={"fallbacks": "default"},
        )
    except anthropic.APIConnectionError:
        logger.exception("Claude API に接続できませんでした")
        return None
    except anthropic.APIStatusError as e:
        logger.error("Claude API エラー: status=%s message=%s", e.status_code, e.message)
        return None

    if response.stop_reason == "refusal":
        logger.warning("Claude が応答を拒否しました: %s", response.stop_details)
        return None
    return response.parsed_output


# ---------- 不足情報チェック・一次回答 ----------


class _CheckOutput(BaseModel):
    missing_fields: list[str]
    questions: list[str]
    probable_cause: str
    action_required: bool
    draft_answer: str
    faq_ids: list[int]


FAQ_INSTRUCTION = """
# よくある質問（FAQ）
下に、お客様向けサポートサイトの「よくある質問」を載せる。問い合わせ内容に該当する FAQ があれば、
その内容を踏まえて回答し、該当した FAQ の番号（[FAQ12] なら 12）を faq_ids に入れる（最大2件）。
FAQ の本文と出典URLはシステムが回答の末尾に正確に引用するので、回答の中で FAQ を丸写しする必要はない。
該当しない場合は faq_ids を空配列にし、FAQ に書かれていないことを FAQ に書いてあるかのように言わない。

"""


def _with_faq(system: str, entries: list[FaqEntryModel]) -> str:
    return system + FAQ_INSTRUCTION + faq.entries_for_prompt(entries) if entries else system


def _append_quotes(text: str, entries: list[FaqEntryModel]) -> str:
    """回答の末尾に FAQ の引用（本文と出典URL）を付ける"""
    if not entries:
        return text
    return text.rstrip() + "\n\n" + "\n\n".join(faq.quote(e) for e in entries)


def _pick_entries(ids: list[int], entries: list[FaqEntryModel], limit: int = 2) -> list[FaqEntryModel]:
    """AI が返した番号のうち、実在する FAQ だけを取り出す"""
    by_id = {e.id: e for e in entries}
    picked = [by_id[i] for i in dict.fromkeys(ids) if i in by_id]
    return picked[:limit]


CHECK_SYSTEM_PROMPT = f"""\
あなたはテーマパークの社内サポートチームのアシスタントです。
入園ゲート・特設ブース・チケット窓口などで働く現場スタッフから、
お客様のチケット（入園券・ツアー・年間パスなど）やWeb/アプリに関する問い合わせが届きます。
問い合わせを読み、次の2つを行います。

1. サポートチームが定義した「必須項目」が問い合わせに書かれているか照合する。
   - 曖昧な記載（例:「さっき」「なんか動かない」「ゲートで」だけ）は記載なしとみなす。
   - 不足している項目名を missing_fields に、必須項目の名前そのままで入れる。
   - 不足がある場合は、現場スタッフに追加で確認したい質問を questions に入れる。
     質問は丁寧語で、接客中の職員がすぐ答えられるよう具体的に書く（1項目につき1問程度）。
2. 不足がない場合のみ、一次回答を作る。
   - probable_cause: 想定される原因（仕様通りの挙動と考えられる場合はそう明記する）
   - action_required: サポートチーム・システム側での対応が必要なら true、仕様通り・お客様への操作案内で済むなら false
   - draft_answer: 現場スタッフへ送る一次回答の文面（丁寧語、300字程度まで）。
     職員がその場でお客様に案内できる手順を先に書く。

原因を考えるときは、次の「よくある事例」を参考にする（当てはまらない場合は無理に当てはめない）。
{park_cases.cases_for_prompt()}

不足がある場合は probable_cause と draft_answer を空文字、action_required を false にする。
不足がない場合は missing_fields と questions を空配列にする。
"""


def _format_required_fields(fields: list[RequiredFieldModel]) -> str:
    return "\n".join(f"- {f.name}: {f.description}" for f in fields)


def check_inquiry(
    title: str, body: str, fields: list[RequiredFieldModel], faq_entries: list[FaqEntryModel] | None = None
) -> AICheckResult:
    """問い合わせ内容と必須項目を照合し、不足項目の質問 or 一次回答を返す（該当する FAQ があれば回答に引用する）"""
    faq_entries = faq_entries or []
    user_prompt = (
        f"# 必須項目\n{_format_required_fields(fields)}\n\n"
        f"# 問い合わせ\n件名: {title}\n\n本文:\n{body}"
    )
    output = _call_claude(_with_faq(CHECK_SYSTEM_PROMPT, faq_entries), user_prompt, _CheckOutput)
    if output is None:
        return _check_by_rule(title, body, fields, faq_entries)

    # AIが必須項目にない名前を返した場合に備えて、定義済みの項目名だけに絞る
    field_names = {f.name for f in fields}
    missing = [name for name in output.missing_fields if name in field_names]
    if missing:
        return AICheckResult(
            is_complete=False,
            missing_fields=missing,
            questions=output.questions,
            engine="claude",
        )
    return AICheckResult(
        is_complete=True,
        missing_fields=[],
        questions=[],
        probable_cause=output.probable_cause,
        action_required=output.action_required,
        draft_answer=_append_quotes(output.draft_answer, _pick_entries(output.faq_ids, faq_entries)),
        engine="claude",
    )


def normalize(text: str) -> str:
    """全角・半角、大文字・小文字の揺れを吸収する"""
    return unicodedata.normalize("NFKC", text).lower()


def _check_by_rule(
    title: str, body: str, fields: list[RequiredFieldModel], faq_entries: list[FaqEntryModel]
) -> AICheckResult:
    """キーワードによる簡易判定（AIが使えない場合のフォールバック）"""
    text = normalize(f"{title}\n{body}")
    faq_hits = faq.search(faq_entries, f"{title}\n{body}")
    missing: list[RequiredFieldModel] = []
    for field in fields:
        keywords = [normalize(k.strip()) for k in field.keywords.split(",") if k.strip()]
        if not keywords:
            keywords = [normalize(field.name)]
        if not any(k in text for k in keywords):
            missing.append(field)

    if missing:
        return AICheckResult(
            is_complete=False,
            missing_fields=[f.name for f in missing],
            questions=[
                f"「{f.name}」を教えてください。" + (f"（{f.description}）" if f.description else "")
                for f in missing
            ],
            engine="rule",
        )
    # よくある事例に当てはまれば、その原因パターンと案内文を一次回答にする
    case = park_cases.find_case(text)
    if case is not None:
        causes = "\n".join(f"・{c}" for c in case.probable_causes)
        return AICheckResult(
            is_complete=True,
            missing_fields=[],
            questions=[],
            probable_cause=f"よくある事例「{case.name}」に該当する可能性があります。考えられる原因:\n{causes}",
            action_required=case.action_required,
            draft_answer=_append_quotes(f"お問い合わせありがとうございます。\n{case.guidance}", faq_hits),
            engine="rule",
        )
    return AICheckResult(
        is_complete=True,
        missing_fields=[],
        questions=[],
        probable_cause="よくある事例に該当しませんでした。過去の類似問い合わせを検索して確認してください。",
        action_required=None,
        draft_answer=_append_quotes(
            "お問い合わせありがとうございます。\n"
            "必要な情報をご提供いただきありがとうございました。内容を確認のうえ、改めてご連絡いたします。",
            faq_hits,
        ),
        engine="rule",
    )


# ---------- 来場者対応チャット ----------


class _ChatOutput(BaseModel):
    answer: str
    can_resolve: bool
    suggested_title: str
    faq_ids: list[int]


CHAT_SYSTEM_PROMPT = f"""\
あなたはテーマパークの社内サポートAIです。
入園ゲート・特設ブース・チケット窓口などで来場者に対応中の現場スタッフから、チャットで質問が届きます。
職員は目の前のお客様を待たせているので、すぐ使える回答を返してください。
職員がエラー画面やチケット画面の写真を貼付することがあります。写真に写っている
エラーメッセージ・表示内容・チケットの種類などを読み取り、回答に活かしてください。

回答のルール:
- answer: 職員がその場でお客様に案内できる手順を、短い箇条書き中心で書く（300字程度まで）。
  確認に必要な情報（予約番号、チケット種別など）が足りなければ、何を確認すればよいか聞き返す。
- can_resolve: 職員の案内だけで解決できる見込みなら true。
  決済状況・登録状況の確認、返金、システム障害の疑いなど、サポートチームやシステム側の確認が必要なら false。
  false の場合は answer の最後に「サポートチームへの送信をおすすめします」と書く。
- suggested_title: サポートチームへ送る場合の件名（30字以内）

よくある事例:
{park_cases.cases_for_prompt()}
"""


def _to_claude_message(message: dict) -> dict:
    """チャットのメッセージを Claude API の形式にする（写真は画像ブロックとして本文の前に置く）"""
    images = message.get("images") or []
    if not images:
        return {"role": message["role"], "content": message["content"]}
    blocks: list[dict] = [
        {"type": "image", "source": {"type": "base64", "media_type": img["media_type"], "data": img["data"]}}
        for img in images
    ]
    blocks.append({"type": "text", "text": message["content"].strip() or "（写真を送信しました）"})
    return {"role": message["role"], "content": blocks}


def _chat_result(answer: str, can_resolve: bool, title: str, refs: list[FaqEntryModel], engine: str) -> dict:
    return {
        "answer": _append_quotes(answer, refs),
        "can_resolve": can_resolve,
        "suggested_title": title,
        "faq_refs": [{"question": e.question, "url": e.url} for e in refs],
        "engine": engine,
    }


def chat(messages: list[dict], resolved_examples: list[str], faq_entries: list[FaqEntryModel] | None = None) -> dict:
    """来場者対応中の現場スタッフからの質問に答える（該当する FAQ があれば回答に引用する）

    messages の各要素: {"role", "content", "images": [{"media_type", "data"(Base64)}]}
    """
    faq_entries = faq_entries or []
    system = CHAT_SYSTEM_PROMPT
    if resolved_examples:
        system += "\n過去に解決した問い合わせ（参考）:\n" + "\n".join(f"- {e}" for e in resolved_examples)
    system = _with_faq(system, faq_entries)

    client = _get_client()
    if client is not None:
        try:
            response = client.messages.parse(
                model=ANTHROPIC_MODEL,
                max_tokens=16000,
                system=system,
                messages=[_to_claude_message(m) for m in messages],
                output_format=_ChatOutput,
                extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
                extra_body={"fallbacks": "default"},
            )
            output = response.parsed_output
            if response.stop_reason != "refusal" and output is not None:
                refs = _pick_entries(output.faq_ids, faq_entries)
                return _chat_result(output.answer, output.can_resolve, output.suggested_title, refs, "claude")
            logger.warning("Claude が応答を拒否しました: %s", response.stop_details)
        except anthropic.APIConnectionError:
            logger.exception("Claude API に接続できませんでした")
        except anthropic.APIStatusError as e:
            logger.error("Claude API エラー: status=%s message=%s", e.status_code, e.message)

    return _chat_by_rule(messages, faq_entries)


STRONG_FAQ_MATCH = 0.3


def _chat_by_rule(messages: list[dict], faq_entries: list[FaqEntryModel]) -> dict:
    """AIが使えない場合: よくある事例・FAQ のキーワード判定で答える"""
    raw_user_text = "\n".join(m["content"] for m in messages if m["role"] == "user")
    user_text = normalize(raw_user_text)
    first_line = next((m["content"] for m in messages if m["role"] == "user" and m["content"].strip()), "")
    first_line = first_line.strip().split("\n")[0] or "写真の確認依頼"
    has_images = any(m.get("images") for m in messages)
    case = park_cases.find_case(user_text)
    # 最新の質問を優先して FAQ を探す
    latest = next((m["content"] for m in reversed(messages) if m["role"] == "user" and m["content"].strip()), "")
    refs = faq.search(faq_entries, latest) or faq.search(faq_entries, raw_user_text)
    # FAQ の質問とよく一致する場合は、よくある事例より FAQ の回答を優先する
    best = faq.scored_search(faq_entries, latest)[:1]
    if best and best[0][0] >= STRONG_FAQ_MATCH:
        case = None

    if case is None and refs:
        return _chat_result("よくある質問に該当する内容がありました。", True, refs[0].question[:30], refs, "rule")
    if case is None:
        image_note = "（簡易判定では写真の内容を読み取れません）\n" if has_images else ""
        answer = (
            f"{image_note}よくある事例に当てはまらないため、この場で解決方法をご案内できません。\n"
            "サポートチームへの送信をおすすめします。"
        )
        return _chat_result(answer, False, first_line[:30], [], "rule")

    causes = "\n".join(f"・{c}" for c in case.probable_causes)
    answer = f"「{case.name}」の可能性があります。\n\n{case.guidance}\n\n考えられる原因:\n{causes}"
    if case.action_required:
        answer += "\n\nシステム側の確認が必要なため、サポートチームへの送信をおすすめします。"
    return _chat_result(answer, not case.action_required, case.name, refs, "rule")


# ---------- 要約 ----------


class _SummaryOutput(BaseModel):
    summary: str


SUMMARY_SYSTEM_PROMPT = """\
あなたはテーマパークの社内サポートチームのアシスタントです。
問い合わせとそのやり取りを、一覧画面で一目で内容が分かるよう日本語で要約してください。
「何が・どこで・どうなったか」と、現在の対応状況が分かるようにし、100字以内にまとめます。
"""


def summarize(title: str, body: str, comments: list[str]) -> str:
    """問い合わせ（＋やり取り）を要約する"""
    thread = "\n".join(f"- {c}" for c in comments) or "（なし）"
    user_prompt = f"件名: {title}\n\n本文:\n{body}\n\nやり取り:\n{thread}"
    output = _call_claude(SUMMARY_SYSTEM_PROMPT, user_prompt, _SummaryOutput)
    if output is not None:
        return output.summary

    # フォールバック: 本文の先頭を切り出す
    flat = " ".join(body.split())
    return flat if len(flat) <= 100 else flat[:100] + "…"
