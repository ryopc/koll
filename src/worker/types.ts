// 共有型定義

// シグナリングメッセージ
export type SignalMessage =
  | { type: 'join'; roomId: string; userId: string }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit; from: string; to: string }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit; from: string; to: string }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit; from: string; to: string }
  | { type: 'leave'; userId: string }
  | { type: 'error'; message: string }
  | { type: 'calling'; from: string }
  | { type: 'peer-joined'; userId: string }
  | { type: 'peer-left'; userId: string };

// ユーザー情報
export interface User {
  id: number;
  username: string;
  phone_number: string;
  prefix_index: number;
  created_at: number;
  updated_at: number;
}

// セッション
export interface Session {
  token: string;
  user_id: number;
  expires_at: number;
  created_at: number;
}

// 認証 API レスポンス
export interface AuthResponse {
  success: boolean;
  token?: string;
  user?: Pick<User, 'id' | 'username' | 'phone_number'>;
  error?: string;
}

// ルーム状態
export type CallState = 'waiting' | 'connected' | 'ended';

export interface RoomState {
  participants: Map<string, WebSocket>; // userId (電話番号) -> socket
  callState: CallState;
  createdAt: number;
  lastActivity: number;
}

// Worker 環境バインディング
export interface Env {
  ASSETS: Fetcher;
  CALL_ROOM: DurableObjectNamespace<CallRoom>;
  DB: D1Database;
  JWT_SECRET: string;
}

// Durable Object クラス型（後で定義）
export class CallRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }
}