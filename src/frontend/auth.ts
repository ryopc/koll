// 認証クライアントモジュール

const TOKEN_KEY = 'koll_auth_token';
const USER_KEY = 'koll_user_info';

export interface UserInfo {
  id: number;
  username: string;
  phone_number: string;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: UserInfo;
  error?: string;
}

const API_BASE = '/api/auth';

function isAuthResult(data: unknown): data is AuthResult {
  return (
    typeof data === 'object' &&
    data !== null &&
    'success' in data &&
    typeof (data as Record<string, unknown>).success === 'boolean'
  );
}

function hasUser(data: unknown): data is AuthResult & { user: UserInfo; token: string } {
  return isAuthResult(data) && data.success && !!data.user && typeof data.token === 'string';
}

/**
 * 認証トークンを取得
 */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * ユーザー情報を取得
 */
export function getUser(): UserInfo | null {
  try {
    const data = localStorage.getItem(USER_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * トークンとユーザー情報を保存
 */
export function setAuth(token: string, user: UserInfo): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) {
    console.error('Failed to store auth:', e);
  }
}

/**
 * 認証情報をクリア
 */
export function clearAuth(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (e) {
    console.error('Failed to clear auth:', e);
  }
}

/**
 * 認証済みかチェック
 */
export function isAuthenticated(): boolean {
  return !!getToken();
}

/**
 * 新規登録
 */
export async function register(username: string, password: string): Promise<AuthResult> {
  try {
    const response = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    
    const data: unknown = await response.json();
    
    if (hasUser(data)) {
      setAuth(data.token, data.user);
    }
    
    return isAuthResult(data) ? data : { success: false, error: '不明なエラー' };
  } catch (e) {
    console.error('Register error:', e);
    return { success: false, error: 'ネットワークエラーが発生しました' };
  }
}

/**
 * ログイン
 */
export async function login(username: string, password: string): Promise<AuthResult> {
  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    
    const data: unknown = await response.json();
    
    if (hasUser(data)) {
      setAuth(data.token, data.user);
    }
    
    return isAuthResult(data) ? data : { success: false, error: '不明なエラー' };
  } catch (e) {
    console.error('Login error:', e);
    return { success: false, error: 'ネットワークエラーが発生しました' };
  }
}

/**
 * ログアウト
 */
export async function logout(): Promise<void> {
  const token = getToken();
  if (token) {
    try {
      await fetch(`${API_BASE}/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch (e) {
      console.error('Logout error:', e);
    }
  }
  clearAuth();
}

/**
 * 現在のユーザー情報を取得（トークン検証兼用）
 */
export async function fetchMe(): Promise<UserInfo | null> {
  const token = getToken();
  if (!token) return null;
  
  try {
    const response = await fetch(`${API_BASE}/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        clearAuth();
      }
      return null;
    }
    
    const data: unknown = await response.json();
    if (hasUser(data)) {
      // ローカルストレージも更新
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return data.user;
    }
    return null;
  } catch (e) {
    console.error('Fetch me error:', e);
    return null;
  }
}

/**
 * 認証ヘッダーを取得（他のAPI呼び出し用）
 */
export function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}