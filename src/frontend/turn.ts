// TURN 設定クライアント

const API_BASE = '/api/turn';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface TurnCredentialsResponse {
  success: boolean;
  iceServers?: IceServer[];
  ttl?: number;
  username?: string;
  source?: 'cloudflare-realtime' | 'stun-only' | 'custom';
  error?: string;
}

export interface TurnConfigCheckResponse {
  success: boolean;
  configured: boolean;
  urls?: string[];
}

/**
 * TURN 認証情報取得（ICE サーバー設定含む）
 */
export async function fetchTurnCredentials(): Promise<IceServer[]> {
  try {
    const token = localStorage.getItem('koll_auth_token');
    if (!token) {
      // 未認証時は STUN のみ
      return getDefaultIceServers();
    }
    
    const response = await fetch(`${API_BASE}/credentials`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    const data: TurnCredentialsResponse = await response.json();
    if (data.success && data.iceServers) {
      return data.iceServers;
    }
    
    return getDefaultIceServers();
  } catch (e) {
    console.error('Fetch TURN credentials error:', e);
    return getDefaultIceServers();
  }
}

/**
 * デフォルト STUN サーバー
 */
function getDefaultIceServers(): IceServer[] {
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
}

/**
 * TURN 設定確認
 */
export async function checkTurnConfig(): Promise<TurnConfigCheckResponse | null> {
  try {
    const token = localStorage.getItem('koll_auth_token');
    if (!token) return null;
    
    const response = await fetch(`${API_BASE}/config-check`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    return await response.json();
  } catch (e) {
    console.error('Check TURN config error:', e);
    return null;
  }
}

/**
 * RTCConfiguration 構築（TURN 認証情報込み）
 */
export async function buildRTCConfiguration(): Promise<RTCConfiguration> {
  const iceServers = await fetchTurnCredentials();
  
  return {
    iceServers,
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all', // 'relay' で TURN 強制も可能
  };
}

/**
 * ICE 接続状態の人間可読文字列
 */
export function getIceConnectionStateLabel(state: RTCIceConnectionState): string {
  switch (state) {
    case 'new': return '初期化中';
    case 'checking': return '接続確認中';
    case 'connected': return '接続済み';
    case 'completed': return '完了';
    case 'failed': return '失敗';
    case 'disconnected': return '切断';
    case 'closed': return '終了';
    default: return state;
  }
}

/**
 * ICE 接続品質チェック
 */
export function isIceConnectionHealthy(state: RTCIceConnectionState): boolean {
  return state === 'connected' || state === 'completed';
}