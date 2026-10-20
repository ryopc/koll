// 共有型定義

// WebRTC 最小型定義（DOM lib との競合回避のためローカル定義）
export interface RTCSessionDescriptionInit {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface RTCIceCandidateInit {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

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
  CALL_ROOM: DurableObjectNamespace;
  DB: D1Database;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  TURN_KEY_ID: string;
  TURN_API_TOKEN: string;
  COTURN_HOST: string;
  COTURN_USERNAME: string;
  COTURN_PASSWORD: string;
  COTURN_PORT: string;
  COTURN_TLS_PORT: string;
}

// Hono の Context 型拡張
declare module 'hono' {
  interface ContextVariableMap {
    userId: number;
  }
}