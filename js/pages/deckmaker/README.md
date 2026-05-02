# deckmakerページ JS構成 README

------------------------------------------------------------------------

## 概要

このページのJSは「共通JS（common / ui / features）」＋
deckmaker専用9ファイル構成で成立します。\
責務を明確に分離し、キャンペーン機能は1ファイルに完全集約します。

------------------------------------------------------------------------

## 0) 設計ルール（最重要）

### ① ファイル総数は9以内

-   page2.js は完全廃止\
-   機能は分離するが、ファイルは増やさない

### ② キャンペーンは1ファイルに閉じ込める

-   分散させない\
-   deckmaker-post.js に混ぜない\
-   deckmaker-campaign.js に完全集約

### ③ entryは起動ハブのみ

-   実ロジックを持たない\
-   各モジュールの init() を呼ぶだけ

------------------------------------------------------------------------

## 1) 最終ファイル構成（推奨）

js/pages/deckmaker/

-   deckmaker-loader.js ...... 専用ローダー（唯一の正）
-   deckmaker-entry.js ...... 起動ハブ
-   deckmaker-tabs.js ...... タブ制御
-   deckmaker-deck.js ...... デッキ状態管理
-   deckmaker-ui.js ...... UI補助（deck-info + card-display 統合）
-   deckmaker-filter.js ...... フィルター・タグ同期
-   deckmaker-post.js ...... 投稿本体（submit / validation）
-   deckmaker-campaign.js ...... キャンペーン専用
-   （予備枠）...... 将来拡張用

------------------------------------------------------------------------

## 2) 各ファイルの役割

### deckmaker-loader.js

-   deckmaker専用JSを依存順で直列ロード\
-   最後に deckmaker:ready を dispatch

### deckmaker-entry.js

-   ページ初期化ハブ\
-   initDeckmakerPage() を持つ\
-   他モジュールの init() を呼ぶだけ

### deckmaker-tabs.js

-   タブ表示切替\
-   投稿タブ表示時の再描画トリガー

### deckmaker-deck.js

-   デッキ状態管理\
-   枚数制限（通常3枚 / 旧神1枚）\
-   メイン種族制限\
-   addCard / removeCard / updateDeck

### deckmaker-ui.js

-   deck-info.js + card-display.js を統合\
-   デッキ統計表示\
-   カード詳細モーダル\
-   UI補助処理

### deckmaker-filter.js

-   カード一覧フィルター\
-   タグ選択ロジック\
-   readSelectedTags / writeSelectedTags\
-   キャンペーンタグ同期

### deckmaker-post.js

-   投稿フォーム制御\
-   バリデーション\
-   payload生成\
-   submitDeckPost呼び出し\
-   成功／失敗UI制御\
-   キャンペーン参加フラグ受け取り

### deckmaker-campaign.js（最重要）

キャンペーン関連はすべてここに集約します。

#### 含む機能

-   ミニ告知描画\
-   投稿上部バナー描画\
-   キャンペーンタグトグル\
-   条件チェックUI更新\
-   参加確認モーダル\
-   Xハンドル正規化\
-   投稿前フック

#### 公開API

window.DeckmakerCampaign.init()

他ファイルから呼ぶのはこの1行のみ。

------------------------------------------------------------------------

## 3) 初期化フロー

### 起動順

1.  deckmaker-loader.js\
2.  deckmaker-entry.js

entry内で以下を実行する：

-   initDeck()\
-   initFilter()\
-   initPost()\
-   window.DeckmakerCampaign?.init?.()

------------------------------------------------------------------------

## 4) 責務分離ルール

### ❌ やらないこと

-   キャンペーンロジックを deckmaker-post.js / deckmaker-filter.js に分散しない\
-   entry.js に実処理を書かない\
-   タグ管理とキャンペーン判定を混在させない

### ✅ 守ること

-   キャンペーンは deckmaker-campaign.js のみ\
-   deckmaker-post.js は投稿制御のみ\
-   deckmaker-filter.js はタグ管理のみ\
-   UI補助は deckmaker-ui.js のみ

------------------------------------------------------------------------

## 5) 変更時の早見表

-   デッキ枚数制限がおかしい → deckmaker-deck.js\
-   フィルターが効かない → deckmaker-filter.js\
-   投稿できない → deckmaker-post.js\
-   キャンペーン表示がおかしい → deckmaker-campaign.js\
-   投稿前モーダルが出ない → deckmaker-campaign.js\
-   デッキ統計表示がおかしい → deckmaker-ui.js\
-   起動順で動かない → deckmaker-loader.js

------------------------------------------------------------------------

## 6) なぜこの構成が最適か

### ① キャンペーンが1ファイルに閉じる

-   追いやすい\
-   削除しやすい\
-   拡張しやすい

### ② deckmaker-post.jsが肥大しない

-   投稿制御に集中できる

### ③ 将来キャンペーン終了時も簡単

-   deckmaker-campaign.js を外すだけで完結

------------------------------------------------------------------------

## 7) 将来拡張

-   所持率キャンペーン\
-   期間限定タグ\
-   条件別ボーナス\
-   レート連動イベント

すべて deckmaker-campaign.js に追加する。

------------------------------------------------------------------------

## まとめ

キャンペーンは1ファイルに集約する。\
分散させない。\
それが最も分かりやすく、安全で、拡張性のある構成。
