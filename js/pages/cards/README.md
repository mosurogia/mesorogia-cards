# cardsページ README

cardsページ専用のJSは `js/pages/cards/` 配下に集約します。  
読み込み順の基点は `cards-page-loader.js` です。

## ファイル構成

- `cards-page-loader.js`
- `cards-list.js`
- `cards-view-mode.js`
- `cards-groups-ui.js`
- `cards-groups-drawer-sp.js`
- `cards-checker-owned-ops.js`
- `cards-checker-render.js`
- `cards-checker-page.js`

## 読み込み順

`cards-page-loader.js` が `js/pages/cards/` 配下のファイルを依存順で直列読み込みします。  
読み込み完了後に `card-page:ready` を `window` へ dispatch します。

基本読み込み順:

1. `cards-list.js`
2. `cards-view-mode.js`
3. `cards-groups-ui.js`
4. `cards-groups-drawer-sp.js`

checker系の追加読み込み:

1. `cards-checker-owned-ops.js`
2. `cards-checker-render.js`
3. `cards-checker-page.js`

## 役割

- `cards-page-loader.js`: cardsページ専用JSの読み込み起点
- `cards-list.js`: カード一覧の表示と操作
- `cards-view-mode.js`: 表示モード切替
- `cards-groups-ui.js`: カードグループUI
- `cards-groups-drawer-sp.js`: スマホ用グループドロワー
- `cards-checker-owned-ops.js`: 所持数操作
- `cards-checker-render.js`: checker描画
- `cards-checker-page.js`: checkerページ初期化

## ルール

- HTML から直接個別ファイルを読まない
- `cards-page-loader.js` を唯一の読み込み口にする
- 依存が増えたら loader の順序で吸収する
