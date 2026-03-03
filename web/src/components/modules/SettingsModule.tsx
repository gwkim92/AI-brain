"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Settings2, Shield, RadioTower, KeyRound, RefreshCw, Clock3, Database, Route, Plus } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import {
  deleteAdminProviderCredential,
  getSettingsOverview,
  listAdminProviderCredentials,
  testAdminProviderConnection,
  upsertAdminProviderCredential,
  getModelRegistry,
  getTaskModelPolicies,
  upsertTaskModelPolicy,
  type ModelRegistryEntry,
  type TaskModelPolicyEntry,
} from "@/lib/api/endpoints";
import type {
  ProviderConnectionTestResult,
  ProviderCredentialRecord,
  ProviderName,
  SettingsOverviewData,
} from "@/lib/api/types";
import { hasMinRole, useCurrentRole } from "@/lib/auth/role";
import { AsyncState } from "@/components/ui/AsyncState";
import { ConnectorHealthCard } from "@/components/ui/ConnectorHealthCard";
import {
  HUD_MISSION_AUTO_FOCUS_HOLD_SECONDS_KEY,
  HUD_MISSION_AUTO_FOCUS_KEY,
  HUD_PREFERENCE_CHANGED_EVENT,
  HUD_VISUAL_CORE_ENABLED_KEY,
  parseMissionAutoFocusHoldSecondsInput,
  readMissionAutoFocusEnabledPreference,
  readMissionAutoFocusHoldSecondsPreference,
  readVisualCoreEnabledPreference,
  writeMissionAutoFocusEnabledPreference,
  writeMissionAutoFocusHoldSecondsPreference,
  writeVisualCoreEnabledPreference,
} from "@/lib/hud/preferences";

const PROVIDER_ORDER: ProviderName[] = ["openai", "gemini", "anthropic", "local"];

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return fallback;
}

