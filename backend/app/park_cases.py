"""パークでよくある問い合わせ事例（想定原因のパターン）

AIの一次回答のヒントとして渡すほか、AIが使えない場合のキーワード判定にも使う。
実際の運用に合わせて、事例・原因・案内文をここで追加・修正する。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ParkCase:
    name: str
    # 問い合わせにこのどれかが含まれていれば、この事例に該当するとみなす（キーワード判定用）
    keywords: tuple[str, ...]
    probable_causes: tuple[str, ...]
    # サポートチーム・システム側の対応が必要になりやすいか
    action_required: bool
    # 現場スタッフへの一次回答の案内文
    guidance: str


PARK_CASES: tuple[ParkCase, ...] = (
    ParkCase(
        name="QRが読み取れない",
        keywords=("qr", "読み取", "読めない", "読まない", "スキャン", "かざ"),
        probable_causes=(
            "スマートフォンの画面が暗い・画面割れや保護フィルムの反射",
            "スクリーンショットの画質が粗い、または古いQRコードを表示している",
            "チケットの利用日・有効期限と来園日が合っていない",
            "すでに入園処理済み（使用済み）のQRコードを再度かざしている",
            "電波が弱くチケット画面のQRコードが最新の状態に更新されていない",
        ),
        action_required=False,
        guidance=(
            "画面の明るさを最大にし、保護フィルムの反射がない状態で再度かざしてください。"
            "それでも読み取れない場合は、予約番号で利用日・利用状況（使用済みか）を確認し、"
            "問題がなければ予約番号による手動処理で対応してください。"
        ),
    ),
    ParkCase(
        name="顔写真が登録できない",
        keywords=("顔写真", "顔認証", "写真登録", "写真が登録", "顔が", "撮影"),
        probable_causes=(
            "帽子・マスク・サングラスの着用や逆光で顔が認識されない",
            "アップロードした画像の形式・サイズが対応外（HEIC形式や大きすぎる画像など）",
            "アプリ・ブラウザにカメラの利用が許可されていない",
            "年間パスの登録期限を過ぎている、または別のパスにすでに登録済み",
        ),
        action_required=False,
        guidance=(
            "帽子・マスクを外し、明るい場所で正面から撮り直すようご案内ください。"
            "画像を選ぶ場合はJPEG形式の写真を使い、カメラの利用許可がオンになっているかも確認してください。"
            "登録済み・期限切れの表示が出る場合はサポートチームで登録状況を確認します。"
        ),
    ),
    ParkCase(
        name="決済が完了しない",
        keywords=("決済", "支払", "クレジット", "カード", "購入できない", "引き落"),
        probable_causes=(
            "カード会社の本人認証（3Dセキュア）が完了していない",
            "カードの利用限度額超過・有効期限切れ・対応外のカードブランド",
            "決済中の通信切断により、決済済みなのに画面上は未完了になっている（二重決済の恐れ）",
            "決済システム側の一時的な障害",
        ),
        action_required=True,
        guidance=(
            "二重決済を防ぐため、お客様に再購入を控えていただき、まず購入完了メールの有無をご確認ください。"
            "サポートチームで予約番号・注文番号から決済状況を確認のうえ、ご連絡します。"
        ),
    ),
    ParkCase(
        name="チケットが表示されない",
        keywords=("表示されない", "表示されません", "出てこない", "見つからない", "消えた", "チケットがない"),
        probable_causes=(
            "購入時とは別のアカウント（メールアドレス）でログインしている",
            "同行者へのチケット分配が完了していない",
            "購入完了メールが迷惑メールフォルダに振り分けられている",
            "アプリが古いバージョンのまま、または表示データが更新されていない",
        ),
        action_required=False,
        guidance=(
            "購入時のメールアドレスでログインしているか、購入完了メール（迷惑メールフォルダも含む）が届いているかをご確認ください。"
            "アプリの場合は最新版に更新して再起動してください。"
            "予約番号が分かれば、入園ゲートで予約番号による確認も可能です。"
        ),
    ),
    ParkCase(
        name="ログインできない",
        keywords=("ログイン", "パスワード", "サインイン", "アカウント"),
        probable_causes=(
            "メールアドレス・パスワードの入力誤り（全角・大文字小文字の違いなど）",
            "登録時とは別のメールアドレスで入力している",
            "ログイン失敗が続き、一時的にロックされている",
        ),
        action_required=False,
        guidance=(
            "パスワード再設定画面から再設定をお試しいただくようご案内ください。"
            "ロック中の表示が出る場合は、時間をおいてから再度お試しください。"
        ),
    ),
)


def cases_for_prompt() -> str:
    """AIへのプロンプトに埋め込む形式の事例一覧"""
    lines = []
    for case in PARK_CASES:
        causes = "／".join(case.probable_causes)
        need = "要対応になりやすい" if case.action_required else "操作案内で解決することが多い"
        lines.append(f"- {case.name}（{need}）: 主な原因 = {causes}")
    return "\n".join(lines)


def find_case(normalized_text: str) -> ParkCase | None:
    """本文（正規化済み）に最もよく当てはまる事例を返す"""
    best: ParkCase | None = None
    best_hits = 0
    for case in PARK_CASES:
        hits = sum(1 for k in case.keywords if k in normalized_text)
        if hits > best_hits:
            best, best_hits = case, hits
    return best
