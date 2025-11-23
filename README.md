# ごはんマッチング API (MVP)

コミュニティ内で「お互いに YES を出したユーザーだけがマッチする」仕組みを最小限の構成で実装したバックエンドです。Next.js フロントエンドから叩くことを想定しています。

## 技術スタック

- Node.js + TypeScript
- Express 4
- Prisma ORM + PostgreSQL
- JWT 認証 (メール + パスワード)
- Docker Compose で API / DB を同時に起動

## ディレクトリ構成

```
backend/
  src/              # Express + Prisma の実装
  prisma/           # Prisma schema, seed, migrations
  Dockerfile        # API 用コンテナ
  .env.example      # 必要な環境変数
  package.json

docs/schema.sql     # PostgreSQL DDL (参照用)
docker-compose.yml  # api + db をまとめて起動
```

## 環境変数

`backend/.env.example` をコピーして `.env` を作成してください。

### 環境ごとの .env 読み込み

- ローカル開発では `backend/.env` を利用します。Docker Compose もこのファイルを参照し、`DATABASE_URL` を `postgresql://postgres:postgres@db:5432/gohan?schema=public` に上書きします。
- Railway やその他の本番デプロイでは `NODE_ENV=production`（または `RAILWAY_*` 環境変数が存在する）状態で `backend/.env.production` が自動的に読み込まれます。ここに本番 DB（例: Supabase や Railway Postgres）の `DATABASE_URL` / `DIRECT_URL` を記述してください。
- どちらのファイルにも書かれていない値は、デプロイ先の環境変数に直接設定すれば上書きできます。

| 変数 | 説明 |
| ---- | ---- |
| `DATABASE_URL` | PostgreSQL への接続文字列。docker-compose を使う場合は `postgresql://postgres:postgres@db:5432/gohan?schema=public` |
| `PORT` | API ポート。デフォルト `3001` |
| `JWT_SECRET` | JWT 署名シークレット |
| `DEFAULT_COMMUNITY_NAME` | デフォルトコミュニティ名（例: `KING`） |
| `DEFAULT_COMMUNITY_CODE` | 8 桁コミュニティコード（例: `KINGCODE`） |
| `SEED_ADMIN_EMAIL` | `prisma/seed.ts` で作る管理者のメール (任意) |
| `SEED_ADMIN_PASSWORD` | 同上 |
| `NEXT_PUBLIC_API_BASE_URL` | CORS を許可するフロントエンドの URL (例: `http://localhost:3000`) |
| `NEXT_PUBLIC_DEV_APPROVE_ENDPOINT` | フロントエンドから開発用承認 API を叩く際の URL |
| `AUTO_APPROVE_MEMBERS` | `true` で参加申請を即時承認。`false` で手動承認フロー |
| `USE_SEED_MEMBERS` | `false` でシードユーザー作成と候補表示を無効化（実ユーザーのみで検証したい場合に利用） |

## 初期セットアップ / 起動手順

1. 依存関係をインストール（ローカルで実行する場合）
   ```bash
   cd backend
   npm install
   ```
2. 環境変数を設定
   ```bash
   cp backend/.env.example backend/.env
   # 値を編集
   ```
3. Docker で API + DB を起動
   ```bash
   docker-compose up --build
   ```
   - 初回は `docker compose exec api npx prisma migrate deploy` を実行してテーブルを作成。
   - 任意で `docker compose exec api npm run prisma:seed` を流すと管理者アカウントが作成されます。
4. フロントエンド (別リポジトリ) を起動: `npm run dev`。API のベース URL は `http://localhost:3001`。

## Prisma / DB メモ

- Prisma スキーマ: `backend/prisma/schema.prisma`
- マイグレーション: `backend/prisma/migrations/`
- SQL で確認したい場合は `docs/schema.sql` を参照。

## 提供 API

| メソッド | パス | 用途 |
| -------- | ---- | ---- |
| `POST /api/auth/register` | ユーザー登録 `{ name, email, password }` → `{ token, user }` |
| `POST /api/auth/login` | ログイン `{ email, password }` → `{ token, user }` |
| `GET /api/auth/me` | `{ id, name, email, isAdmin, communityStatus, profile }` |
| `POST /api/community/join` | `{ communityCode }` を受け取り `PENDING` に遷移 |
| `GET /api/community/status` | `{ status: 'UNAPPLIED'|'PENDING'|'APPROVED', communityName }` |
| `GET /api/admin/join-requests` | (管理者) 承認待ち `{ id, name, email, requestedAt }[]` |
| `POST /api/admin/join-requests/:id/approve` | (管理者) `{ id, status: 'APPROVED' }` |
| `POST /api/admin/join-requests/:id/reject` | (管理者) `{ id, status: 'REJECTED' }` |
| `GET /api/profile` | プロフィール `{ name, bio }` |
| `PUT /api/profile` | プロフィール更新 |
| `GET /api/members` | 承認済みメンバー `[{ id, name, bio, isSelf }]` |
| `GET /api/like/next-candidate` | 未評価の候補 `{ candidate: { id, name, bio } | null }` |
| `POST /api/like` | `{ matched: boolean, matchedAt?: string }` |
| `GET /api/matches` | `[{ id, partnerName, partnerBio, matchedAt }]` |
| `POST /api/dev/approve-me` | (開発のみ) 自分の membership を強制的に `APPROVED` |
| `POST /api/dev/reset-status` | (開発のみ) 自分の membership を削除し `UNAPPLIED` に戻す |
| `POST /api/dev/reset-like-state` | (開発のみ) 自分が送った/受けた likes と matches を削除して初期状態に戻す |

### 認可ロジックについて

- `authMiddleware` が Bearer JWT を検証し、`req.user` に `userId` / `isAdmin` を注入。
- コミュニティ関連のリスト系エンドポイントは `approved` でない場合も 200 で空配列 / `candidate: null` を返し、フロント側で UI 切り替えがしやすいようにしています。
- 管理者エンドポイントは `users.is_admin` をチェックし、承認可否操作のみ権限を付与します。
- `NODE_ENV !== 'production'` のときだけ `/api/dev/*` ルートをマウントし、本番では利用できないようガードしています。
- `AUTO_APPROVE_MEMBERS=true` の場合は、ログイン/プロフィール参照時点で membership が自動生成され、`/api/like` で 400 にならないようサーバー側でも補正を行っています。

## likes 登録時の両想い判定

`backend/src/routes/likes.ts` の `POST /api/like` で実装しています。YES の場合は次の処理を行います:
1. `likes` に回答を INSERT。
2. 逆方向 (相手 -> 自分) の YES が存在するかをトランザクション内で検索。
3. 見つかったらユーザー ID をソートし、`matches` に `upsert` して重複を防止。
4. レスポンスで `{ matched: true }` を返却。

## 開発フロー例

1. `/api/auth/register` でユーザー登録。
2. `/api/auth/login` でトークン取得 → `Authorization: Bearer <token>` を付与。
3. `/api/community/join` に 8 桁コードを渡して参加申請。
4. 管理者が `/api/admin/join-requests` → `/approve` で承認。
5. `/api/profile` でプロフィールを更新。
6. `/api/members` でメンバーを確認し、`/api/like` & `/api/like/next-candidate` で投票。
7. 両想いになると `/api/like` のレスポンスで `{ matched: true, matchedAt }`、`/api/matches` に相手が出現。

## 補足

- Prisma Client の生成やマイグレーションは `npm run prisma:generate` / `npm run prisma:migrate` で行えます。
- テストデータ投入は `npm run prisma:seed` を使うか、`docs/schema.sql` を psql で流してください。
