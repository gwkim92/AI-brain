"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { ApiRequestError } from "@/lib/api/client";
import { authConfig as getAuthConfig, authLogin, authStaticTokenLogin } from "@/lib/api/endpoints";
import { Jarvis3DCore } from "@/components/ui/Jarvis3DCore";
import { saveAuthSession, saveManualToken } from "@/lib/auth/session";
import type { AuthConfigData } from "@/lib/api/types";
import { useLocale } from "@/components/providers/LocaleProvider";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [manualRole, setManualRole] = useState("admin");
  const [manualUserId, setManualUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfigData | null>(null);
  const [authConfigLoaded, setAuthConfigLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadAuthConfig = async () => {
      try {
        const config = await getAuthConfig();
        if (!cancelled) {
          setAuthConfig(config);
        }
      } catch {
        if (!cancelled) {
          setAuthConfig({
            auth_required: true,
            auth_allow_signup: true,
            auth_token_configured: true,
          });
        }
      } finally {
        if (!cancelled) {
          setAuthConfigLoaded(true);
        }
      }
    };

    void loadAuthConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const resolveNextPath = (): string => {
    if (typeof window === "undefined") {
      return "/?widget=inbox";
    }
    const nextPath = new URLSearchParams(window.location.search).get("next");
    return nextPath && nextPath.startsWith("/") ? nextPath : "/?widget=inbox";
  };

  const submitLogin = async () => {
    if (!email.trim() || !password) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const session = await authLogin({
        email: email.trim(),
        password,
      });
      saveAuthSession(session);
      router.replace(resolveNextPath());
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("login.error.failed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const submitManualToken = async () => {
    if (!manualToken.trim()) {
      setError(t("login.error.requiredToken"));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const session = await authStaticTokenLogin({ token: manualToken.trim() });
      saveManualToken({
        role: session.user.role || manualRole,
        userId: session.user.id || manualUserId.trim() || undefined,
        email: session.user.email || undefined,
      });
      router.replace(resolveNextPath());
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("login.error.tokenFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitLogin();
  };

  const handleManualTokenSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitManualToken();
  };

  return (
    <main className="h-screen bg-black text-white flex items-center justify-center p-6 relative overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none opacity-80 [mask-image:radial-gradient(ellipse_at_center,transparent_8%,rgba(0,0,0,0.85)_44%,black_72%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,transparent_8%,rgba(0,0,0,0.85)_44%,black_72%)]">
        <Jarvis3DCore hideUI baseMode="default" overlayFx={["event_ripple"]} />
      </div>
      <div className="absolute inset-0 z-10 bg-black/40" />
      <div className="absolute inset-0 z-10 bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0.6)_0%,_rgba(0,0,0,0.35)_35%,_rgba(0,255,255,0.08)_100%)]" />
      <div className="w-full max-w-xl space-y-6 relative z-20">
        <section className="glass-panel rounded-xl border border-white/10 p-6 bg-black/70 backdrop-blur-xl">
          <h1 className="text-xl font-mono font-bold tracking-widest text-cyan-300">{t("login.title")}</h1>
          <p className="text-xs font-mono text-white/50 mt-1">{t("login.subtitle")}</p>

          <form className="mt-5 space-y-3" onSubmit={handleLoginSubmit}>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("login.emailPlaceholder")}
              className="w-full h-10 rounded border border-white/15 bg-black/50 px-3 text-sm font-mono"
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder={t("login.passwordPlaceholder")}
              className="w-full h-10 rounded border border-white/15 bg-black/50 px-3 text-sm font-mono"
            />
            <button
              type="submit"
              disabled={loading || !email.trim() || !password}
              className="w-full h-10 rounded bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 text-xs font-mono tracking-widest disabled:opacity-40"
            >
              {loading ? t("login.signingIn") : t("login.signIn")}
            </button>
          </form>
        </section>

        {authConfig?.auth_token_configured ? (
          <section className="glass-panel rounded-xl border border-white/10 p-6 bg-black/70 backdrop-blur-xl">
            <h2 className="text-sm font-mono font-bold tracking-widest text-white/80">{t("login.staticModeTitle")}</h2>
            <p className="text-[11px] font-mono text-white/50 mt-1">{t("login.staticModeSubtitle")}</p>

            <form className="mt-4 space-y-3" onSubmit={handleManualTokenSubmit}>
              <input
                value={manualToken}
                onChange={(event) => setManualToken(event.target.value)}
                placeholder={t("login.bearerTokenPlaceholder")}
                className="w-full h-10 rounded border border-white/15 bg-black/50 px-3 text-sm font-mono"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={manualRole}
                  onChange={(event) => setManualRole(event.target.value)}
                  className="h-10 rounded border border-white/15 bg-black/50 px-3 text-xs font-mono"
                >
                  <option value="admin">admin</option>
                  <option value="operator">operator</option>
                  <option value="member">member</option>
                </select>
                <input
                  value={manualUserId}
                  onChange={(event) => setManualUserId(event.target.value)}
                  placeholder={t("login.userIdPlaceholder")}
                  className="h-10 rounded border border-white/15 bg-black/50 px-3 text-xs font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full h-10 rounded bg-white/10 border border-white/20 text-white/80 text-xs font-mono tracking-widest"
              >
                {loading ? t("login.verifyingToken") : t("login.verifyToken")}
              </button>
            </form>
          </section>
        ) : authConfigLoaded ? (
          <section className="glass-panel rounded-xl border border-white/10 p-5 bg-black/60 backdrop-blur-xl">
            <p className="text-xs font-mono text-white/60">{t("login.staticDisabled")}</p>
          </section>
        ) : null}

        {error && <p className="text-xs font-mono text-rose-300">{error}</p>}

        {authConfig?.auth_allow_signup !== false ? (
          <p className="text-xs font-mono text-white/55">
            {t("login.noAccount")}{" "}
            <Link href="/signup" className="text-cyan-300 hover:text-cyan-100">
              {t("login.createOne")}
            </Link>
          </p>
        ) : (
          <p className="text-xs font-mono text-white/45">{t("login.signupDisabled")}</p>
        )}
      </div>
    </main>
  );
}
