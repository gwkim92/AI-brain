import type { ApiErrorEnvelope, ApiSuccessEnvelope } from "@/lib/api/types";
import { clearAuthSession } from "@/lib/auth/session";

const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:4000";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

export class ApiRequestError extends Error {
  status: number;
  code: string;
  requestId?: string;
  details?: unknown;

  constructor(params: { status: number; code: string; message: string; requestId?: string; details?: unknown }) {
    super(params.message);
    this.name = "ApiRequestError";
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

function normalizeBaseUrl(input: string | undefined): string {
  if (!input || !input.trim()) {
    return DEFAULT_BACKEND_BASE_URL;
  }
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function alignLoopbackHostnameForBrowser(baseUrl: string): string {
  if (typeof window === "undefined") {
    return baseUrl;
  }

  try {
    const parsed = new URL(baseUrl);
    const frontendHostname = window.location.hostname;
    const backendHostname = parsed.hostname;

    const frontendIsLoopback = LOOPBACK_HOSTNAMES.has(frontendHostname);
    const backendIsLoopback = LOOPBACK_HOSTNAMES.has(backendHostname);

    if (frontendIsLoopback && backendIsLoopback && frontendHostname !== backendHostname) {
      parsed.hostname = frontendHostname;
      return parsed.toString().replace(/\/$/, "");
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return baseUrl;
  }
}

export function getBackendBaseUrl(): string {
  const baseUrl = normalizeBaseUrl(
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL
  );
  return alignLoopbackHostnameForBrowser(baseUrl);
}

function buildRuntimeAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const envToken = process.env.NEXT_PUBLIC_API_BEARER_TOKEN?.trim();
  const envRole = process.env.NEXT_PUBLIC_USER_ROLE?.trim();
  const envUserId = process.env.NEXT_PUBLIC_USER_ID?.trim();
  const storedToken =
    typeof window !== "undefined" ? window.localStorage.getItem("jarvis.auth.token")?.trim() ?? "" : "";
  const storedRole =
    typeof window !== "undefined" ? window.localStorage.getItem("jarvis.auth.role")?.trim() ?? "" : "";
  const storedUserId =
    typeof window !== "undefined" ? window.localStorage.getItem("jarvis.auth.user_id")?.trim() ?? "" : "";

  const token = storedToken || envToken;
  const role = storedRole || envRole;
  const userId = storedUserId || envUserId;

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (role) {
    headers["x-user-role"] = role;
  }
  if (userId) {
    headers["x-user-id"] = userId;
  }

  return headers;
}

export function createClientRequestId(prefix = "req"): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
  return `${prefix}-${randomPart}`;
}

export function buildApiUrl(pathname: string, query?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(pathname, getBackendBaseUrl());

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

export type ApiSuccessResult<TData> = {
  data: TData;
  requestId: string;
  meta: Record<string, unknown>;
};

export async function apiRequest<TData>(
  pathname: string,
  init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {}
): Promise<TData> {
  const envelope = await apiRequestEnvelope<TData>(pathname, init);
  return envelope.data;
}

export async function apiRequestEnvelope<TData>(
  pathname: string,
  init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {}
): Promise<ApiSuccessResult<TData>> {
  const { query, ...requestInit } = init;
  const hasRequestBody = typeof requestInit.body !== "undefined" && requestInit.body !== null;

  const response = await fetch(buildApiUrl(pathname, query), {
    ...requestInit,
    headers: {
      ...(hasRequestBody ? { "Content-Type": "application/json" } : {}),
      ...buildRuntimeAuthHeaders(),
      ...requestInit.headers,
    },
    cache: "no-store",
  });

  const raw = await response.text();
  const json = raw ? (JSON.parse(raw) as ApiSuccessEnvelope<TData> | ApiErrorEnvelope) : null;

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      clearAuthSession();
      const isLoginPage = window.location.pathname === "/login";
      if (!isLoginPage) {
        window.location.href = "/login?reason=session_expired";
      }
    }

    if (json && "error" in json) {
      throw new ApiRequestError({
        status: response.status,
        code: json.error.code,
        message: json.error.message,
        requestId: json.request_id,
        details: json.error.details,
      });
    }

    throw new ApiRequestError({
      status: response.status,
      code: "INTERNAL_ERROR",
      message: `request failed with status ${response.status}`,
    });
  }

  if (!json || !("data" in json)) {
    throw new ApiRequestError({
      status: response.status,
      code: "INTERNAL_ERROR",
      message: "invalid success response shape",
    });
  }

  return {
    data: json.data,
    requestId: json.request_id,
    meta: json.meta ?? {},
  };
}

export function tryParseSseData(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
