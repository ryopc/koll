# Cloudflare リアルタイム電話アプリ 実装プラン

## 概要
Cloudflare Workers + Durable Objects + WebRTC を使用した、ブラウザベースの電話アプリ **Koll**（音声通話）を構築する。

## 仕様（2026-10-20）
- **音声のみ**（映像は将来拡張）
- **認証**: D1 データベースでユーザー管理（ユーザー名 + パスワード、bcrypt ハッシュ）
- **電話番号形式**: `pha-0000-0000` → `phb-0000-0000` → `phc-0000-0000` ... プレフィックスが循環（ユーザーごとに割り当て、サーバー管理）
- **発信**: 相手の電話番号を入力してコール（ルームID = 相手番号）
- **PWA対応**: インストール可能、オフライン対応、ホーム画面から起動、ネイティブアプリ風UI
- **配信**: Cloudflare Workers Assets で静的アセット配信（Service Worker 自動生成）
- **プッシュ通知**: Web Push API + VAPID、バックグラウンド着信対応
- **連絡先機能**: 電話番号検索/登録/表示、ローカル+サーバー同期
- **TURN サーバ**: Cloudflare Realtime TURN / 自前 coturn 対応、ICE 設定動的取得

---

## アーキテクチャ

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│  Browser A  │◄──────────────────►│  Durable Object  │
│  (Caller)   │   Signaling        │  (Call Room)     │
└─────────────┘                    └────────┬─────────┘
                                             │
                    WebSocket      ┌────────┴─────────┐
┌─────────────┐                   │                  │
│  Browser B  │◄──────────────────►│  Durable Object  │
│  (Callee)   │   Signaling        │  (Call Room)     │
└─────────────┘                    └──────────────────┘
                                             │
                                    ┌────────▼────────┐
                                    │   STUN/TURN     │
                                    │   (Public/Cloudflare)  │
                                    └─────────────────┘
                                             │
                                    WebRTC Peer Connection
                                    (Direct P2P Media)
