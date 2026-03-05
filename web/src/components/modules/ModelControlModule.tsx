"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrainCircuit, RefreshCw, Sparkles, Route, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import {
  applyModelRecommendation,
  createModelRecommendation,
  getSettingsOverview,
  getModelControlMetrics,
  getModelControlPreferences,
  listModelControlTraces,
  listModelRecommendations,
  listProviderModels,
  listUserProviderCredentials,
  upsertModelControlPreference,
  upsertUserProviderCredential,
} from "@/lib/api/endpoints";
import type {
  AiInvocationMetrics,
  AiInvocationTraceRecord,
  ModelControlFeatureKey,
  ModelRecommendationRun,
  ProviderCredentialSelectionMode,
  ProviderName,
  ProviderModelCatalogEntry,
  UserModelSelectionPreference,
  UserProviderCredentialRecord,
  SettingsOverviewData,
} from "@/lib/api/types";

const PROVIDERS: ProviderName[] = ["openai", "gemini", "anthropic", "local"];
const FEATURE_ORDER: ModelControlFeatureKey[] = [
  "global_default",
  "assistant_chat",
  "assistant_context_run",
  "council_run",
  "execution_code",
  "execution_compute",
  "mission_plan_generation",
  "mission_execute_step",
];
const FEATURE_LABELS: Record<ModelControlFeatureKey, string> = {
  global_default: "Global Default",
  assistant_chat: "Assistant Chat",
  assistant_context_run: "Assistant Context Run",
  council_run: "Council Run",
  execution_code: "Execution Code",
  execution_compute: "Execution Compute",
  mission_plan_generation: "Mission Plan Generation",
  mission_execute_step: "Mission Execute Step",
};

