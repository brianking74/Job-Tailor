var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var PBKDF2_ITERATIONS = 1e5;
var MIN_PASSWORD_LENGTH = 8;
var MAX_NAME_LENGTH = 80;
function corsHeaders(origin, allowed) {
  const allow = origin && allowed.includes(origin) ? origin : allowed[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors }
  });
}
__name(json, "json");
function errorResponse(code, message, status, cors) {
  return json({ error: { code, message } }, status, cors);
}
__name(errorResponse, "errorResponse");
function toPublicUser(row) {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}
__name(toPublicUser, "toPublicUser");
function randomId() {
  return crypto.randomUUID();
}
__name(randomId, "randomId");
function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(randomHex, "randomHex");
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
__name(isValidEmail, "isValidEmail");
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashPassword, "hashPassword");
function hashesMatch(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
__name(hashesMatch, "hashesMatch");
async function readJsonBody(request) {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? body : null;
  } catch {
    return null;
  }
}
__name(readJsonBody, "readJsonBody");
function bearerToken(request) {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}
__name(bearerToken, "bearerToken");
function isValidName(name) {
  return name.length > 0 && name.length <= MAX_NAME_LENGTH;
}
__name(isValidName, "isValidName");
async function createSession(env, userId, cors) {
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)"
  ).bind(token, userId, now + SESSION_TTL_MS, new Date(now).toISOString()).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now).run();
  return json({ token }, 200, cors);
}
__name(createSession, "createSession");
async function handleSignup(request, env, cors) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("INVALID_JSON", "Request body must be valid JSON.", 400, cors);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!name || !email || !password) {
    return errorResponse("MISSING_FIELDS", "Please provide your name, email and password.", 400, cors);
  }
  if (!isValidName(name)) {
    return errorResponse("INVALID_EMAIL", `Name must be between 1 and ${MAX_NAME_LENGTH} characters.`, 400, cors);
  }
  if (!isValidEmail(email)) {
    return errorResponse("INVALID_EMAIL", "Please enter a valid email address.", 400, cors);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return errorResponse("WEAK_PASSWORD", `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`, 400, cors);
  }
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first();
  if (existing) {
    return errorResponse("EMAIL_EXISTS", "An account with this email already exists. Try logging in instead.", 409, cors);
  }
  const id = randomId();
  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, name, email, password_hash, salt, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    ).bind(id, name, email, passwordHash, salt, createdAt).run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return errorResponse("EMAIL_EXISTS", "An account with this email already exists. Try logging in instead.", 409, cors);
    }
    throw e;
  }
  const session = await createSession(env, id, cors);
  const payload = await session.json();
  return json({ user: { id, name, email, createdAt }, token: payload.token }, 200, cors);
}
__name(handleSignup, "handleSignup");
async function handleLogin(request, env, cors) {
  const body = await readJsonBody(request);
  if (!body) return errorResponse("INVALID_JSON", "Request body must be valid JSON.", 400, cors);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return errorResponse("MISSING_FIELDS", "Please enter your email and password.", 400, cors);
  }
  const user = await env.DB.prepare(
    "SELECT id, name, email, password_hash, salt, created_at FROM users WHERE email = ?1"
  ).bind(email).first();
  if (!user) {
    return errorResponse("INVALID_CREDENTIALS", "Incorrect email or password.", 401, cors);
  }
  const candidate = await hashPassword(password, user.salt);
  if (!hashesMatch(candidate, user.password_hash)) {
    return errorResponse("INVALID_CREDENTIALS", "Incorrect email or password.", 401, cors);
  }
  const session = await createSession(env, user.id, cors);
  const payload = await session.json();
  return json({ user: toPublicUser(user), token: payload.token }, 200, cors);
}
__name(handleLogin, "handleLogin");
async function handleLogout(request, env, cors) {
  const token = bearerToken(request);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?1").bind(token).run();
  }
  return json({ ok: true }, 200, cors);
}
__name(handleLogout, "handleLogout");
async function handleMe(request, env, cors) {
  const token = bearerToken(request);
  if (!token) {
    return errorResponse("UNAUTHORIZED", "Missing session token.", 401, cors);
  }
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.created_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?1`
  ).bind(token).first();
  if (!row || row.expires_at < now) {
    if (row) {
      await env.DB.prepare("DELETE FROM sessions WHERE token = ?1").bind(token).run();
    }
    return errorResponse("UNAUTHORIZED", "Session expired or invalid. Please log in again.", 401, cors);
  }
  return json({ user: { id: row.id, name: row.name, email: row.email, createdAt: row.created_at } }, 200, cors);
}
__name(handleMe, "handleMe");
var src_default = {
  async fetch(request, env) {
    const allowed = (env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const cors = corsHeaders(request.headers.get("Origin"), allowed);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      if (request.method === "POST" && url.pathname === "/api/auth/signup") {
        return await handleSignup(request, env, cors);
      }
      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        return await handleLogin(request, env, cors);
      }
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        return await handleLogout(request, env, cors);
      }
      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        return await handleMe(request, env, cors);
      }
      return errorResponse("NOT_FOUND", "Not found.", 404, cors);
    } catch (e) {
      console.error("Unhandled worker error", e);
      return errorResponse("INTERNAL", "Internal server error. Please try again.", 500, cors);
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-hzTfSH/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-hzTfSH/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