```

---

## 技術スタック

| レイヤー | 技術 | 用途 |
|----------|------|------|
| **Backend** | Cloudflare Workers | HTTP エントリーポイント、静的アセット配信、認証 API、Push API |
| **Database** | Cloudflare D1 | ユーザー管理、連絡先、Push 購読情報、TURN 認証情報 |
| **State/Coordination** | Durable Objects | シグナリングルーム、通話状態管理 |
| **Real-time** | WebRTC (PeerConnection) | P2P 音声ストリーム（音声のみ） |
| **Signaling** | WebSocket over Workers | SDP/ICE 交換 |
| **Frontend** | Vanilla TS + Vite | 電話 UI、WebRTC API 操作、認証フォーム、連絡先管理 |
| **PWA** | Vite PWA Plugin + Workbox | Service Worker、Manifest、オフライン対応、インストール促進 |
| **Push** | Web Push API + VAPID (web-push) | バックグラウンド着信通知、アプリ未起動時の着信 |
| **NAT Traversal** | STUN + TURN (Cloudflare Realtime / coturn) | ICE 候補収集、リレー転送 |
| **Auth** | bcryptjs (Worker) | パスワードハッシュ化・検証 |
| **Local Storage** | localStorage / IndexedDB | セッショントークン、通話履歴、UI 状態、連絡先キャッシュ |

---

## フェーズ構成

### Phase 1: インフラ・プロジェクトセットアップ
- [ ] `wrangler.jsonc` 設定（Durable Objects バインディング、D1 バインディング、assets、compatibility_flags）
- [ ] `package.json` 依存関係（vite、@cloudflare/workers-types、bcryptjs、vite-plugin-pwa 等）
- [ ] TypeScript 設定
- [ ] ローカル開発環境（`wrangler dev`）
- [ ] D1 データベース作成・マイグレーション（users テーブル）

### Phase 2: Durable Object シグナリングサーバ
- [ ] `CallRoom` クラス実装
  - WebSocket 接続管理（参加者追跡：`userId` = 電話番号）
  - メッセージルーティング（offer/answer/ice-candidate）
  - 部屋状態管理（waiting/connected/ended）
  - タイムアウト/クリーンアップ処理
- [ ] シグナリングプロトコル定義
  ```typescript
  type SignalMessage =
    | { type: 'join'; roomId: string; userId: string }  // userId = 自分の電話番号
    | { type: 'offer'; sdp: RTCSessionDescriptionInit; from: string; to: string }
    | { type: 'answer'; sdp: RTCSessionDescriptionInit; from: string; to: string }
    | { type: 'ice-candidate'; candidate: RTCIceCandidateInit; from: string; to: string }
    | { type: 'leave'; userId: string }
    | { type: 'error'; message: string }
    | { type: 'calling'; from: string }  // 着信通知
  ```

### Phase 3: Worker エントリーポイント + 認証 API
- [ ] 静的アセット配信（`assets` バインディング）
- [ ] WebSocket アップグレードハンドラ → Durable Object へフォワード
- [ ] REST API: ルーム作成/参加、状態取得
- [ ] **認証 API**
  - `POST /api/auth/register` - ユーザー登録（username, password）→ 電話番号割り当て返却
  - `POST /api/auth/login` - ログイン → セッショントークン（JWT またはシンプルなトークン）返却
  - `POST /api/auth/me` - トークン検証 → ユーザー情報（電話番号含む）返却
- [ ] CORS 設定

### Phase 4: フロントエンド（電話 UI + 番号管理 + 認証）
- [ ] **認証画面**（ログイン/新規登録フォーム、バリデーション）
- [ ] **電話番号割り当てロジック**（サーバーから取得、ローカルキャッシュ）
- [ ] HTML/CSS: ダイヤルパッド、通話中画面、着信画面、自分の番号表示
- [ ] WebRTC クライアントロジック（音声のみ）
  - `getUserMedia({ audio: true, video: false })` でマイク取得
  - `RTCPeerConnection` 作成・管理
  - ICE 候補収集・交換
  - SDP offer/answer 生成・適用
- [ ] シグナリング WebSocket クライアント
  - ルームID = 相手の電話番号
  - 発信時: `join` → `offer` 送信 → 相手が参加したら `answer` 受信
  - 着信時: `join` 待機 → `calling` 受信 → `answer` 送信
- [ ] 状態管理（idle/calling/in-call/ending）
- [ ] PWA 設定（manifest.json、Service Worker、オフライン対応）

### Phase 5: 機能拡張・仕上げ
- [ ] ミュート/保留/切断ボタン
- [ ] 接続品質インジケータ
- [ ] エラーハンドリング・リトライ（再接続、ICE 再収集）
- [ ] 通話履歴（localStorage 保存）
- [ ] デプロイ（`wrangler deploy`、D1 本番適用）

### Phase 6: プッシュ通知実装
- [ ] VAPID 鍵生成・設定（wrangler secret / 環境変数）
- [ ] D1 に push_subscriptions テーブル追加（endpoint, p256dh, auth, user_id）
- [ ] Worker: `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/vapid-public-key`
- [ ] Service Worker: `push` イベントハンドラ、着信通知表示、クリックでアプリ起動
- [ ] フロントエンド: Push 権限要求、購読登録、バックグラウンド着信テスト
- [ ] CallRoom: 着信時に相手の Push 購読情報取得 → web-push で通知送信

### Phase 7: 連絡先機能
- [ ] D1 に contacts テーブル追加（owner_id, contact_phone, display_name, created_at）
- [ ] Worker: `/api/contacts` CRUD API（一覧/追加/更新/削除/検索）
- [ ] フロントエンド: 連絡先タブ追加、検索/追加/編集 UI、ダイヤルパッドから連絡先選択
- [ ] 着信時: 連絡先照合して名前表示
- [ ] 通話履歴: 連絡先名で表示

### Phase 8: TURN サーバ設定
- [ ] Cloudflare Realtime TURN または自前 coturn 設定
- [ ] Worker: `/api/turn/credentials` - 短期 TURN 認証情報発行（username, credential, ttl）
- [ ] フロントエンド: 起動時/通話前に TURN 認証情報取得、RTCConfiguration に動的設定
- [ ] ICE 候補収集ログ・接続品質モニタリング

### Phase 9: iOS Phone.app 風 UI 再設計
- [ ] `src/frontend/index.html` / `src/frontend/style.css` 全面書き直し（iOS 17/18 Phone.app 準拠）
  - 下部固定タブバー（ダイヤル / 履歴 / 連絡先 / 設定）、半透明 + backdrop-filter
  - キーパッド: 円形キー（数字 34px + 英字 10px）、中央寄せ 40px の番号表示、緑の円形発信ボタン
  - 通話中画面: フルスクリーン + blur 背景、円形コントロール 3 個、赤の円形切断ボタン
  - 着信画面: 左赤（拒否）/ 右緑（応答）の円形ボタン
  - 履歴・連絡先・設定: iOS のグループ化リスト調
  - ライト / ダーク両対応（`prefers-color-scheme`）
- [ ] DOM 契約の維持（`ui.ts` が参照する ID 46 個・クラス群・`@keyframes slideUp`）
- [ ] ダイヤル入力はアルファベット可（`pha-` `phb-` `phc-` のため readonly 禁止）
  - ※ Phase 10 で番号形式を全面変更（`091-XXXX-XXXX`）したため、数字のみ・自動整形に変更
- [ ] 電話番号形式: `091-XXXX-XXXX`（先頭3桁固定 + 残り8桁完全ランダム）
  - サーバー側で `crypto.getRandomValues` による乱数生成（UNIQUE 制約の衝突は再試行で回避）
  - 正規形（ハイフン区切り）を DB / シグナリング / 連絡先で共通利用
  - 入力欄は入力途中の数字を自動で 3-4-4 に整形（英字は除去）
  - 番号全体が常に収まるよう `cqw` で文字サイズが実幅に追従
  - 移行用 SQL: `migrations/0004_migrate_phone_numbers.sql`（既存IDへランダム再割当）
- [ ] 縦横レスポンシブ対応（はみ出しゼロ）
  - 横向き: ダイヤルを「左＝番号表示＋発信 / 右＝ダイヤルパッド」の2カラム化
  - 縦: 3列×4行のダイヤル、番号表示40px、緑の円形発信ボタン
  - 広い画面（≥900px）: アプリ幅を560pxに絞って中央配置
  - 検証: 8ビューポート（縦/横 × SE〜iPad/デスクトップ）でオーバーフロー0
- [ ] ロゴ刷新
  - `src/frontend/public/icons/icon.svg` をマスターに、SVG → PNG を8サイズ自動生成（透明度保持・最適化済み）
  - `any` / `maskable` / favicon / shortcut 用 PNG を個別生成
  - 認証画面とナビゲーションバーで同じマークを使用

---

## ファイル構成

```
koll/
├── wrangler.jsonc           # Cloudflare 設定
├── package.json
├── tsconfig.json
├── vite.config.ts
├── migrations/              # D1 マイグレーション
│   ├── 0001_create_users.sql
│   ├── 0002_create_push_subscriptions.sql
│   └── 0003_create_contacts.sql
├── src/
│   ├── worker/
│   │   ├── index.ts         # Worker エントリーポイント
│   │   ├── durable-objects/
│   │   │   └── CallRoom.ts  # Durable Object 実装
│   │   ├── api/
│   │   │   ├── auth.ts      # 認証 API ルート
│   │   │   ├── push.ts      # Push 通知 API
│   │   │   ├── contacts.ts  # 連絡先 API
│   │   │   └── turn.ts      # TURN 認証情報 API
│   │   └── types.ts         # 共有型定義
│   └── frontend/
│       ├── index.html
│       ├── main.ts          # エントリーポイント
│       ├── style.css
│       ├── manifest.json    # PWA マニフェスト
│       ├── signaling.ts     # WebSocket シグナリングクライアント
│       ├── webrtc.ts        # WebRTC 管理クラス（音声のみ）
│       ├── phoneNumber.ts   # 電話番号管理（サーバーから取得）
│       ├── auth.ts          # 認証クライアント（登録/ログイン/トークン管理）
│       ├── push.ts          # Push 通知クライアント
│       ├── contacts.ts      # 連絡先管理クライアント
│       ├── turn.ts          # TURN 設定クライアント
│       └── ui.ts            # UI 制御
└── (src/frontend/public/)   # 静的アセット（favicon、アイコン等）
                              # ※ Vite の root が src/frontend のため public は
                              #   src/frontend/public に置くこと
