# cardページ（図鑑＋所持率チェッカー統合）JS構成 README

このページのJSは「共通JS（common/ui/features）」＋ **cardページ専用ローダー1本**で成立します。
cardページ専用は `js/pages/card/` 配下に集約し、依存順は **card-page-loader.js が唯一の正**です。

---

## 0) 公式ルール（最重要）

### ✅ 読み込み順（依存順）
`card-page-loader.js` が `js/pages/card/` のファイルを **順番に**読み込みます（async=false / onloadで直列）。

読み込み順ルール：
1) 一覧（card-list）
2) 表示切替（cardsViewMode）
3) checker（owned-ops → page wiring → render）

### ✅ “準備完了”合図
最後まで読み終わったら `window` に **`card-page:ready`** を dispatch。
→ 「後から読み込まれたJSでも拾える」合図として使う。

---

## 1) 各ファイルの役割（1行ずつ）

- `card-page-loader.js`：cardページ専用JSを **依存順で直列ロード**し、最後に `card-page:ready` を投げる。
- `card-list.js`：図鑑（カード一覧）の **生成・表示・フィルター適用の土台**。（※一覧の「主」）
- `cardsViewMode.js`：**グリッド⇔リスト表示切替**（detail-bank退避などを含む）。
- `card-checker-owned-ops.js`：所持率チェッカー用の **所持数の増減ロジック**（上限/循環など）。
- `card-checker-page.js`：所持率チェッカーの **ページ配線**（onclickから呼ばれる関数をwindow公開、packsフォールバック読み込み等）。
- `card-checker-render.js`：所持率チェッカーの **DOM生成の本体**（#packs-root、足りないカード、パック/種族一括操作など）。

> 旧：`card-checker.js` は「まとめ役」だったものの残骸（移植中の互換/退避用途）。今後は上の分割群が正。

---

## 2) 依存関係（ざっくり）

### checker（所持率）側の依存（重要）
`card-checker-render.js` は以下に依存します：
- `common/defs.js`（RACE_ORDER_all 等）
- `common/card-core.js`（pack名処理等）
- `common/owned.js`（OwnedStore / OwnedUI）
- `common/summary.js`（updateSummary / calcSummary）
- `pages/card/card-checker-owned-ops.js`（toggleOwnership 等）

### packs データ
`card-checker-page.js` は `window.packs` が未初期化なら `public/packs.json` をfetchして正規化します。

---

## 3) 初期化の考え方（DOM + ready の二段）

「HTML直読み込み」「ローダー直列ロード」「後読み込み」など状況差を吸収するため、
**DOMContentLoaded と card-page:ready の両方で初期化**するのが公式パターンです。

例：checkerページ配線の初期化（summary更新だけ軽く）
`DOMContentLoaded` と `card-page:ready` の両方で init を呼ぶ。

---

## 4) “ここを直す時はこのファイル”早見表

- **一覧が出ない / 並び順がおかしい / フィルター反映** → `card-list.js`
- **グリッド⇔リスト切替で崩れる / 詳細が出ない** → `cardsViewMode.js`
- **所持数の上限・循環（0→max→0）/ 旧神1枚・通常3枚** → `card-checker-owned-ops.js`
- **保存ボタン・モバイルpack選択・packs読み込み** → `card-checker-page.js`
- **パック/種族ごとのカードDOM生成・不足カードモーダル・一括操作** → `card-checker-render.js`
- **「保存が必要」状態/保存フロー（dirty管理など）** → `owned-save-flow.js`

---

## 5) 次チャットで送る“最小セット”ルール

基本はこれだけ：
- ✅ `js/pages/card/card-page-loader.js`
- ✅ **問題が起きているファイル1つ**（上の早見表から当たりを選ぶ）

（common側の問題っぽい時だけ、該当commonファイルを追加）

---

## 6) よくある事故メモ

- **読み込み順をHTML側でいじらない**：cardページ専用の順序は loader が唯一の正。
- **初期化が片方イベントだけ**だと、状況によって動いたり動かなかったりする
  → DOMContentLoaded + card-page:ready の二段に寄せる（checker-pageが手本）。
