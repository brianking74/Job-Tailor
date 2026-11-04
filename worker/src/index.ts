/// <reference types="@cloudflare/workers-types" />

// JobTailor auth worker — signup / login / logout / me backed by D1 (SQLite).
// Passwords: PBKDF2-SHA256 (WebCrypto) with a per-user random salt.
// Sessions: random 256-bit bearer token, 30-day expiry, stored in D1.

export interface Env {
  DB: D1Database;
  CORS_ORIGINS?: string;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PBKDF2_ITERATIONS = 100_000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_NAME_LENGTH = 80;

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  salt: string;
  created_at: string;
}

interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

type ErrorCode =
  | 'MISSING_FIELDS'
  | 'INVALID_EMAIL'
  | 'WEAK_PASSWORD'
  | 'EMAIL_EXISTS'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED'
  | 'INVALID_JSON'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  const allow = origin && allowed.includes(origin) ? origin : allowed[0] ?? '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, cors: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

function errorResponse(code: ErrorCode, message: string, status: number, cors: HeadersInit): Response {
  return json({ error: { code, message } }, status, cors);
}

function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

function randomId(): string {
  return crypto.randomUUID();
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Constant-time-ish comparison to avoid leaking hash prefixes via timing.
function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

function isValidName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_LENGTH;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function createSession(env: Env, userId: string, cors: HeadersInit): Promise<Response> {
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)'
  )
    .bind(token, userId, now + SESSION_TTL_MS, new Date(now).toISOString())
    .run();
  // Opportunistic cleanup of expired sessions.
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now).run();
  return json({ token }, 200, cors);
}

async function handleSignup(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return errorResponse('INVALID_JSON', 'Request body must be valid JSON.', 400, cors);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name || !email || !password) {
    return errorResponse('MISSING_FIELDS', 'Please provide your name, email and password.', 400, cors);
  }
  if (!isValidName(name)) {
    return errorResponse('INVALID_EMAIL', `Name must be between 1 and ${MAX_NAME_LENGTH} characters.`, 400, cors);
  }
  if (!isValidEmail(email)) {
    return errorResponse('INVALID_EMAIL', 'Please enter a valid email address.', 400, cors);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return errorResponse('WEAK_PASSWORD', `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`, 400, cors);
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (existing) {
    return errorResponse('EMAIL_EXISTS', 'An account with this email already exists. Try logging in instead.', 409, cors);
  }

  const id = randomId();
  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  const createdAt = new Date().toISOString();

  try {
    await env.DB.prepare(
      'INSERT INTO users (id, name, email, password_hash, salt, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
    )
      .bind(id, name, email, passwordHash, salt, createdAt)
      .run();
  } catch (e) {
    // Unique constraint race → treat as duplicate email.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) {
      return errorResponse('EMAIL_EXISTS', 'An account with this email already exists. Try logging in instead.', 409, cors);
    }
    throw e;
  }

  const session = await createSession(env, id, cors);
  const payload = (await session.json()) as { token: string };
  return json({ user: { id, name, email, createdAt }, token: payload.token }, 200, cors);
}

async function handleLogin(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return errorResponse('INVALID_JSON', 'Request body must be valid JSON.', 400, cors);

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return errorResponse('MISSING_FIELDS', 'Please enter your email and password.', 400, cors);
  }

  const user = await env.DB.prepare(
    'SELECT id, name, email, password_hash, salt, created_at FROM users WHERE email = ?1'
  )
    .bind(email)
    .first<UserRow>();

  // Generic message for unknown email and wrong password alike.
  if (!user) {
    return errorResponse('INVALID_CREDENTIALS', 'Incorrect email or password.', 401, cors);
  }

  const candidate = await hashPassword(password, user.salt);
  if (!hashesMatch(candidate, user.password_hash)) {
    return errorResponse('INVALID_CREDENTIALS', 'Incorrect email or password.', 401, cors);
  }

  const session = await createSession(env, user.id, cors);
  const payload = (await session.json()) as { token: string };
  return json({ user: toPublicUser(user), token: payload.token }, 200, cors);
}

async function handleLogout(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = bearerToken(request);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
  }
  return json({ ok: true }, 200, cors);
}

async function handleMe(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const token = bearerToken(request);
  if (!token) {
    return errorResponse('UNAUTHORIZED', 'Missing session token.', 401, cors);
  }

  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.created_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?1`
  )
    .bind(token)
    .first<{ id: string; name: string; email: string; created_at: string; expires_at: number }>();

  if (!row || row.expires_at < now) {
    if (row) {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
    }
    return errorResponse('UNAUTHORIZED', 'Session expired or invalid. Please log in again.', 401, cors);
  }

  return json({ user: { id: row.id, name: row.name, email: row.email, createdAt: row.created_at } }, 200, cors);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const cors = corsHeaders(request.headers.get('Origin'), allowed);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (request.method === 'POST' && url.pathname === '/api/auth/signup') {
        return await handleSignup(request, env, cors);
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        return await handleLogin(request, env, cors);
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        return await handleLogout(request, env, cors);
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/me') {
        return await handleMe(request, env, cors);
      }
      return errorResponse('NOT_FOUND', 'Not found.', 404, cors);
    } catch (e) {
      console.error('Unhandled worker error', e);
      return errorResponse('INTERNAL', 'Internal server error. Please try again.', 500, cors);
    }
  },
};
