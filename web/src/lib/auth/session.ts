import type { AuthSessionData } from "@/lib/api/types";

export const AUTH_TOKEN_KEY = "jarvis.auth.token";
export const AUTH_ROLE_KEY = "jarvis.auth.role";
export const AUTH_USER_ID_KEY = "jarvis.auth.user_id";
export const AUTH_USER_EMAIL_KEY = "jarvis.auth.email";
export const AUTH_COOKIE_KEY = "jarvis_auth_token";

function setAuthCookie(token: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") {
    return;
  }

  const safeMaxAge = Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 ? Math.floor(maxAgeSeconds) : 60 * 60 * 24 * 7;
  document.cookie = `${AUTH_COOKIE_KEY}=${encodeURIComponent(token)}; Path=/; Max-Age=${safeMaxAge}; SameSite=Lax`;
}

function clearAuthCookie(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${AUTH_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function notifyAuthUpdated(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event("jarvis-auth-updated"));
}

export function saveAuthSession(session: AuthSessionData): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_KEY, session.token);
  window.localStorage.setItem(AUTH_ROLE_KEY, session.user.role);
  window.localStorage.setItem(AUTH_USER_ID_KEY, session.user.id);
  window.localStorage.setItem(AUTH_USER_EMAIL_KEY, session.user.email);
  const expiresAtMs = Date.parse(session.expires_at);
  const maxAgeSeconds = Number.isFinite(expiresAtMs) ? Math.max(60, Math.floor((expiresAtMs - Date.now()) / 1000)) : 60 * 60 * 24 * 7;
  setAuthCookie(session.token, maxAgeSeconds);
  notifyAuthUpdated();
}

export function saveManualToken(input: { token: string; role: string; userId?: string; email?: string }): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_KEY, input.token);
  window.localStorage.setItem(AUTH_ROLE_KEY, input.role);
  if (input.userId?.trim()) {
    window.localStorage.setItem(AUTH_USER_ID_KEY, input.userId.trim());
  }
  if (input.email?.trim()) {
    window.localStorage.setItem(AUTH_USER_EMAIL_KEY, input.email.trim());
  }
  setAuthCookie(input.token, 60 * 60 * 24 * 7);
  notifyAuthUpdated();
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_ROLE_KEY);
  window.localStorage.removeItem(AUTH_USER_ID_KEY);
  window.localStorage.removeItem(AUTH_USER_EMAIL_KEY);
  clearAuthCookie();
  notifyAuthUpdated();
}
