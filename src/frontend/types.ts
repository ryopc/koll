// 共有型定義（フロントエンド用）

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
export interface UserInfo {
  id: number;
  username: string;
  phone_number: string;
}