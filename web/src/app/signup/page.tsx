"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

import { ApiRequestError } from "@/lib/api/client";
import { authSignup } from "@/lib/api/endpoints";
import { Jarvis3DCore } from "@/components/ui/Jarvis3DCore";
import { saveAuthSession } from "@/lib/auth/session";
import { useLocale } from "@/components/providers/LocaleProvider";

export default function SignupPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveNextPath = (): string => {
    if (typeof window === "undefined") {
      return "/";
    }
    const nextPath = new URLSearchParams(window.location.search).get("next");
    return nextPath && nextPath.startsWith("/") ? nextPath : "/";
  };

  const submitSignup = async () => {
    if (!email.trim() || !password || password !== confirmPassword) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const session = await authSignup({
        email: email.trim(),
        password,
        display_name: displayName.trim() || undefined,
      });
      saveAuthSession(session);
      router.replace(resolveNextPath());
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("signup.error.failed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const handleSignupSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitSignup();
  };

  return (
    <main className="h-screen bg-black text-white flex items-center justify-center p-6 relative overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none opacity-80 [mask-image:radial-gradient(ellipse_at_center,transparent_8%,rgba(0,0,0,0.85)_44%,black_72%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,transparent_8%,rgba(0,0,0,0.85)_44%,black_72%)]">
        <Jarvis3DCore hideUI baseMode="multi_attractor" overlayFx={["event_ripple"]} />
      </div>
      <div className="absolute inset-0 z-10 bg-black/40" />
      <div className="absolute inset-0 z-10 bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0.6)_0%,_rgba(0,0,0,0.35)_35%,_rgba(0,255,255,0.08)_100%)]" />
      <div className="w-full max-w-xl glass-panel rounded-xl border border-white/10 p-6 bg-black/70 backdrop-blur-xl relative z-20">
        <h1 className="text-xl font-mono font-bold tracking-widest text-cyan-300">{t("signup.title")}</h1>
        <p className="text-xs font-mono text-white/50 mt-1">{t("signup.subtitle")}</p>

        <form className="mt-5 space-y-3" onSubmit={handleSignupSubmit}>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("signup.emailPlaceholder")}
            className="w-full h-10 rounded border border-white/15 bg-black/50 px-3 text-sm font-mono"
          />
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={t("signup.displayNamePlaceholder")}
            className="w-full h-10 rounded border border-white/15 bg-black/50 px-3 text-sm font-mono"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder={t("signup.passwordPlaceholder")}
            className="w-full h-10 rounded border border-white/15 bg-black/50 px-3 text-sm font-mono"
          />
          <input
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            type="password"
            placeholder={t("signup.confirmPasswordPlaceholder")}
            className="w-full h-10 rounded border border-white/15 bg-black/50 px-3 text-sm font-mono"
          />
          {passwordsMismatch && <p className="text-xs font-mono text-rose-300">{t("signup.passwordMismatch")}</p>}
          <button
            type="submit"
            disabled={loading || !email.trim() || password.length < 8 || passwordsMismatch}
            className="w-full h-10 rounded bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 text-xs font-mono tracking-widest disabled:opacity-40"
          >
            {loading ? t("signup.creating") : t("signup.createAccount")}
          </button>
        </form>

        {error && <p className="mt-3 text-xs font-mono text-rose-300">{error}</p>}

        <p className="mt-4 text-xs font-mono text-white/55">
          {t("signup.alreadyHaveAccount")}{" "}
          <Link href="/login" className="text-cyan-300 hover:text-cyan-100">
            {t("signup.login")}
          </Link>
        </p>
      </div>
    </main>
  );
}
