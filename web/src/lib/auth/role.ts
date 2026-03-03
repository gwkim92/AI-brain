"use client";

import { useEffect, useState } from "react";

import { AUTH_ROLE_KEY } from "@/lib/auth/session";

export type AppUserRole = "member" | "operator" | "admin";

const ROLE_RANK: Record<AppUserRole, number> = {
  member: 1,
  operator: 2,
  admin: 3,
};

const OPERATOR_WIDGETS = new Set(["reports", "approvals"]);

export function normalizeAppRole(value: string | null | undefined): AppUserRole {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "member" || normalized === "operator" || normalized === "admin") {
    return normalized;
  }

  return "member";
}

export function hasMinRole(currentRole: AppUserRole, requiredRole: AppUserRole): boolean {
  return ROLE_RANK[currentRole] >= ROLE_RANK[requiredRole];
}

export function canAccessWidget(role: AppUserRole, widgetId: string): boolean {
  if (OPERATOR_WIDGETS.has(widgetId)) {
    return hasMinRole(role, "operator");
  }
  return true;
}

export function useCurrentRole(): AppUserRole {
  // Keep initial render deterministic across server/client to avoid hydration mismatch.
  const [role, setRole] = useState<AppUserRole>("member");

  useEffect(() => {
    const syncRole = () => {
      const nextRole = normalizeAppRole(window.localStorage.getItem(AUTH_ROLE_KEY));
      setRole(nextRole);
    };

    syncRole();
    window.addEventListener("storage", syncRole);
    window.addEventListener("jarvis-auth-updated", syncRole);

    return () => {
      window.removeEventListener("storage", syncRole);
      window.removeEventListener("jarvis-auth-updated", syncRole);
    };
  }, []);

  return role;
}

export function useCurrentRoleState(): { role: AppUserRole; hydrated: boolean } {
  const [role, setRole] = useState<AppUserRole>("member");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const syncRole = () => {
      const nextRole = normalizeAppRole(window.localStorage.getItem(AUTH_ROLE_KEY));
      setRole(nextRole);
      setHydrated(true);
    };

    syncRole();
    window.addEventListener("storage", syncRole);
    window.addEventListener("jarvis-auth-updated", syncRole);

    return () => {
      window.removeEventListener("storage", syncRole);
      window.removeEventListener("jarvis-auth-updated", syncRole);
    };
  }, []);

  return { role, hydrated };
}