```

---

## 重要な実装詳細

### D1 スキーマ（users テーブル）
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,  -- pha-0000-0000 形式
  prefix_index INTEGER NOT NULL DEFAULT 0,  -- 0=pha, 1=phb, 2=phc...
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_users_phone ON users(phone_number);
```

### 電話番号割り当てロジック
- プレフィックス: `pha`, `phb`, `phc`, ..., `phz`（26種類）
- 各プレフィックスで `0000-0000` 〜 `9999-9999`（1億通り）
- 新規登録時: 最も空きのあるプレフィックスを選び、ランダムまたは連番で割り当て
- 簡易実装: `prefix_index = (SELECT COALESCE(MAX(prefix_index), -1) + 1 FROM users) % 26` で循環

### Durable Object: CallRoom
```typescript
// ストレージスキーマ
interface RoomState {
  participants: Map<string, WebSocket>;  // userId (電話番号) -> socket
  callState: 'waiting' | 'connected' | 'ended';
  createdAt: number;
  lastActivity: number;
}
```

- **WebSocket ごとに userId = 電話番号** を割り当て（クエリパラメータ `?phone=pha-xxxx-xxxx` で受け取る）
- **ブロードキャスト vs ユニキャスト**: offer/answer/ice は対象ユーザーへユニキャスト
- **自動クリーンアップ**: アラームで非アクティブルームを削除（30分）
- **着信通知**: 発信側が `join` した時点で、既にルームにいる相手（着信側）へ `calling` メッセージ送信

