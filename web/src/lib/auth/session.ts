import type { AuthSessionData } from "@/lib/api/types";

export const AUTH_TOKEN_KEY = "jarvis.auth.token";
export const AUTH_ROLE_KEY = "jarvis.auth.role";
export const AUTH_USER_ID_KEY = "jarvis.auth.user_id";
export const AUTH_USER_EMAIL_KEY = "jarvis.auth.email";
export const AUTH_COOKIE_KEY = "jarvis_auth_token";

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

  // Session token is now cookie-authenticated by backend (HttpOnly).
  // Remove any legacy client-stored tokens.
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.setItem(AUTH_ROLE_KEY, session.user.role);
  window.localStorage.setItem(AUTH_USER_ID_KEY, session.user.id);
  window.localStorage.setItem(AUTH_USER_EMAIL_KEY, session.user.email);
  notifyAuthUpdated();
}

export function saveManualToken(input: { token?: string; role: string; userId?: string; email?: string }): void {
  if (typeof window === "undefined") {
    return;
  }

  if (input.token?.trim()) {
    // Keep static-token mode ephemeral in current browser tab.
    window.sessionStorage.setItem(AUTH_TOKEN_KEY, input.token.trim());
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
  }
  window.localStorage.setItem(AUTH_ROLE_KEY, input.role);
  if (input.userId?.trim()) {
    window.localStorage.setItem(AUTH_USER_ID_KEY, input.userId.trim());
  }
  if (input.email?.trim()) {
    window.localStorage.setItem(AUTH_USER_EMAIL_KEY, input.email.trim());
  }
  notifyAuthUpdated();
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_ROLE_KEY);
  window.localStorage.removeItem(AUTH_USER_ID_KEY);
  window.localStorage.removeItem(AUTH_USER_EMAIL_KEY);
  notifyAuthUpdated();
}
