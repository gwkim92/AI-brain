"use client";

import { useEffect, useMemo } from "react";

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
  const params = useMemo(() => {
    if (typeof window === "undefined") {
      return { code: null, state: null, error: null };
    }

    const search = new URLSearchParams(window.location.search);
    return {
      code: search.get("code"),
      state: search.get("state"),
      error: search.get("error") ?? search.get("error_description"),
    };
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
        <h1 className="text-sm tracking-widest mb-3">OAUTH CALLBACK</h1>
        {params.error ? (
          <p className="text-rose-300">Authorization failed: {params.error}</p>
        ) : (
          <p className="text-emerald-300">Authorization completed. This window will close automatically.</p>
        )}
      </div>
    </main>
  );
}