### WebRTC 設定（音声のみ）
```typescript
const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // TURN は本番で必要に応じて追加
  ],
  iceCandidatePoolSize: 10,
};

// getUserMedia 制約
const mediaConstraints: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};
```

### シグナリングフロー（電話番号ベース）

**発信側（A: pha-1111-1111 → B: pha-2222-2222）**
1. A が B の番号を入力 → `join` 送信（roomId = Bの番号, userId = Aの番号）
2. Durable Object: ルーム作成、A を参加者として登録、状態 `waiting`
3. A が `offer` 作成 → B 宛てに送信（DO がルーティング）
4. B がアプリを開く → 自動的に `join` 送信（roomId = 自分の番号 = Bの番号, userId = Bの番号）
5. DO: B を参加者追加、A に `peer-joined` 通知、B に `calling` 通知（from: Aの番号）
6. B が応答 → `answer` 作成 → A 宛てに送信
7. 双方が `ice-candidate` 交換
8. P2P 接続確立 → 音声ストリーム開始

**着信側（B: pha-2222-2222）**
1. アプリ起動 → 自分の番号で `join` 送信（roomId = 自分の番号）
2. 既に発信側が待機中なら即座に `calling` 受信 → 着信 UI 表示
3. ユーザーが応答 → `answer` 送信
4. 以降は同上

### 認証フロー
1. **新規登録**: `POST /api/auth/register` { username, password } → サーバーで bcrypt ハッシュ化、電話番号割り当て、ユーザー作成 → { token, phoneNumber } 返却
2. **ログイン**: `POST /api/auth/login` { username, password } → bcrypt 検証 → { token, phoneNumber } 返却
3. **トークン**: 簡易 JWT (HS256) またはランダムトークンを KV/D1 に保存（有効期限 30日）
4. **フロントエンド**: トークンを localStorage 保存、API 呼び出し時 Authorization ヘッダに付与
5. **WebSocket 接続時**: クエリパラメータ `?token=xxx` で認証、DO 内で検証して電話番号取得

### プッシュ通知実装詳細

#### VAPID 鍵生成
```bash
# ローカル生成
npx web-push generate-vapid-keys
# 本番: wrangler secret put VAPID_PRIVATE_KEY
#        wrangler secret put VAPID_PUBLIC_KEY
```

#### D1 スキーマ追加
```sql
-- push_subscriptions テーブル
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_push_user_endpoint ON push_subscriptions(user_id, endpoint);
```

#### Push API エンドポイント
- `GET /api/push/vapid-public-key` - 公開鍵取得
- `POST /api/push/subscribe` - 購読登録 { endpoint, keys: { p256dh, auth } }
- `DELETE /api/push/subscribe` - 購読解除 { endpoint }