export function SettingsModule() {
  const role = useCurrentRole();
  const isAdmin = hasMinRole(role, "admin");

  const [settingsOverview, setSettingsOverview] = useState<SettingsOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providerCredentials, setProviderCredentials] = useState<ProviderCredentialRecord[]>([]);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [credentialNotice, setCredentialNotice] = useState<string | null>(null);
  const [credentialDrafts, setCredentialDrafts] = useState<Partial<Record<ProviderName, string>>>({});
  const [activeSaveProvider, setActiveSaveProvider] = useState<ProviderName | null>(null);
  const [activeDeleteProvider, setActiveDeleteProvider] = useState<ProviderName | null>(null);
  const [activeTestProvider, setActiveTestProvider] = useState<ProviderName | null>(null);
  const [connectionTests, setConnectionTests] = useState<Partial<Record<ProviderName, ProviderConnectionTestResult>>>({});
  const [hudAutoFocusDefault, setHudAutoFocusDefault] = useState(true);
  const [hudHoldSecondsDraft, setHudHoldSecondsDraft] = useState("90");
  const [hudRuntimeNotice, setHudRuntimeNotice] = useState<string | null>(null);
  const [visualCoreEnabled, setVisualCoreEnabled] = useState(true);

  const [registryModels, setRegistryModels] = useState<ModelRegistryEntry[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [policies, setPolicies] = useState<TaskModelPolicyEntry[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [policyDraft, setPolicyDraft] = useState({ task_type: "", provider: "openai", model_id: "", tier: 1, priority: 0 });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const overview = await getSettingsOverview();
      setSettingsOverview(overview);
    } catch (err) {
      setError(toErrorMessage(err, "failed to load settings"));
      setSettingsOverview(null);
    }

    if (isAdmin) {
      setCredentialLoading(true);
      setCredentialError(null);
      try {
        const credentialData = await listAdminProviderCredentials();
        setProviderCredentials(credentialData.providers);
        setCredentialError(null);
      } catch (err) {
        setProviderCredentials([]);
        setCredentialError(toErrorMessage(err, "failed to load provider credentials"));
      } finally {
        setCredentialLoading(false);
      }
    } else {
      setProviderCredentials([]);
      setCredentialLoading(false);
      setCredentialError(null);
      setCredentialNotice(null);
    }
    setLoading(false);

    setRegistryLoading(true);
    try {
      const reg = await getModelRegistry();
      setRegistryModels(reg.models ?? []);
    } catch { setRegistryModels([]); }
    setRegistryLoading(false);

    setPoliciesLoading(true);
    try {
      const pol = await getTaskModelPolicies();
      setPolicies(pol.policies ?? []);
    } catch { setPolicies([]); }
    setPoliciesLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const timer = window.setTimeout(() => {
      setHudAutoFocusDefault(readMissionAutoFocusEnabledPreference());
      setHudHoldSecondsDraft(String(readMissionAutoFocusHoldSecondsPreference()));
      setVisualCoreEnabled(readVisualCoreEnabledPreference());
    }, 0);

    const onHudPreferenceChanged = (event: Event) => {
      const custom = event as CustomEvent<{ key?: string }>;
      const key = custom.detail?.key;
      if (key === HUD_MISSION_AUTO_FOCUS_KEY) {
        setHudAutoFocusDefault(readMissionAutoFocusEnabledPreference());
        return;
      }
      if (key === HUD_MISSION_AUTO_FOCUS_HOLD_SECONDS_KEY) {
        setHudHoldSecondsDraft(String(readMissionAutoFocusHoldSecondsPreference()));
        return;
      }
      if (key === HUD_VISUAL_CORE_ENABLED_KEY) {
        setVisualCoreEnabled(readVisualCoreEnabledPreference());
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === HUD_MISSION_AUTO_FOCUS_KEY) {
        setHudAutoFocusDefault(readMissionAutoFocusEnabledPreference());
        return;
      }
      if (event.key === HUD_MISSION_AUTO_FOCUS_HOLD_SECONDS_KEY) {
        setHudHoldSecondsDraft(String(readMissionAutoFocusHoldSecondsPreference()));
        return;
      }
      if (event.key === HUD_VISUAL_CORE_ENABLED_KEY) {
        setVisualCoreEnabled(readVisualCoreEnabledPreference());
      }
    };

    window.addEventListener(HUD_PREFERENCE_CHANGED_EVENT, onHudPreferenceChanged as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(HUD_PREFERENCE_CHANGED_EVENT, onHudPreferenceChanged as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const providerCredentialRows = useMemo(() => {
    const map = new Map(providerCredentials.map((item) => [item.provider, item]));
    return PROVIDER_ORDER.map(
      (provider): ProviderCredentialRecord =>
        map.get(provider) ?? {
          provider,
          has_key: false,
          source: "none",
          updated_at: null,
        }
    );
  }, [providerCredentials]);

  const cards = useMemo(() => {
    const rows = (settingsOverview?.providers ?? []).map((provider) => ({
      name: `AI ${provider.provider.toUpperCase()}`,
      status: (provider.enabled ? (provider.attempts > 0 ? "healthy" : "degraded") : "error") as
        | "healthy"
        | "degraded"
        | "error",
      latencyMs: provider.attempts > 0 ? Math.round(provider.avg_latency_ms) : 0,
      lastSync: provider.last_attempt_at ? new Date(provider.last_attempt_at).toLocaleTimeString() : "no attempts",
      description: provider.enabled
        ? `model=${provider.model ?? "default"} · success=${provider.success_rate_pct}% (${provider.successes}/${provider.attempts})`
        : `Disabled${provider.reason ? ` (${provider.reason})` : ""}`,
    }));

    if (settingsOverview) {
      rows.unshift({
        name: "Backend Core Health",
        status: (settingsOverview.backend.db === "up" ? "healthy" : settingsOverview.backend.db === "n/a" ? "degraded" : "error") as
          | "healthy"
          | "degraded"
          | "error",
        latencyMs: 0,
        lastSync: new Date(settingsOverview.backend.now).toLocaleTimeString(),
        description: `env=${settingsOverview.backend.env} store=${settingsOverview.backend.store} db=${settingsOverview.backend.db}`,
      });
    }

    return rows;
  }, [settingsOverview]);

  const policyItems = useMemo(() => {
    if (!settingsOverview) {
      return [
        "High-risk operations require explicit approval.",
        "Provider failover is enabled in auto mode.",
      ];
    }

    return [
      settingsOverview.policies.high_risk_requires_approval
        ? "High-risk operations require explicit approval."
        : "High-risk operations may run without approval.",
      `Approval max age: ${settingsOverview.policies.approval_max_age_hours}h (after this window, execution is rejected).`,
      `High-risk allowed roles: ${settingsOverview.policies.high_risk_allowed_roles.join(", ")}.`,
      settingsOverview.policies.provider_failover_auto
        ? "Provider failover is enabled in auto mode."
        : "Provider failover is disabled.",
      settingsOverview.policies.auth_required
        ? "API authentication is required."
        : "API authentication is optional (development mode).",
    ];
  }, [settingsOverview]);

  const onSaveProviderKey = async (provider: ProviderName) => {
    const apiKey = credentialDrafts[provider]?.trim() ?? "";
    if (apiKey.length < 8) {
      setCredentialError("api key must be at least 8 chars");
      return;
    }

    setCredentialError(null);
    setCredentialNotice(null);
    setActiveSaveProvider(provider);
    try {
      await upsertAdminProviderCredential(provider, apiKey);
      setCredentialDrafts((prev) => ({
        ...prev,
        [provider]: "",
      }));
      setActiveTestProvider(provider);
      try {
        const testResult = await testAdminProviderConnection(provider);
        setConnectionTests((prev) => ({
          ...prev,
          [provider]: testResult,
        }));
        setCredentialNotice(
          testResult.ok
            ? `${provider.toUpperCase()} key saved · connection ok (${testResult.model_count} models)`
            : `${provider.toUpperCase()} key saved · test failed${testResult.reason ? `: ${testResult.reason}` : ""}`
        );
      } catch (testErr) {
        setConnectionTests((prev) => ({
          ...prev,
          [provider]: undefined,
        }));
        setCredentialNotice(
          `${provider.toUpperCase()} key saved · test error (${toErrorMessage(testErr, "connection test failed")})`
        );
      } finally {
        setActiveTestProvider(null);
      }
      await refresh();
    } catch (err) {
      setCredentialError(toErrorMessage(err, `failed to save ${provider} key`));
    } finally {
      setActiveSaveProvider(null);
    }
  };

  const onDeleteStoredProviderKey = async (provider: ProviderName) => {
    setCredentialError(null);
    setCredentialNotice(null);
    setActiveDeleteProvider(provider);
    try {
      const result = await deleteAdminProviderCredential(provider);
      if (result.has_key && result.source === "env") {
        setCredentialNotice(`${provider.toUpperCase()} stored key removed (ENV key is active)`);
      } else {
        setCredentialNotice(`${provider.toUpperCase()} key removed`);
      }
      setConnectionTests((prev) => ({
        ...prev,
        [provider]: undefined,
      }));
      await refresh();
    } catch (err) {
      setCredentialError(toErrorMessage(err, `failed to delete ${provider} key`));
    } finally {
      setActiveDeleteProvider(null);
    }
  };

  const onTestProviderConnection = async (provider: ProviderName) => {
    setCredentialError(null);
    setCredentialNotice(null);
    setActiveTestProvider(provider);
    try {
      const result = await testAdminProviderConnection(provider);
      setConnectionTests((prev) => ({
        ...prev,
        [provider]: result,
      }));
      if (result.ok) {
        setCredentialNotice(`${provider.toUpperCase()} connection test passed`);
      } else {
        setCredentialNotice(`${provider.toUpperCase()} connection test failed${result.reason ? `: ${result.reason}` : ""}`);
      }
      await refresh();
    } catch (err) {
      setCredentialError(toErrorMessage(err, `failed to test ${provider} connection`));
    } finally {
      setActiveTestProvider(null);
    }
  };

  const onToggleHudAutoFocusDefault = () => {
    const next = !hudAutoFocusDefault;
    writeMissionAutoFocusEnabledPreference(next);
    setHudAutoFocusDefault(next);
    setHudRuntimeNotice(`HUD auto focus default set to ${next ? "ON" : "OFF"}`);
  };

  const onToggleVisualCore = () => {
    const next = !visualCoreEnabled;
    writeVisualCoreEnabledPreference(next);
    setVisualCoreEnabled(next);
    setHudRuntimeNotice(`Visual Core 3D ${next ? "enabled" : "disabled"} (takes effect on next load)`);
  };

  const onSaveHudHoldSeconds = () => {
    const normalized = parseMissionAutoFocusHoldSecondsInput(hudHoldSecondsDraft);
    writeMissionAutoFocusHoldSecondsPreference(normalized);
    setHudHoldSecondsDraft(String(normalized));
    setHudRuntimeNotice(`Manual hold updated to ${normalized}s`);
  };

  const onSavePolicy = async () => {
    if (!policyDraft.task_type.trim() || !policyDraft.model_id.trim()) {
      setPolicyError("task_type and model_id are required");
      return;
    }
    setPolicyError(null);
    setPolicyNotice(null);
    try {
      await upsertTaskModelPolicy({
        task_type: policyDraft.task_type.trim(),
        provider: policyDraft.provider,
        model_id: policyDraft.model_id.trim(),
        tier: policyDraft.tier,
        priority: policyDraft.priority,
        is_active: true,
      });
      setPolicyNotice(`Policy saved: ${policyDraft.task_type} → ${policyDraft.provider}/${policyDraft.model_id}`);
      setPolicyDraft({ task_type: "", provider: "openai", model_id: "", tier: 1, priority: 0 });
      setShowPolicyForm(false);
      const pol = await getTaskModelPolicies();
      setPolicies(pol.policies ?? []);
    } catch (err) {
      setPolicyError(toErrorMessage(err, "failed to save policy"));
    }
  };

  const onTogglePolicy = async (p: TaskModelPolicyEntry) => {
    try {
      await upsertTaskModelPolicy({
        task_type: p.task_type,
        provider: p.provider,
        model_id: p.model_id,
        tier: p.tier,
        priority: p.priority,
        is_active: !p.is_active,
      });
      const pol = await getTaskModelPolicies();
      setPolicies(pol.policies ?? []);
    } catch (err) {
      setPolicyError(toErrorMessage(err, "failed to toggle policy"));
    }
  };

  return (
    <main className="w-full min-h-full bg-transparent text-white p-4 flex flex-col">
      <header className="mb-4 border-l-2 border-white/50 pl-3">
        <h2 className="text-sm font-mono font-bold tracking-widest text-white flex items-center gap-2">
          <Settings2 size={14} /> SYSTEM SETTINGS
        </h2>
      </header>

      <AsyncState
        loading={loading}
        error={error}
        empty={false}
        loadingText="Loading settings..."
        onRetry={() => void refresh()}
        className="mb-3"
      />

      <section className="mb-4">
        <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase mb-2 flex items-center gap-2">
          <RadioTower size={12} /> Connectors
        </h3>
        <div className="grid grid-cols-1 gap-3 pr-1">
          {cards.map((card) => (
            <ConnectorHealthCard
              key={card.name}
              name={card.name}
              status={card.status}
              latencyMs={card.latencyMs}
              lastSync={card.lastSync}
              description={card.description}
            />
          ))}
          {!loading && !error && cards.length === 0 && (
            <div className="text-sm font-mono text-white/40 border border-white/10 rounded p-4">No connector data.</div>
          )}
        </div>
      </section>

      <section className="mb-4 border border-white/10 rounded p-3 bg-black/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase flex items-center gap-2">
            <KeyRound size={12} /> Provider API Keys
          </h3>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1 h-7 px-2 rounded border border-white/15 text-[10px] font-mono text-white/70 hover:text-white hover:border-white/30"
            >
              <RefreshCw size={11} /> Refresh
            </button>
          )}
        </div>

        {isAdmin ? (
          <div className="space-y-2">
            {providerCredentialRows.map((row) => (
              <div key={row.provider} className="border border-white/10 rounded p-2 bg-black/35">
                <div className="flex items-center justify-between text-xs font-mono mb-2">
                  <span>{row.provider.toUpperCase()}</span>
                  <span
                    className={
                      row.source === "stored"
                        ? "text-cyan-300"
                        : row.source === "env"
                          ? "text-amber-300"
                          : "text-white/40"
                    }
                  >
                    {row.source === "stored" ? "stored" : row.source === "env" ? "env" : "none"}
                  </span>
                </div>
                <div className="flex flex-col lg:flex-row gap-2">
                  <input
                    type="password"
                    placeholder={`${row.provider.toUpperCase()} API key`}
                    value={credentialDrafts[row.provider] ?? ""}
                    onChange={(event) =>
                      setCredentialDrafts((prev) => ({
                        ...prev,
                        [row.provider]: event.target.value,
                      }))
                    }
                    className="h-8 flex-1 rounded border border-white/15 bg-black/50 px-2 text-xs font-mono"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void onSaveProviderKey(row.provider)}
                      disabled={(credentialDrafts[row.provider]?.trim().length ?? 0) < 8 || activeSaveProvider === row.provider}
                      className="h-8 px-3 rounded border border-cyan-400/40 bg-cyan-500/15 text-cyan-200 text-[10px] font-mono tracking-widest disabled:opacity-40"
                    >
                      {activeSaveProvider === row.provider ? "SAVING..." : "SAVE"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onTestProviderConnection(row.provider)}
                      disabled={activeTestProvider === row.provider}
                      className="h-8 px-3 rounded border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 text-[10px] font-mono tracking-widest disabled:opacity-40"
                    >
                      {activeTestProvider === row.provider ? "TESTING..." : "TEST"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteStoredProviderKey(row.provider)}
                      disabled={row.source !== "stored" || activeDeleteProvider === row.provider}
                      className="h-8 px-3 rounded border border-white/20 bg-white/10 text-white/80 text-[10px] font-mono tracking-widest disabled:opacity-40"
                    >
                      {activeDeleteProvider === row.provider ? "REMOVING..." : "REMOVE STORED"}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[10px] font-mono text-white/45">
                  {row.has_key ? "key available" : "no key"} ·{" "}
                  {row.updated_at ? `updated ${new Date(row.updated_at).toLocaleString()}` : "no stored timestamp"}
                </p>
                {connectionTests[row.provider] && (
                  <p
                    className={`mt-1 text-[10px] font-mono ${
                      connectionTests[row.provider]?.ok ? "text-emerald-300" : "text-amber-300"
                    }`}
                  >
                    test {connectionTests[row.provider]?.ok ? "ok" : "failed"} · {connectionTests[row.provider]?.latency_ms ?? 0}ms · models{" "}
                    {connectionTests[row.provider]?.model_count ?? 0}
                    {connectionTests[row.provider]?.reason
                      ? ` · ${connectionTests[row.provider]?.reason}`
                      : connectionTests[row.provider]?.sampled_models?.length
                        ? ` · ${connectionTests[row.provider]?.sampled_models.slice(0, 3).join(", ")}`
                        : ""}
                  </p>
                )}
              </div>
            ))}
            {(credentialLoading || activeSaveProvider || activeDeleteProvider || activeTestProvider) && (
              <p className="text-[10px] font-mono text-white/50">syncing provider credentials...</p>
            )}
            {credentialError && <p className="text-[10px] font-mono text-rose-300">{credentialError}</p>}
            {credentialNotice && <p className="text-[10px] font-mono text-emerald-300">{credentialNotice}</p>}
          </div>
        ) : (
          <p className="text-xs font-mono text-white/50">
            Provider API key registration is admin-only. Sign in with an admin account to manage keys.
          </p>
        )}
      </section>

      <section className="border border-white/10 rounded p-3 bg-black/30">
        <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase mb-2 flex items-center gap-2">
          <Clock3 size={12} /> HUD Runtime
        </h3>
        <div className="space-y-2 text-xs text-white/70 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-white/50">Visual Core 3D</span>
            <button
              type="button"
              onClick={onToggleVisualCore}
              className={`h-7 px-2 rounded border text-[10px] font-mono tracking-widest ${
                visualCoreEnabled
                  ? "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200"
                  : "border-white/20 bg-white/10 text-white/80"
              }`}
            >
              {visualCoreEnabled ? "ON" : "OFF"}
            </button>
            <span className="text-[10px] text-white/40">disable to reduce GPU usage</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-white/50">Auto focus default</span>
            <button
              type="button"
              onClick={onToggleHudAutoFocusDefault}
              className={`h-7 px-2 rounded border text-[10px] font-mono tracking-widest ${
                hudAutoFocusDefault
                  ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-200"
                  : "border-white/20 bg-white/10 text-white/80"
              }`}
            >
              {hudAutoFocusDefault ? "ON" : "OFF"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-white/50">Manual hold seconds</span>
            <input
              type="number"
              min={15}
              max={600}
              step={1}
              value={hudHoldSecondsDraft}
              onChange={(event) => setHudHoldSecondsDraft(event.target.value)}
              className="h-7 w-24 rounded border border-white/15 bg-black/50 px-2 text-[11px] font-mono"
            />
            <button
              type="button"
              onClick={onSaveHudHoldSeconds}
              className="h-7 px-2 rounded border border-cyan-400/40 bg-cyan-500/15 text-cyan-200 text-[10px] font-mono tracking-widest"
            >
              SAVE
            </button>
            <span className="text-white/40">range 15-600s</span>
          </div>
          {hudRuntimeNotice && <p className="text-[10px] font-mono text-emerald-300">{hudRuntimeNotice}</p>}
        </div>
      </section>

      <section className="border border-white/10 rounded p-3 bg-black/30">
        <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase mb-2 flex items-center gap-2">
          <Shield size={12} /> Policy
        </h3>
        <ul className="space-y-1 text-xs text-white/70">
          {policyItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {/* Model Registry */}
      <section className="mt-4 border border-white/10 rounded p-3 bg-black/30">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase flex items-center gap-2">
            <Database size={12} /> Model Registry
          </h3>
          <span className="text-[10px] font-mono text-white/40">
            {registryLoading ? "..." : `${registryModels.length} models`}
          </span>
        </div>
        {registryModels.length === 0 && !registryLoading && (
          <p className="text-xs font-mono text-white/40">No models in registry. Connect a Postgres store and sync models.</p>
        )}
        {registryModels.length > 0 && (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {registryModels.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-2 py-1.5 rounded border border-white/5 hover:bg-white/5 text-[11px] font-mono">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.is_available ? "bg-green-400" : "bg-white/20"}`} />
                  <span className="text-white/70 truncate">{m.display_name || m.model_id}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[10px] text-white/40">
                  <span className="uppercase">{m.provider}</span>
                  {m.context_window && <span>{(m.context_window / 1000).toFixed(0)}k</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Routing Policies */}
      <section className="mt-4 border border-white/10 rounded p-3 bg-black/30">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase flex items-center gap-2">
            <Route size={12} /> Routing Policies
          </h3>
          <button
            type="button"
            onClick={() => setShowPolicyForm(!showPolicyForm)}
            className="inline-flex items-center gap-1 h-6 px-2 rounded border border-cyan-500/30 text-[10px] font-mono text-cyan-300 hover:text-cyan-100"
          >
            <Plus size={10} /> Add
          </button>
        </div>

        {showPolicyForm && (
          <div className="mb-3 p-2 border border-cyan-500/20 rounded bg-cyan-950/10 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="task_type (e.g. code)"
                value={policyDraft.task_type}
                onChange={(e) => setPolicyDraft((d) => ({ ...d, task_type: e.target.value }))}
                className="h-7 rounded border border-white/15 bg-black/50 px-2 text-[11px] font-mono"
              />
              <select
                value={policyDraft.provider}
                onChange={(e) => setPolicyDraft((d) => ({ ...d, provider: e.target.value }))}
                className="h-7 rounded border border-white/15 bg-black/50 px-2 text-[11px] font-mono text-white"
              >
                {PROVIDER_ORDER.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
              </select>
            </div>
            <input
              placeholder="model_id (e.g. gpt-4o)"
              value={policyDraft.model_id}
              onChange={(e) => setPolicyDraft((d) => ({ ...d, model_id: e.target.value }))}
              className="w-full h-7 rounded border border-white/15 bg-black/50 px-2 text-[11px] font-mono"
            />
            <div className="flex gap-2 items-center">
              <label className="text-[10px] text-white/50">Tier</label>
              <input
                type="number" min={1} max={3}
                value={policyDraft.tier}
                onChange={(e) => setPolicyDraft((d) => ({ ...d, tier: Number(e.target.value) }))}
                className="h-7 w-14 rounded border border-white/15 bg-black/50 px-2 text-[11px] font-mono"
              />
              <label className="text-[10px] text-white/50">Priority</label>
              <input
                type="number" min={-100} max={100}
                value={policyDraft.priority}
                onChange={(e) => setPolicyDraft((d) => ({ ...d, priority: Number(e.target.value) }))}
                className="h-7 w-14 rounded border border-white/15 bg-black/50 px-2 text-[11px] font-mono"
              />
              <button
                type="button"
                onClick={() => void onSavePolicy()}
                className="h-7 px-3 rounded border border-cyan-400/40 bg-cyan-500/15 text-cyan-200 text-[10px] font-mono tracking-widest"
              >
                SAVE
              </button>
            </div>
          </div>
        )}

        {policyError && <p className="text-[10px] font-mono text-rose-300 mb-2">{policyError}</p>}
        {policyNotice && <p className="text-[10px] font-mono text-emerald-300 mb-2">{policyNotice}</p>}

        {policiesLoading && <p className="text-[10px] font-mono text-white/40">Loading policies...</p>}
        {!policiesLoading && policies.length === 0 && (
          <p className="text-xs font-mono text-white/40">No routing policies defined. Add one above or use the default routing.</p>
        )}
        {!policiesLoading && policies.length > 0 && (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {policies.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-2 py-1.5 rounded border border-white/5 hover:bg-white/5 text-[11px] font-mono">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.is_active ? "bg-cyan-400" : "bg-white/20"}`} />
                  <span className="text-white/60">{p.task_type}</span>
                  <span className="text-white/30">&rarr;</span>
                  <span className="text-white/70 truncate">{p.provider}/{p.model_id}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-white/40">T{p.tier} P{p.priority}</span>
                  <button
                    type="button"
                    onClick={() => void onTogglePolicy(p)}
                    className={`text-[9px] px-1.5 py-0.5 rounded border ${p.is_active ? "border-cyan-500/30 text-cyan-300" : "border-white/15 text-white/40"}`}
                  >
                    {p.is_active ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
