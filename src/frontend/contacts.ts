// 連絡先管理クライアント

const API_BASE = '/api/contacts';

export interface Contact {
  id: number;
  contact_phone: string;
  display_name: string | null;
  created_at: number;
  updated_at: number;
}

export interface ContactsResponse {
  success: boolean;
  contacts?: Contact[];
  error?: string;
}

export interface ContactResponse {
  success: boolean;
  contact?: Contact;
  displayName?: string | null;
  error?: string;
}

/**
 * 連絡先一覧取得
 */
export async function getContacts(query?: string): Promise<Contact[]> {
  try {
    const token = localStorage.getItem('koll_auth_token');
    if (!token) return [];
    
    const url = new URL(API_BASE, window.location.origin);
    if (query) url.searchParams.set('q', query);
    
    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    const data: ContactsResponse = await response.json();
    return data.success ? (data.contacts || []) : [];
  } catch (e) {
    console.error('Get contacts error:', e);
    return [];
  }
}

/**
 * 番号で連絡先名検索（着信時用）
 */
export async function lookupContactName(phone: string): Promise<string | null> {
  try {
    const token = localStorage.getItem('koll_auth_token');
    if (!token) return null;
    
    const response = await fetch(`${API_BASE}/lookup/${encodeURIComponent(phone)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    const data: ContactResponse = await response.json();
    return data.success ? data.displayName || null : null;
  } catch (e) {
    console.error('Lookup contact error:', e);
    return null;
  }
}

/**
 * 連絡先追加
 */
export async function addContact(contactPhone: string, displayName?: string): Promise<Contact | null> {
  try {
    const token = localStorage.getItem('koll_auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ contact_phone: contactPhone, display_name: displayName }),
    });
    
    const data: ContactResponse = await response.json();
    return data.success ? (data.contact || null) : null;
  } catch (e) {
    console.error('Add contact error:', e);
    throw e;
  }
}

/**
 * 連絡先更新（表示名変更）
 */
export async function updateContact(id: number, displayName: string | null): Promise<boolean> {
  try {
    const token = localStorage.getItem('koll_auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const response = await fetch(`${API_BASE}/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ display_name: displayName }),
    });
    
    const data: ContactResponse = await response.json();
    return data.success;
  } catch (e) {
    console.error('Update contact error:', e);
    return false;
  }
}

/**
 * 連絡先削除
 */
export async function deleteContact(id: number): Promise<boolean> {
  try {
    const token = localStorage.getItem('koll_auth_token');
    if (!token) throw new Error('Not authenticated');
    
    const response = await fetch(`${API_BASE}/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    const data: ContactResponse = await response.json();
    return data.success;
  } catch (e) {
    console.error('Delete contact error:', e);
    return false;
  }
}

/**
 * 電話番号形式検証
 */
export function validateContactPhone(phone: string): boolean {
  return /^ph[a-z]-\d{4}-\d{4}$/.test(phone);
}

/**
 * 表示用電話番号フォーマット
 */
export function formatContactPhone(phone: string): string {
  return phone.replace(/^ph([a-z])-(\d{4})(\d{4})$/, 'ph$1-$2-$3');
}

/**
 * 連絡先表示名取得（名前がなければ番号）
 */
export function getContactDisplayName(contact: Contact): string {
  return contact.display_name || formatContactPhone(contact.contact_phone);
}

/**
 * 連絡先検索用フィルタ
 */
export function filterContacts(contacts: Contact[], query: string): Contact[] {
  if (!query.trim()) return contacts;
  const lower = query.toLowerCase();
  return contacts.filter(c => 
    c.contact_phone.includes(query) || 
    (c.display_name && c.display_name.toLowerCase().includes(lower))
  );
}