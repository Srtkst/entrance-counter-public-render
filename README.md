# 入場者カウント 公開版（GitHub + Render + PostgreSQL）

この版はローカルLAN専用ではありません。
Renderへデプロイすると、インターネットから公開URLへアクセスできます。

## 構成

- GitHub: ソースコード管理
- Render Web Service: Node.jsアプリの公開
- PostgreSQL: 日付別のカウント履歴を永続保存

GitHub Pagesは使用しません。
`server.js` とAPIが必要なため、RenderのWeb ServiceからHTML/CSS/JSもまとめて配信します。

## 機能

- 受付Aと受付Bは独立
- 受付A/Bでは自分の人数のみ表示・操作
- 本部ではA+Bの合計を表示
- 本部では変更不可
- 分類別人数
- 日付別保存
- 今日のみ編集可能
- 過去の日付は閲覧専用
- 過去記録一覧
- 本部画面は約3秒ごとに最新値へ更新
- PostgreSQL保存なのでWebサービス再起動後も履歴が残る

## ローカルでの準備

```bash
npm install
```

PostgreSQLを用意して環境変数を設定:

```text
DATABASE_URL=postgresql://...
```

その後:

```bash
npm start
```

## GitHubへアップロード

新しいGitHubリポジトリを作り、このフォルダの内容をpushします。

例:

```bash
git init
git add .
git commit -m "Initial public entrance counter"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

## Renderで公開

### 1. PostgreSQLを作成

Render DashboardでPostgreSQLデータベースを作成します。

### 2. Web Serviceを作成

GitHubのリポジトリを接続してWeb Serviceを作成します。

設定:

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

### 3. DATABASE_URLを設定

Web ServiceのEnvironmentに:

```text
DATABASE_URL
```

を登録します。

Render Postgresを同じRender環境で作った場合は、その接続情報を利用してください。

さらに:

```text
NODE_ENV=production
```

を設定します。

### 4. デプロイ

Deployが成功すると:

```text
https://あなたのサービス名.onrender.com/
```

のような公開URLが発行されます。

受付A・受付B・本部の各端末は、この同じURLへアクセスします。
端末ごとに受付選択がlocalStorageへ保存されます。

## 重要: 公開URLの権限

現時点の版はURLへアクセスできる人なら受付A/Bを選択して変更できます。

学園祭の実運用では次の追加を推奨します:

- 受付A用PIN
- 受付B用PIN
- 本部用PINまたは閲覧専用URL
- 誤操作ログ

これらは次の段階で追加できます。
