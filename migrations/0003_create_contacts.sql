-- 連絡先テーブル
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  contact_phone TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_contacts_owner ON contacts(owner_id);
CREATE INDEX idx_contacts_phone ON contacts(contact_phone);
CREATE UNIQUE INDEX idx_contacts_owner_phone ON contacts(owner_id, contact_phone);