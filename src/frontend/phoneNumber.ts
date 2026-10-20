// 電話番号管理モジュール

const PHONE_NUMBER_KEY = 'koll_phone_number';
const PHONE_PREFIX_KEY = 'koll_phone_prefix_index';

export interface PhoneNumberInfo {
  phoneNumber: string;
  prefixIndex: number;
}

/**
 * ローカルストレージから電話番号を取得
 * なければ null を返す（サーバーから取得する必要あり）
 */
export function getStoredPhoneNumber(): PhoneNumberInfo | null {
  try {
    const phoneNumber = localStorage.getItem(PHONE_NUMBER_KEY);
    const prefixIndex = localStorage.getItem(PHONE_PREFIX_KEY);
    
    if (phoneNumber && prefixIndex !== null) {
      return {
        phoneNumber,
        prefixIndex: parseInt(prefixIndex, 10),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 電話番号をローカルストレージに保存
 */
export function storePhoneNumber(info: PhoneNumberInfo): void {
  try {
    localStorage.setItem(PHONE_NUMBER_KEY, info.phoneNumber);
    localStorage.setItem(PHONE_PREFIX_KEY, info.prefixIndex.toString());
  } catch (e) {
    console.error('Failed to store phone number:', e);
  }
}

/**
 * 電話番号をクリア（ログアウト時など）
 */
export function clearPhoneNumber(): void {
  try {
    localStorage.removeItem(PHONE_NUMBER_KEY);
    localStorage.removeItem(PHONE_PREFIX_KEY);
  } catch (e) {
    console.error('Failed to clear phone number:', e);
  }
}

/**
 * 電話番号フォーマット検証
 * 形式: ph{a-z}-xxxx-xxxx
 */
export function validatePhoneNumber(phone: string): boolean {
  return /^ph[a-z]-\d{4}-\d{4}$/.test(phone);
}

/**
 * 電話番号を整形（入力補助用）
 * 数字のみを受け取って phx-xxxx-xxxx 形式にする
 */
export function formatPhoneNumber(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 0) return '';
  
  // プレフィックス判定（最初の1桁で ph{a-z} を決める簡易版）
  // 実際はサーバーから取得した番号を使う
  const prefix = 'a'; // デフォルト
  const numPart = digits.padStart(8, '0').slice(0, 8);
  return `ph${prefix}-${numPart.slice(0, 4)}-${numPart.slice(4)}`;
}

/**
 * 表示用フォーマット（スペース区切りなど）
 */
export function formatForDisplay(phone: string): string {
  return phone; // そのまま表示
}

/**
 * プレフィックスからインデックスを取得
 */
export function prefixToIndex(prefix: string): number {
  const char = prefix.toLowerCase().charAt(0);
  if (char >= 'a' && char <= 'z') {
    return char.charCodeAt(0) - 'a'.charCodeAt(0);
  }
  return 0;
}

/**
 * インデックスからプレフィックスを取得
 */
export function indexToPrefix(index: number): string {
  const normalized = ((index % 26) + 26) % 26;
  return String.fromCharCode('a'.charCodeAt(0) + normalized);
}