#### 着信時 Push 送信フロー
1. CallRoom: 着信側がオフライン（WebSocket 未接続）を検知
2. D1 から着信側の push_subscriptions 取得
3. web-push ライブラリで暗号化ペイロード送信
4. Service Worker が `push` イベント受信 → Notification 表示
5. ユーザーが通知クリック → アプリ起動 → `focus` イベントで自動 `join` → 着信 UI 表示

### 連絡先機能実装詳細

#### D1 スキーマ追加
```sql
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  contact_phone TEXT NOT NULL,  -- phx-xxxx-xxxx
  display_name TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_contacts_owner ON contacts(owner_id);
CREATE INDEX idx_contacts_phone ON contacts(contact_phone);
```

#### API エンドポイント
- `GET /api/contacts` - 一覧取得（検索クエリ対応）
- `POST /api/contacts` - 追加 { contact_phone, display_name }
- `PUT /api/contacts/:id` - 更新 { display_name }
- `DELETE /api/contacts/:id` - 削除
- `GET /api/contacts/lookup/:phone` - 番号で名前検索（着信時用）

### TURN サーバ実装詳細

#### Cloudflare Realtime TURN 利用の場合
```typescript
// Workers AI / Realtime API 経由で TURN 認証情報取得
// または自前 coturn + Static Auth Secret

// 短期認証情報発行 (RFC 5389 / TURN REST API)
GET /api/turn/credentials
Response: {
  username: "timestamp:userId",
  credential: "hmac-sha1(secret, username)",
  ttl: 86400,
  urls: ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp", "turns:turn.example.com:5349?transport=tcp"]
}
```

#### フロントエンド動的設定
```typescript
// 起動時/通話前取得 → RTCPeerConnection に設定
const turnCreds = await fetchTurnCredentials();
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    ...turnCreds.urls.map(url => ({ urls: url, username: turnCreds.username, credential: turnCreds.credential }))
  ],
  iceCandidatePoolSize: 10,
};
```

---

## 開発コマンド

```bash
# 依存関係インストール
npm install

# ローカル開発（Worker + フロントエンド同時起動）
npm run dev

# フロントエンドのみビルド
npm run build:frontend

# Worker デプロイ
npm run deploy

# 型チェック
npm run typecheck
```

---

## 制約・注意事項

| 項目 | 詳細 |
|------|------|
| **同時接続数** | Durable Object 1インスタンス ≈ 数千 WebSocket（無料枠内） |
| **通話時間** | 制限なし（Durable Object アラームで管理） |
| **録音** | 非対応（MediaRecorder 追加で可能） |
| **複数人通話** | 2人のみ（1対1通話）。Mesh 方式なら 3人以上も可能 |
| **モバイル** | iOS Safari は WebRTC 対応だが要 HTTPS（Pages/Workers なら満たす） |
| **TURN** | 本番では TURN サーバ推奨（Cloudflare Realtime / Twilio / 自前 coturn） |
| **電話番号** | `ph{a-z}-0000-0000` 形式、サーバー（D1）で一意に管理・割り当て |
| **同一番号の複数タブ** | 最後に開いたタブが接続を引き継ぐ（WebSocket 単位） |
| **認証** | ユーザー名/パスワード必須、bcrypt ハッシュ、トークンベースセッション |
| **D1 容量** | 無料枠 5GB、ユーザー数十万まで余裕 |

---

## 今後の拡張案

1. **Cloudflare Realtime API** 移行（Managed WebRTC SFU）
2. **チャット機能**（DataChannel 利用）
3. **通話履歴**（D1 / KV 保存）
4. **プッシュ通知**（Service Worker + Push API）
5. **電話番号連携**（Twilio / SIP トランキング）

---

## 見積もり工数

| フェーズ | 工数目安 |
|----------|----------|
| Phase 1 | 30分 |
| Phase 2 | 2-3時間 |
| Phase 3 | 1時間 |
| Phase 4 | 3-4時間 |
| Phase 5 | 1-2時間 |
| **合計** | **約 8-11時間** |

---

## 次のアクション

このプランで問題なければ、Phase 1 から実装を開始します。優先順位やスコープ調整があれば指示してください。