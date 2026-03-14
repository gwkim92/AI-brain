"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const params = useMemo<OauthCallbackParams>(
    () => ({
      code: searchParams.get("code"),
      state: searchParams.get("state"),
      error: searchParams.get("error") ?? searchParams.get("error_description"),
    }),
    [searchParams]
  );

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
