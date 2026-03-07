"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/providers/LocaleProvider";

type OauthCallbackParams = {
  code: string | null;
  state: string | null;
  error: string | null;
};

function postToOpener(payload: Record<string, unknown>) {
  if (typeof window === "undefined") {
    return;
  }

  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(
      {
        type: "jarvis_oauth_callback",
        ...payload,
      },
      window.location.origin
    );
  }
}

export default function OauthCallbackPage() {
  const { t } = useLocale();
  const [params, setParams] = useState<OauthCallbackParams>({
    code: null,
    state: null,
    error: null,
  });

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setParams({
      code: search.get("code"),
      state: search.get("state"),
      error: search.get("error") ?? search.get("error_description"),
    });
  }, []);

  useEffect(() => {
    postToOpener(params);

    const timer = window.setTimeout(() => {
      window.close();
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [params]);

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full border border-white/15 rounded p-4 bg-black/50 font-mono text-xs">
        <h1 className="text-sm tracking-widest mb-3">{t("oauth.callbackTitle")}</h1>
        {params.error ? (
          <p className="text-rose-300">{t("oauth.callbackFailed", { error: params.error })}</p>
        ) : (
          <p className="text-emerald-300">{t("oauth.callbackComplete")}</p>
        )}
      </div>
    </main>
  );
}
