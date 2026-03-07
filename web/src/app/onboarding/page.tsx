"use client";

import React, { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, Key, ShieldCheck } from "lucide-react";
import { getHealth } from "@/lib/api/endpoints";
import { ApiRequestError } from "@/lib/api/client";
import { useLocale } from "@/components/providers/LocaleProvider";

export default function OnboardingPage() {
    const router = useRouter();
    const { t } = useLocale();
    const [isInitializing, setIsInitializing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleInitialize = useCallback(async () => {
        setIsInitializing(true);
        setError(null);
        try {
            await getHealth();
            router.push("/");
        } catch (err) {
            if (err instanceof ApiRequestError) {
                setError(`${err.code}: ${err.message}`);
            } else {
                setError(t("onboarding.error.health"));
            }
        } finally {
            setIsInitializing(false);
        }
    }, [router, t]);

    return (
        <div className="w-full min-h-screen bg-black text-white flex items-center justify-center p-8 absolute inset-0 z-[200]">

            <div className="max-w-xl w-full">
                {/* Boot Sequence Header */}
                <div className="mb-12 text-center">
                    <div className="w-16 h-16 mx-auto rounded-full border border-cyan-500/50 flex items-center justify-center p-2 mb-6">
                        <div className="w-full h-full bg-cyan-400 rounded-full shadow-[0_0_20px_rgba(0,255,255,0.6)] animate-pulse"></div>
                    </div>
                    <h1 className="text-3xl font-mono font-bold tracking-[0.3em] text-white">J.A.R.V.I.S.</h1>
                    <p className="text-cyan-500 font-mono text-sm tracking-widest mt-2 uppercase">{t("onboarding.bootSequence")}</p>
                </div>

                {/* Authorization Panel */}
                <div className="glass-panel p-8 rounded-xl border border-white/10">
                    <h2 className="text-lg font-bold mb-6 flex items-center gap-3">
                        <ShieldCheck className="text-emerald-500" /> {t("onboarding.authRequired")}
                    </h2>

                    <div className="space-y-4 mb-8">
                        <div className="p-4 bg-white/5 border border-white/10 rounded-lg flex items-center gap-4 hover:border-white/30 transition-colors cursor-pointer group">
                            <div className="p-3 rounded-full bg-white/10 text-white group-hover:text-cyan-400 transition-colors">
                                <LogIn size={20} />
                            </div>
                            <div>
                                <p className="font-bold text-sm">{t("onboarding.ssoTitle")}</p>
                                <p className="text-xs text-white/50">{t("onboarding.ssoSubtitle")}</p>
                            </div>
                        </div>

                        <div className="p-4 bg-white/5 border border-white/10 rounded-lg flex items-center gap-4 hover:border-white/30 transition-colors cursor-pointer group">
                            <div className="p-3 rounded-full bg-white/10 text-white group-hover:text-amber-400 transition-colors">
                                <Key size={20} />
                            </div>
                            <div>
                                <p className="font-bold text-sm">{t("onboarding.localAdminTitle")}</p>
                                <p className="text-xs text-white/50">{t("onboarding.localAdminSubtitle")}</p>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-white/10 pt-6 text-center">
                        <p className="text-[10px] font-mono text-white/30 mb-4 tracking-widest uppercase">
                            {t("onboarding.disclaimer")}
                        </p>
                        <button
                            onClick={() => void handleInitialize()}
                            disabled={isInitializing}
                            className="inline-block w-full text-center bg-cyan-500 hover:bg-cyan-400 text-black font-mono font-bold tracking-widest py-3 rounded uppercase transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isInitializing ? t("onboarding.checkingBackend") : t("onboarding.initializeConnection")}
                        </button>
                        {error && <p className="mt-3 text-sm font-mono text-red-400">{error}</p>}
                    </div>
                </div>
            </div>

        </div>
    );
}