type ModelPreferenceDraft = {
  provider: ProviderName | "auto";
  model: string;
  strict_provider: boolean;
  selection_mode: "auto" | "manual";
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function formatCredentialMode(mode: UserProviderCredentialRecord["selected_credential_mode"]): string {
  if (mode === "api_key") return "API key";
  if (mode === "oauth_official") return "OAuth (official)";
  return "none";
}

function formatFeatureLabel(feature: ModelControlFeatureKey): string {
  return FEATURE_LABELS[feature] ?? feature;
}

function toTraceStatusClass(trace: AiInvocationTraceRecord): string {
  return trace.success
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
    : "border-rose-500/30 bg-rose-500/10 text-rose-200";
}

function toCredentialSourceClass(source: UserProviderCredentialRecord["source"]): string {
  if (source === "user") return "border-cyan-500/40 bg-cyan-500/10 text-cyan-100";
  if (source === "workspace") return "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100";
  if (source === "env") return "border-amber-500/40 bg-amber-500/10 text-amber-100";
  return "border-white/20 bg-white/5 text-white/55";
}

function formatCooldownRemaining(cooldownUntil: string | null | undefined): string | null {
  if (!cooldownUntil) {
    return null;
  }
  const endsAt = Date.parse(cooldownUntil);
  if (!Number.isFinite(endsAt)) {
    return null;
  }
  const remainingMs = endsAt - Date.now();
  if (remainingMs <= 0) {
    return null;
  }
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}

function buildDefaultDraft(): ModelPreferenceDraft {
  return {
    provider: "auto",
    model: "",
    strict_provider: false,
    selection_mode: "auto",
  };
}

export function ModelControlModule() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [credentials, setCredentials] = useState<UserProviderCredentialRecord[]>([]);
  const [credentialModeDrafts, setCredentialModeDrafts] = useState<Partial<Record<ProviderName, ProviderCredentialSelectionMode>>>({});
  const [activeCredentialProvider, setActiveCredentialProvider] = useState<ProviderName | null>(null);

  const [modelCatalog, setModelCatalog] = useState<ProviderModelCatalogEntry[]>([]);
  const [preferences, setPreferences] = useState<UserModelSelectionPreference[]>([]);
  const [preferenceDrafts, setPreferenceDrafts] = useState<Partial<Record<ModelControlFeatureKey, ModelPreferenceDraft>>>({});
  const [savingFeature, setSavingFeature] = useState<ModelControlFeatureKey | null>(null);

  const [recommendations, setRecommendations] = useState<ModelRecommendationRun[]>([]);
  const [recommending, setRecommending] = useState(false);
  const [applyingRecommendationId, setApplyingRecommendationId] = useState<string | null>(null);
  const [recommendFeature, setRecommendFeature] = useState<ModelControlFeatureKey>("assistant_chat");
  const [recommendPrompt, setRecommendPrompt] = useState("");

  const [traces, setTraces] = useState<AiInvocationTraceRecord[]>([]);
  const [metrics, setMetrics] = useState<AiInvocationMetrics | null>(null);
  const [settingsOverview, setSettingsOverview] = useState<SettingsOverviewData | null>(null);

  const userCredentialMap = useMemo(() => {
    const map = new Map<ProviderName, UserProviderCredentialRecord>();
    for (const row of credentials) {
      map.set(row.provider, row);
    }
    return map;
  }, [credentials]);

  const preferenceMap = useMemo(() => {
    const map = new Map<ModelControlFeatureKey, UserModelSelectionPreference>();
    for (const row of preferences) {
      map.set(row.featureKey, row);
    }
    return map;
  }, [preferences]);

  const modelCatalogMap = useMemo(() => {
    const map = new Map<ProviderName, string[]>();
    for (const row of modelCatalog) {
      map.set(row.provider, row.models);
    }
    return map;
  }, [modelCatalog]);

  const providerRuntimeMap = useMemo(() => {
    const map = new Map<ProviderName, NonNullable<SettingsOverviewData["providers"]>[number]>();
    for (const row of settingsOverview?.providers ?? []) {
      map.set(row.provider, row);
    }
    return map;
  }, [settingsOverview]);

  const providerModelOverview = useMemo(() => {
    return PROVIDERS.map((provider) => {
      const runtime = providerRuntimeMap.get(provider) ?? null;
      const runtimeModel = runtime?.model ?? null;
      return {
        provider,
        models: Array.from(new Set([...(modelCatalogMap.get(provider) ?? []), ...(runtimeModel ? [runtimeModel] : [])])),
        runtime
      };
    });
  }, [modelCatalogMap, providerRuntimeMap]);

  const resolvePreferenceDraft = useCallback(
    (feature: ModelControlFeatureKey): ModelPreferenceDraft => {
      const existing = preferenceDrafts[feature];
      if (existing) {
        return existing;
      }
      const stored = preferenceMap.get(feature);
      if (stored) {
        return {
          provider: stored.provider,
          model: stored.modelId ?? "",
          strict_provider: stored.strictProvider,
          selection_mode: stored.selectionMode,
        };
      }
      return buildDefaultDraft();
    },
    [preferenceDrafts, preferenceMap]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [credentialsResult, modelsResult, preferencesResult, recommendationsResult, tracesResult, metricsResult, settingsResult] =
        await Promise.all([
          listUserProviderCredentials(),
          listProviderModels({ scope: "user" }),
          getModelControlPreferences(),
          listModelRecommendations({ limit: 30 }),
          listModelControlTraces({ limit: 40 }),
          getModelControlMetrics(),
          getSettingsOverview(),
        ]);
      setCredentials(credentialsResult.providers ?? []);
      setModelCatalog(modelsResult.providers ?? []);
      setPreferences(preferencesResult.preferences ?? []);
      setRecommendations(recommendationsResult.recommendations ?? []);
      setTraces(tracesResult.traces ?? []);
      setMetrics(metricsResult ?? null);
      setSettingsOverview(settingsResult ?? null);
      setCredentialModeDrafts({});
      setPreferenceDrafts({});
    } catch (refreshError) {
      setError(toErrorMessage(refreshError, "failed to load model control"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveCredentialMode = async (provider: ProviderName) => {
    const draftMode = credentialModeDrafts[provider];
    if (!draftMode) return;
    setError(null);
    setNotice(null);
    setActiveCredentialProvider(provider);
    try {
      await upsertUserProviderCredential(provider, {
        selected_credential_mode: draftMode,
      });
      setNotice(`${provider.toUpperCase()} credential mode updated: ${draftMode}`);
      await refresh();
    } catch (saveError) {
      setError(toErrorMessage(saveError, `failed to save ${provider} credential mode`));
    } finally {
      setActiveCredentialProvider(null);
    }
  };

  const savePreference = async (feature: ModelControlFeatureKey) => {
    const draft = resolvePreferenceDraft(feature);
    setError(null);
    setNotice(null);
    setSavingFeature(feature);
    const orchestratorOwned = draft.selection_mode === "auto";
    try {
      await upsertModelControlPreference(feature, {
        provider: orchestratorOwned ? "auto" : draft.provider,
        model: orchestratorOwned ? undefined : draft.model.trim().length > 0 ? draft.model.trim() : undefined,
        strict_provider: orchestratorOwned || draft.provider === "auto" ? false : draft.strict_provider,
        selection_mode: draft.selection_mode,
      });
      setNotice(
        `${formatFeatureLabel(feature)} routing updated: ${
          orchestratorOwned ? "orchestrator-managed" : "user-managed"
        }`
      );
      await refresh();
    } catch (saveError) {
      setError(toErrorMessage(saveError, `failed to save ${feature} preference`));
    } finally {
      setSavingFeature(null);
    }
  };

  const runRecommendation = async () => {
    const prompt = recommendPrompt.trim();
    if (!prompt || recommending) return;
    setError(null);
    setNotice(null);
    setRecommending(true);
    try {
      await createModelRecommendation({
        feature_key: recommendFeature,
        prompt,
      });
      setRecommendPrompt("");
      setNotice(`Recommendation created for ${formatFeatureLabel(recommendFeature)}`);
      await refresh();
    } catch (recommendError) {
      setError(toErrorMessage(recommendError, "failed to create recommendation"));
    } finally {
      setRecommending(false);
    }
  };

  const applyRecommendation = async (recommendationId: string) => {
    setError(null);
    setNotice(null);
    setApplyingRecommendationId(recommendationId);
    try {
      await applyModelRecommendation(recommendationId);
      setNotice("Recommendation applied");
      await refresh();
    } catch (applyError) {
      setError(toErrorMessage(applyError, "failed to apply recommendation"));
    } finally {
      setApplyingRecommendationId(null);
    }
  };

  return (
    <main className="w-full min-h-full bg-transparent text-white p-4 space-y-4">
      <header className="border-l-2 border-cyan-400/70 pl-3">
        <h2 className="text-sm font-mono font-bold tracking-widest text-cyan-100 flex items-center gap-2">
          <SlidersHorizontal size={14} /> MODEL CONTROL
        </h2>
        <p className="mt-1 text-xs text-white/65">
          Choose credential mode, set per-feature model defaults, request recommendations, and inspect invocation traces.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 h-8 px-3 rounded border border-white/20 text-xs text-white/80 hover:text-white hover:border-white/35"
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
        {error && <span className="text-xs text-rose-300">{error}</span>}
        {notice && <span className="text-xs text-emerald-300">{notice}</span>}
      </div>

      <section className="rounded-xl border border-white/12 bg-black/35 p-3">
        <h3 className="text-xs font-semibold tracking-wide text-white flex items-center gap-2">
          <ShieldCheck size={14} /> Credential Mode (Explicit)
        </h3>
        <p className="mt-1 text-xs text-white/60">`auto | api_key | oauth_official`</p>
        <div className="mt-3 space-y-2">
          {PROVIDERS.map((provider) => {
            const row = userCredentialMap.get(provider) ?? {
              provider,
              source: "none",
              selected_credential_mode: null,
              selected_user_credential_mode: "auto",
              credential_priority: "api_key_first",
              auth_access_token_expires_at: null,
              has_user_credential: false,
              has_user_api_key: false,
              has_user_oauth_official: false,
              has_user_oauth_token: false,
              user_updated_at: null,
            };
            const draftMode = credentialModeDrafts[provider] ?? row.selected_user_credential_mode;
            const oauthModesAllowed = provider === "openai" || provider === "gemini";
            return (
              <div key={`mode-${provider}`} className="rounded-lg border border-white/10 bg-black/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white">{provider.toUpperCase()}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${toCredentialSourceClass(row.source)}`}>
                      source: {row.source}
                    </span>
                    <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-100">
                      active: {formatCredentialMode(row.selected_credential_mode)}
                    </span>
                  </div>
                  <div className="text-[11px] text-white/55">
                    key={row.has_user_api_key ? "yes" : "no"} · oauth-official={row.has_user_oauth_official ? "yes" : "no"}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={draftMode}
                    onChange={(event) =>
                      setCredentialModeDrafts((prev) => ({
                        ...prev,
                        [provider]: event.target.value as ProviderCredentialSelectionMode,
                      }))
                    }
                    className="h-8 rounded border border-white/15 bg-black/60 px-2 text-xs text-white/85"
                  >
                    <option value="auto">auto</option>
                    <option value="api_key">api_key</option>
                    {oauthModesAllowed && <option value="oauth_official">oauth_official</option>}
                  </select>
                  <button
                    type="button"
                    onClick={() => void saveCredentialMode(provider)}
                    disabled={activeCredentialProvider === provider || draftMode === row.selected_user_credential_mode}
                    className="h-8 px-3 rounded border border-cyan-400/35 bg-cyan-500/10 text-xs text-cyan-100 disabled:opacity-40"
                  >
                    {activeCredentialProvider === provider ? "Saving..." : "Apply mode"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-white/12 bg-black/35 p-3">
        <h3 className="text-xs font-semibold tracking-wide text-white flex items-center gap-2">
          <BrainCircuit size={14} /> Feature Model Defaults
        </h3>
        <p className="mt-1 text-xs text-white/60">
          Pick who controls routing for each feature: <span className="text-cyan-200">Orchestrator</span> or{" "}
          <span className="text-fuchsia-200">User</span>. Resolution order: request override &gt; feature default &gt;
          global default &gt; auto.
        </p>
        <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/55">Discovered Models (Auto)</p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {providerModelOverview.map(({ provider, models, runtime }) => (
              <div key={`provider-overview-${provider}`} className="rounded border border-white/10 bg-black/35 p-2">
                <div className="flex flex-wrap items-center gap-1">
                  <p className="text-[11px] font-semibold text-white/85">{provider.toUpperCase()}</p>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      runtime?.enabled
                        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                        : "border-rose-500/35 bg-rose-500/10 text-rose-200"
                    }`}
                  >
                    {runtime?.enabled ? "enabled" : "disabled"}
                  </span>
                  {formatCooldownRemaining(runtime?.cooldown_until) && (
                    <span className="rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                      cooldown {formatCooldownRemaining(runtime?.cooldown_until)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-white/45">
                  success={Math.round(runtime?.success_rate_pct ?? 0)}% · attempts={runtime?.attempts ?? 0} · failures=
                  {runtime?.health_failure_count ?? runtime?.failures ?? 0}
                </p>
                {runtime?.reason && <p className="mt-1 text-[10px] text-rose-200/90">reason: {runtime.reason}</p>}
                {runtime?.cooldown_reason && (
                  <p className="mt-1 text-[10px] text-amber-200/90">cooldown: {runtime.cooldown_reason}</p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {models.length > 0 ? (
                    models.map((modelId) => (
                      <span
                        key={`provider-overview-model-${provider}-${modelId}`}
                        className="rounded border border-cyan-500/25 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-100"
                      >
                        {modelId}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-white/40">no discovered models</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {FEATURE_ORDER.map((feature) => {
            const draft = resolvePreferenceDraft(feature);
            const orchestratorOwned = draft.selection_mode === "auto";
            const models = draft.provider === "auto" ? [] : modelCatalogMap.get(draft.provider as ProviderName) ?? [];
            const canEditModel = !orchestratorOwned && draft.provider !== "auto";
            const usesCustomModel = draft.model.trim().length > 0 && !models.includes(draft.model.trim());
            const modelSelectValue = !canEditModel
              ? ""
              : usesCustomModel
              ? "__custom__"
              : draft.model.trim().length > 0
              ? draft.model.trim()
              : "";
            return (
              <div key={`pref-${feature}`} className="rounded-lg border border-white/10 bg-black/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">{formatFeatureLabel(feature)}</p>
                  <span className="text-[11px] text-white/55">
                    routing={orchestratorOwned ? "orchestrator-managed" : "user-managed"}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[180px_220px_minmax(0,1fr)_auto_auto]">
                  <select
                    value={draft.provider}
                    onChange={(event) =>
                      setPreferenceDrafts((prev) => ({
                        ...prev,
                        [feature]: {
                          ...draft,
                          provider: event.target.value as ProviderName | "auto",
                          strict_provider: event.target.value === "auto" ? false : draft.strict_provider,
                        },
                      }))
                    }
                    className="h-8 rounded border border-white/15 bg-black/60 px-2 text-xs text-white/85"
                    disabled={orchestratorOwned}
                  >
                    <option value="auto">auto</option>
                    {PROVIDERS.map((provider) => (
                      <option key={`${feature}-provider-${provider}`} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </select>
                  <select
                    value={draft.selection_mode}
                    onChange={(event) =>
                      setPreferenceDrafts((prev) => ({
                        ...prev,
                        [feature]: {
                          ...draft,
                          selection_mode: event.target.value as "auto" | "manual",
                          provider:
                            event.target.value === "auto"
                              ? "auto"
                              : draft.provider === "auto"
                              ? "openai"
                              : draft.provider,
                          model: event.target.value === "auto" ? "" : draft.model,
                          strict_provider: event.target.value === "auto" ? false : draft.strict_provider,
                        },
                      }))
                    }
                    className="h-8 rounded border border-white/15 bg-black/60 px-2 text-xs text-white/85"
                  >
                    <option value="auto">orchestrator-managed</option>
                    <option value="manual">user-managed</option>
                  </select>
                  <select
                    value={modelSelectValue}
                    onChange={(event) => {
                      const selected = event.target.value;
                      setPreferenceDrafts((prev) => ({
                        ...prev,
                        [feature]: {
                          ...draft,
                          model:
                            selected === "__custom__"
                              ? usesCustomModel
                                ? draft.model
                                : ""
                              : selected === ""
                              ? ""
                              : selected,
                        },
                      }));
                    }}
                    className="h-8 rounded border border-white/15 bg-black/60 px-2 text-xs text-white/85"
                    disabled={!canEditModel}
                  >
                    <option value="">(auto model)</option>
                    {models.map((modelId) => (
                      <option key={`${feature}-model-option-${modelId}`} value={modelId}>
                        {modelId}
                      </option>
                    ))}
                    <option value="__custom__">custom model id...</option>
                  </select>
                  <input
                    type="text"
                    value={draft.model}
                    onChange={(event) =>
                      setPreferenceDrafts((prev) => ({
                        ...prev,
                        [feature]: {
                          ...draft,
                          model: event.target.value,
                        },
                      }))
                    }
                    placeholder="model id (optional)"
                    className="h-8 rounded border border-white/15 bg-black/60 px-2 text-xs text-white/85"
                    disabled={!canEditModel}
                  />
                  <label className="inline-flex items-center gap-1 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={draft.provider === "auto" ? false : draft.strict_provider}
                      onChange={(event) =>
                        setPreferenceDrafts((prev) => ({
                          ...prev,
                          [feature]: {
                            ...draft,
                            strict_provider: event.target.checked,
                          },
                        }))
                      }
                      disabled={orchestratorOwned || draft.provider === "auto"}
                      className="accent-cyan-400"
                    />
                    strict
                  </label>
                  <button
                    type="button"
                    onClick={() => void savePreference(feature)}
                    disabled={savingFeature === feature}
                    className="h-8 px-3 rounded border border-cyan-400/35 bg-cyan-500/10 text-xs text-cyan-100 disabled:opacity-40"
                  >
                    {savingFeature === feature ? "Saving..." : "Save"}
                  </button>
                  {!orchestratorOwned && draft.provider !== "auto" && (
                    <div className="lg:col-span-5 flex flex-wrap items-center gap-1">
                      {models.length > 0 ? (
                        models.map((modelId) => (
                          <button
                            key={`${feature}-model-suggestion-${modelId}`}
                            type="button"
                            onClick={() =>
                              setPreferenceDrafts((prev) => ({
                                ...prev,
                                [feature]: {
                                  ...draft,
                                  model: modelId,
                                },
                              }))
                            }
                            className={`h-6 px-2 rounded border text-[11px] ${
                              draft.model === modelId
                                ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100"
                                : "border-white/15 bg-black/50 text-white/70 hover:text-white hover:border-white/30"
                            }`}
                          >
                            {modelId}
                          </button>
                        ))
                      ) : (
                        <span className="text-[11px] text-white/45">
                          no discovered models for {draft.provider} yet
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-white/12 bg-black/35 p-3">
        <h3 className="text-xs font-semibold tracking-wide text-white flex items-center gap-2">
          <Sparkles size={14} /> Recommender
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
          <select
            value={recommendFeature}
            onChange={(event) => setRecommendFeature(event.target.value as ModelControlFeatureKey)}
            className="h-8 rounded border border-white/15 bg-black/60 px-2 text-xs text-white/85"
          >
            {FEATURE_ORDER.filter((feature) => feature !== "global_default").map((feature) => (
              <option key={`recommend-feature-${feature}`} value={feature}>
                {formatFeatureLabel(feature)}
              </option>
            ))}
          </select>
          <textarea
            value={recommendPrompt}
            onChange={(event) => setRecommendPrompt(event.target.value)}
            rows={3}
            placeholder="Paste prompt or task context for recommendation..."
            className="rounded border border-white/15 bg-black/60 px-2 py-1.5 text-xs text-white/85 resize-y min-h-[64px]"
          />
          <button
            type="button"
            onClick={() => void runRecommendation()}
            disabled={recommending || recommendPrompt.trim().length === 0}
            className="h-8 px-3 rounded border border-fuchsia-400/35 bg-fuchsia-500/10 text-xs text-fuchsia-100 disabled:opacity-40 self-start"
          >
            {recommending ? "Recommending..." : "Recommend"}
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {recommendations.slice(0, 12).map((row) => (
            <div key={`recommend-${row.id}`} className="rounded-lg border border-white/10 bg-black/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">
                  {formatFeatureLabel(row.featureKey)} → {row.recommendedProvider}/{row.recommendedModelId}
                </p>
                <button
                  type="button"
                  onClick={() => void applyRecommendation(row.id)}
                  disabled={Boolean(row.appliedAt) || applyingRecommendationId === row.id}
                  className="h-7 px-2 rounded border border-cyan-400/35 bg-cyan-500/10 text-[11px] text-cyan-100 disabled:opacity-40"
                >
                  {row.appliedAt ? "Applied" : applyingRecommendationId === row.id ? "Applying..." : "Apply"}
                </button>
              </div>
              <p className="mt-1 text-xs text-white/70">{row.rationaleText}</p>
              <p className="mt-1 text-[11px] text-white/45">
                created {new Date(row.createdAt).toLocaleString()}
                {row.appliedAt ? ` · applied ${new Date(row.appliedAt).toLocaleString()}` : ""}
              </p>
            </div>
          ))}
          {!loading && recommendations.length === 0 && (
            <p className="text-xs text-white/50">No recommendations yet.</p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-white/12 bg-black/35 p-3">
        <h3 className="text-xs font-semibold tracking-wide text-white flex items-center gap-2">
          <Route size={14} /> Recent AI Traces
        </h3>
        {metrics && (
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded border border-white/10 bg-black/40 p-2">
              <p className="text-[10px] text-white/45 uppercase tracking-widest">Total</p>
              <p className="text-sm text-white font-semibold">{metrics.total}</p>
            </div>
            <div className="rounded border border-white/10 bg-black/40 p-2">
              <p className="text-[10px] text-white/45 uppercase tracking-widest">Success</p>
              <p className="text-sm text-emerald-300 font-semibold">{metrics.successCount}</p>
            </div>
            <div className="rounded border border-white/10 bg-black/40 p-2">
              <p className="text-[10px] text-white/45 uppercase tracking-widest">Failure</p>
              <p className="text-sm text-rose-300 font-semibold">{metrics.failureCount}</p>
            </div>
            <div className="rounded border border-white/10 bg-black/40 p-2">
              <p className="text-[10px] text-white/45 uppercase tracking-widest">P95 (ms)</p>
              <p className="text-sm text-white font-semibold">{Math.round(metrics.p95LatencyMs)}</p>
            </div>
          </div>
        )}

        <div className="mt-3 space-y-2">
          {traces.slice(0, 24).map((trace) => (
            <div key={`trace-${trace.id}`} className={`rounded-lg border p-2 ${toTraceStatusClass(trace)}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <p className="font-semibold">
                  {formatFeatureLabel(trace.featureKey as ModelControlFeatureKey)} · {trace.resolvedProvider ?? "none"}/{trace.resolvedModel ?? "none"}
                </p>
                <span>{trace.latencyMs}ms</span>
              </div>
              <p className="mt-1 text-[11px] text-white/80">
                request={trace.requestProvider}/{trace.requestModel ?? "default"} · credential={trace.credentialMode ?? "none"}({trace.credentialSource})
              </p>
              <p className="mt-1 text-[11px] text-white/60">{new Date(trace.createdAt).toLocaleString()}</p>
            </div>
          ))}
          {!loading && traces.length === 0 && <p className="text-xs text-white/50">No traces recorded yet.</p>}
        </div>
      </section>
    </main>
  );
}
