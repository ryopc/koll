// 電話番号の生成・検証（サーバー側共通モジュール）
//
// 形式: 091-XXXX-XXXX
//  - 先頭 3 桁は固定の 091
//  - 残り 8 桁は暗号学的にランダム
//  - ハイフン区切りの「正規形」を DB / シグナリング / 連絡先で共有する

/** 電話番号の正規パターン */
export const PHONE_NUMBER_PATTERN = /^091-\d{4}-\d{4}$/;

/** 先頭 3 桁（固定プレフィックス） */
export const PHONE_PREFIX = '091';

/** ランダム部分の桁数 */
const RANDOM_DIGITS = 8;

/**
 * 暗号学的に安全な乱数で数字列を生成する
 * 256 は 10 で割り切れないため、250 以上を棄却して偏りをなくす
 */
export function randomDigits(length: number): string {
  const result: number[] = [];
  const buffer = new Uint8Array(Math.max(length, 16));

  while (result.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= 250) continue;
      result.push(byte % 10);
      if (result.length === length) break;
    }
  }

  return result.join('');
}

/**
 * ランダムな電話番号を生成する（重複チェックなし）
 */
export function generateRandomPhoneNumber(): string {
  const digits = randomDigits(RANDOM_DIGITS);
  return `${PHONE_PREFIX}-${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/**
 * 妥当な電話番号か（091-XXXX-XXXX の完全形）
 */
export function isValidPhoneNumber(phone: string): boolean {
  return PHONE_NUMBER_PATTERN.test(phone);
}
