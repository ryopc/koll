-- 電話番号を 091-XXXX-XXXX 形式（ランダム）へ移行する
--
-- 旧形式: ph{a-z}-0000-0001（プレフィックス循環）
-- 新形式: 091-XXXX-XXXX（先頭3桁固定 + 残り8桁ランダム）
--
-- SQLite の random() は 64bit 整数を返すため、abs(random() % 10000) で 0-9999 を得る。
-- ただし random() だけでは UNIQUE 制約に衝突しうるため、
-- 「文全体で1つのランダム基準値」＋「id ごとの固定オフセット」で衝突を排除する。
-- id  系は 7919 / 4729（いずれも 10000 と互いに素）なので id 1-10000 で重複しない。

UPDATE users
SET phone_number =
      '091-' ||
      printf('%04d', ((SELECT abs(random() % 10000) FROM users LIMIT 1) + id * 7919) % 10000) || '-' ||
      printf('%04d', ((SELECT abs(random() % 10000) FROM users LIMIT 1) + id * 4729) % 10000)
WHERE phone_number NOT LIKE '091-%';

-- prefix_index は旧スキーマ互換のため 0 へ揃える
UPDATE users SET prefix_index = 0;

-- 旧形式の連絡先（参照先番号が存在しない）は削除する
DELETE FROM contacts WHERE contact_phone NOT LIKE '091-%';
