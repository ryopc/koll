// 電話番号管理モジュール（フロントエンド）
//
// 形式: 091-XXXX-XXXX
//  - 先頭 3 桁は固定の 091
//  - 残り 8 桁はランダム（サーバー側で発行）
//  - ハイフン区切りの「正規形」を DB / シグナリング / 連絡先で共有する

const PHONE_NUMBER_KEY = 'koll_phone_number';

/** 電話番号の正規パターン */
export const PHONE_NUMBER_PATTERN = /^091-\d{4}-\d{4}$/;

/** 番号の最大桁数（先頭3 + ランダム8） */
const MAX_DIGITS = 11;

/**
 * ローカルストレージから電話番号を取得
 * なければ null を返す（サーバーから取得する必要あり）
 */
export function getStoredPhoneNumber(): string | null {
  try {
    return localStorage.getItem(PHONE_NUMBER_KEY);
  } catch {
    return null;
  }
}

/**
 * 電話番号をローカルストレージに保存
 */
export function storePhoneNumber(phoneNumber: string): void {
  try {
    localStorage.setItem(PHONE_NUMBER_KEY, phoneNumber);
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
  } catch (e) {
    console.error('Failed to clear phone number:', e);
  }
}

/**
 * 数字のみを取り出す
 */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * 3-4-4 のグループに整形する（入力途中でも使える）
 * 例: '09167817493' → '091-6781-7493'、'0916781' → '091-6781'
 */
export function canonicalizePhone(input: string): string {
  const digits = digitsOnly(input ?? '').slice(0, MAX_DIGITS);
  if (!digits) return '';

  return [
    digits.slice(0, 3),
    digits.slice(3, 7),
    digits.slice(7, 11),
  ]
    .filter((group) => group.length > 0)
    .join('-');
}

/**
 * 妥当な電話番号か（091-XXXX-XXXX の完全形）
 */
export function isValidPhoneNumber(phone: string): boolean {
  return PHONE_NUMBER_PATTERN.test(phone);
}

/**
 * 表示用フォーマット
 * 正規形はそのまま、旧形式（英字を含む）は触らない
 */
export function formatPhoneForDisplay(phone: string): string {
  const trimmed = (phone ?? '').trim();
  if (PHONE_NUMBER_PATTERN.test(trimmed)) return trimmed;
  if (/^[\d\s-]+$/.test(trimmed)) return canonicalizePhone(trimmed);
  return trimmed;
}
