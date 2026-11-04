
import type { AuthUser } from '../types.ts';

// Simple client-side account system.
// Accounts live in localStorage (per browser/device); passwords are never
// stored in plaintext — each user gets a random salt and a SHA-256 hash.

const USERS_KEY = 'jobtailor_users_v1';
const SESSION_KEY = 'jobtailor_session_v1';
const MIN_PASSWORD_LENGTH = 8;

interface StoredUser extends AuthUser {
  passwordHash: string;
  salt: string;
}

export type AuthErrorCode =
  | 'MISSING_FIELDS'
  | 'INVALID_EMAIL'
  | 'WEAK_PASSWORD'
  | 'EMAIL_EXISTS'
  | 'INVALID_CREDENTIALS';

export class AuthError extends Error {
  code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

function readUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredUser[]) : [];
  } catch (e) {
    console.error('Failed to read accounts from storage', e);
    return [];
  }
}

function writeUsers(users: StoredUser[]): void {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch (e) {
    console.error('Failed to persist accounts to storage', e);
    throw new AuthError('MISSING_FIELDS', 'Could not save the account in this browser. Please try again.');
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `u_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const payload = `${salt}:${password}`;
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // Defensive fallback for non-secure contexts; production is always HTTPS.
    let h = 0;
    for (let i = 0; i < payload.length; i++) {
      h = (Math.imul(31, h) + payload.charCodeAt(i)) | 0;
    }
    return `fallback_${h}`;
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toPublicUser(user: StoredUser): AuthUser {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function getCurrentUser(): AuthUser | null {
  try {
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) return null;
    const user = readUsers().find((u) => u.id === sessionId);
    if (!user) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return toPublicUser(user);
  } catch (e) {
    console.error('Failed to restore session', e);
    return null;
  }
}

export async function signUp(name: string, email: string, password: string): Promise<AuthUser> {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName || !cleanEmail || !password) {
    throw new AuthError('MISSING_FIELDS', 'Please fill in your name, email and password.');
  }
  if (!isValidEmail(cleanEmail)) {
    throw new AuthError('INVALID_EMAIL', 'Please enter a valid email address.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError('WEAK_PASSWORD', `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }

  const users = readUsers();
  if (users.some((u) => u.email === cleanEmail)) {
    throw new AuthError('EMAIL_EXISTS', 'An account with this email already exists. Try logging in instead.');
  }

  const salt = randomId().replace(/-/g, '');
  const passwordHash = await hashPassword(password, salt);
  const user: StoredUser = {
    id: randomId(),
    name: cleanName,
    email: cleanEmail,
    createdAt: new Date().toISOString(),
    passwordHash,
    salt,
  };

  users.push(user);
  writeUsers(users);
  localStorage.setItem(SESSION_KEY, user.id);
  return toPublicUser(user);
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) {
    throw new AuthError('MISSING_FIELDS', 'Please enter your email and password.');
  }

  const user = readUsers().find((u) => u.email === cleanEmail);
  // Same generic message for unknown email and wrong password.
  if (!user) {
    throw new AuthError('INVALID_CREDENTIALS', 'Incorrect email or password.');
  }

  const passwordHash = await hashPassword(password, user.salt);
  if (passwordHash !== user.passwordHash) {
    throw new AuthError('INVALID_CREDENTIALS', 'Incorrect email or password.');
  }

  localStorage.setItem(SESSION_KEY, user.id);
  return toPublicUser(user);
}

export function signOut(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    console.error('Failed to clear session', e);
  }
}
