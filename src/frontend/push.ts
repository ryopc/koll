// Push 通知クライアント

const API_BASE = '/api/push';

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface VapidKeyResponse {
  success: boolean;
  publicKey?: string;
  error?: string;
}

export interface PushSubscribeResponse {
  success: boolean;
  error?: string;
}

/**
 * VAPID 公開鍵取得
 */
export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/vapid-public-key`);
    const data: VapidKeyResponse = await response.json();
    return data.success ? data.publicKey || null : null;
  } catch (e) {
    console.error('Get VAPID key error:', e);
    return null;
  }
}

/**
 * Base64URL デコード
 */
function base64UrlDecode(str: string): Uint8Array {
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

/**
 * Push 購読登録
 */
export async function subscribeToPush(): Promise<PushSubscriptionData | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push API not supported');
    return null;
  }
  
  try {
    const registration = await navigator.serviceWorker.ready;
    
    // 既存購読チェック
    let subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      // 既に購読済み -> サーバーに再登録
      await sendSubscriptionToServer(subscription);
      return subscriptionToData(subscription);
    }
    
    // VAPID 公開鍵取得
    const vapidPublicKey = await getVapidPublicKey();
    if (!vapidPublicKey) {
      throw new Error('VAPID public key not available');
    }
    
    // 新規購読
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlDecode(vapidPublicKey) as unknown as BufferSource,
    });
    
    // サーバーに送信
    await sendSubscriptionToServer(subscription);
    
    return subscriptionToData(subscription);
  } catch (e) {
    console.error('Push subscribe error:', e);
    if (e instanceof DOMException && e.name === 'NotAllowedError') {
      // ユーザーが拒否
      throw new Error('Push notification permission denied');
    }
    throw e;
  }
}

/**
 * Push 購読解除
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      await sendUnsubscriptionToServer(subscription);
      await subscription.unsubscribe();
      return true;
    }
    return false;
  } catch (e) {
    console.error('Push unsubscribe error:', e);
    return false;
  }
}

/**
 * PushSubscription をデータオブジェクトに変換
 */
function subscriptionToData(subscription: PushSubscription): PushSubscriptionData {
  const keys: { p256dh: string; auth: string } = { p256dh: '', auth: '' };
  
  if (subscription.getKey) {
    const p256dh = subscription.getKey('p256dh');
    const auth = subscription.getKey('auth');
    if (p256dh) keys.p256dh = btoa(String.fromCharCode(...new Uint8Array(p256dh)));
    if (auth) keys.auth = btoa(String.fromCharCode(...new Uint8Array(auth)));
  }
  
  return {
    endpoint: subscription.endpoint,
    keys,
  };
}

/**
 * サーバーに購読情報送信
 */
async function sendSubscriptionToServer(subscription: PushSubscription): Promise<void> {
  const token = localStorage.getItem('koll_auth_token');
  if (!token) return;
  
  const data = subscriptionToData(subscription);
  
  await fetch(`${API_BASE}/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
}

/**
 * サーバーに購読解除送信
 */
async function sendUnsubscriptionToServer(subscription: PushSubscription): Promise<void> {
  const token = localStorage.getItem('koll_auth_token');
  if (!token) return;
  
  await fetch(`${API_BASE}/subscribe`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
}

/**
 * Push 通知許可状態取得
 */
export function getNotificationPermission(): NotificationPermission {
  return Notification.permission;
}

/**
 * Push 通知許可要求
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.requestPermission();
}

/**
 * Push 対応チェック
 */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}