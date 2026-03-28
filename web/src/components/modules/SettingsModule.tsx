"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Settings2, Shield, RadioTower, KeyRound, RefreshCw, Clock3, Database, Route, Plus } from "lucide-react";

import { ApiRequestError } from "@/lib/api/client";
import {
  completeUserProviderOauth,
  deleteUserProviderCredential,
  deleteAdminProviderCredential,
  getSettingsOverview,
  listAdminProviderCredentials,
  listUserProviderCredentials,
  startUserProviderOauth,
  testUserProviderCredential,
  testAdminProviderConnection,
  upsertUserProviderCredential,
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
  ProviderCredentialPriority,
  ProviderCredentialSelectionMode,
  UserProviderConnectionTestResult,
  UserProviderCredentialRecord,
  ProviderName,
  SettingsOverviewData,
} from "@/lib/api/types";
import { hasMinRole, useCurrentRole } from "@/lib/auth/role";
import { AsyncState } from "@/components/ui/AsyncState";
import { ConnectorHealthCard } from "@/components/ui/ConnectorHealthCard";
import { useLocale } from "@/components/providers/LocaleProvider";
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
type SettingsTab = "interface" | "personal" | "workspace" | "policies";

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return fallback;
}

function formatCredentialModeLabel(
  mode: UserProviderCredentialRecord["selected_credential_mode"],
  t: ReturnType<typeof useLocale>["t"]
): string {
  if (mode === "oauth_official") return t("settings.credential.oauthOfficial");
  if (mode === "api_key") return t("settings.credential.apiKey");
  return t("settings.credential.notSelected");
}

function formatSelectedUserCredentialModeLabel(
  mode: UserProviderCredentialRecord["selected_user_credential_mode"],
  t: ReturnType<typeof useLocale>["t"]
): string {
  if (mode === "oauth_official") return t("settings.credential.oauthOfficial");
  if (mode === "api_key") return t("settings.credential.apiKey");
  return t("common.auto");
}

function formatCredentialPriorityLabel(priority: ProviderCredentialPriority, t: ReturnType<typeof useLocale>["t"]): string {
  return priority === "auth_first" ? t("settings.priority.oauthFirst") : t("settings.priority.apiKeyFirst");
}

function formatCredentialSourceLabel(
  source: UserProviderCredentialRecord["source"],
  t: ReturnType<typeof useLocale>["t"]
): string {
  if (source === "user") return t("settings.source.personal");
  if (source === "workspace") return t("settings.source.workspace");
  if (source === "env") return t("settings.source.env");
  return t("settings.source.none");
}

function credentialSourceClass(source: UserProviderCredentialRecord["source"]): string {
  if (source === "user") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  if (source === "workspace") return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800";
  if (source === "env") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-black/10 bg-white text-neutral-500";
}

function formatEventTypes(eventTypes: string[], t: ReturnType<typeof useLocale>["t"]): string {
  if (eventTypes.length === 0) return t("settings.eventTypes.none");
  if (eventTypes.includes("*")) return t("settings.eventTypes.all");
  return eventTypes.join(", ");
}

export function SettingsModule() {
  const { t, locale, preference, setPreference, formatDateTime, formatTime } = useLocale();
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
  const [userProviderCredentials, setUserProviderCredentials] = useState<UserProviderCredentialRecord[]>([]);
  const [userCredentialLoading, setUserCredentialLoading] = useState(false);
  const [userCredentialError, setUserCredentialError] = useState<string | null>(null);
  const [userCredentialNotice, setUserCredentialNotice] = useState<string | null>(null);
  const [userCredentialDrafts, setUserCredentialDrafts] = useState<Partial<Record<ProviderName, string>>>({});
  const [userCredentialModeDrafts, setUserCredentialModeDrafts] = useState<
    Partial<Record<ProviderName, ProviderCredentialSelectionMode>>
  >({});
  const [userCredentialPriorityDrafts, setUserCredentialPriorityDrafts] = useState<
    Partial<Record<ProviderName, ProviderCredentialPriority>>
  >({});
  const [activeUserSaveProvider, setActiveUserSaveProvider] = useState<ProviderName | null>(null);
  const [activeUserDeleteProvider, setActiveUserDeleteProvider] = useState<ProviderName | null>(null);
  const [activeUserTestProvider, setActiveUserTestProvider] = useState<ProviderName | null>(null);
  const [activeUserModeProvider, setActiveUserModeProvider] = useState<ProviderName | null>(null);
  const [activeUserPriorityProvider, setActiveUserPriorityProvider] = useState<ProviderName | null>(null);
  const [activeOauthProvider, setActiveOauthProvider] = useState<Extract<ProviderName, "openai" | "gemini"> | null>(null);
  const [userConnectionTests, setUserConnectionTests] = useState<Partial<Record<ProviderName, UserProviderConnectionTestResult>>>({});
  const [hudAutoFocusDefault, setHudAutoFocusDefault] = useState(true);
  const [hudHoldSecondsDraft, setHudHoldSecondsDraft] = useState("90");
  const [hudRuntimeNotice, setHudRuntimeNotice] = useState<string | null>(null);
  const [visualCoreEnabled, setVisualCoreEnabled] = useState(true);
  const [languageNotice, setLanguageNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("interface");
  const [showAdvancedRuntime, setShowAdvancedRuntime] = useState(false);

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
      setError(toErrorMessage(err, t("settings.loadFailed")));
      setSettingsOverview(null);
    }

    setUserCredentialLoading(true);
    setUserCredentialError(null);
    try {
      const data = await listUserProviderCredentials();
      setUserProviderCredentials(data.providers);
    } catch (err) {
      setUserProviderCredentials([]);
      setUserCredentialError(toErrorMessage(err, t("settings.userCredentialsLoadFailed")));
    } finally {
      setUserCredentialLoading(false);
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
        setCredentialError(toErrorMessage(err, t("settings.adminCredentialsLoadFailed")));
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
  }, [isAdmin, t]);

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

  const userProviderRows = useMemo(() => {
    const map = new Map(userProviderCredentials.map((item) => [item.provider, item]));
    return PROVIDER_ORDER.map(
      (provider): UserProviderCredentialRecord =>
        map.get(provider) ?? {
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
          oauth_supported: false,
          oauth_enabled: false,
          user_updated_at: null,
        }
    );
  }, [userProviderCredentials]);

  const cards = useMemo(() => {
    const rows = (settingsOverview?.providers ?? []).map((provider) => ({
      name: `AI ${provider.provider.toUpperCase()}`,
      status: (provider.enabled ? (provider.attempts > 0 ? "healthy" : "degraded") : "error") as
        | "healthy"
        | "degraded"
        | "error",
      latencyMs: provider.attempts > 0 ? Math.round(provider.avg_latency_ms) : 0,
      lastSync: provider.last_attempt_at ? formatTime(provider.last_attempt_at) : t("settings.connector.noAttempts"),
      description: provider.enabled
        ? t("settings.connector.providerSummary", {
            model: provider.model ?? t("settings.connector.defaultModel"),
            credential: provider.selected_credential_mode ?? "none",
            source: provider.credential_source ?? "none",
            successRate: provider.success_rate_pct,
            successes: provider.successes,
            attempts: provider.attempts,
          })
        : t("settings.connector.disabled", { reason: provider.reason ?? "" }).trim(),
    }));

    if (settingsOverview) {
      rows.unshift({
        name: t("settings.connector.backendHealth"),
        status: (settingsOverview.backend.db === "up" ? "healthy" : settingsOverview.backend.db === "n/a" ? "degraded" : "error") as
          | "healthy"
          | "degraded"
          | "error",
        latencyMs: 0,
        lastSync: formatTime(settingsOverview.backend.now),
        description: `env=${settingsOverview.backend.env} store=${settingsOverview.backend.store} db=${settingsOverview.backend.db}`,
      });
    }

    return rows;
  }, [settingsOverview, formatTime, t]);

  const activeLocaleLabel = locale === "ko" ? t("common.korean") : t("common.english");
  const connectedProvidersCount = useMemo(
    () => userProviderRows.filter((row) => row.has_user_credential).length,
    [userProviderRows]
  );
  const workspaceKeyCount = useMemo(
    () => providerCredentialRows.filter((row) => row.has_key).length,
    [providerCredentialRows]
  );
  const runtimeHealthyCount = useMemo(
    () => cards.filter((card) => card.status === "healthy").length,
    [cards]
  );
  const runtimeSummaryLabel = useMemo(
    () => t("settings.summary.runtimeHealthValue", { healthy: runtimeHealthyCount, total: cards.length }),
    [cards.length, runtimeHealthyCount, t]
  );
  const settingsTabs = useMemo(
    () =>
      [
        { id: "interface", label: t("settings.tab.interface") },
        { id: "personal", label: t("settings.tab.personal") },
        ...(isAdmin ? [{ id: "workspace", label: t("settings.tab.workspace") }] : []),
        { id: "policies", label: t("settings.tab.policies") },
      ] as Array<{ id: SettingsTab; label: string }>,
    [isAdmin, t]
  );

  useEffect(() => {
    if (!isAdmin && activeTab === "workspace") {
      setActiveTab("interface");
    }
  }, [activeTab, isAdmin]);

  const onLanguagePreferenceChange = (nextPreference: "auto" | "ko" | "en") => {
    setPreference(nextPreference);
    setLanguageNotice(
      nextPreference === "auto" ? t("settings.language.notice.auto") : t("settings.language.notice.manual")
    );
  };

  const policyItems = useMemo(() => {
    if (!settingsOverview) {
      return [
        t("settings.policy.highRiskRequired"),
        t("settings.policy.failoverEnabled"),
      ];
    }

    return [
      settingsOverview.policies.high_risk_requires_approval
        ? t("settings.policy.highRiskRequired")
        : t("settings.policy.highRiskOptional"),
      t("settings.policy.approvalMaxAge", { value: settingsOverview.policies.approval_max_age_hours }),
      t("settings.policy.allowedRoles", { value: settingsOverview.policies.high_risk_allowed_roles.join(", ") }),
      settingsOverview.policies.provider_failover_auto
        ? t("settings.policy.failoverEnabled")
        : t("settings.policy.failoverDisabled"),
      settingsOverview.policies.auth_required
        ? t("settings.policy.authRequired")
        : t("settings.policy.authOptional"),
    ];
  }, [settingsOverview, t]);

  const onSaveProviderKey = async (provider: ProviderName) => {
    const apiKey = credentialDrafts[provider]?.trim() ?? "";
    if (apiKey.length < 8) {
      setCredentialError(t("settings.error.apiKeyTooShort"));
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
            ? t("settings.notice.adminKeySavedOk", {
                provider: provider.toUpperCase(),
                models: testResult.model_count,
              })
            : t("settings.notice.adminKeySavedFailed", {
                provider: provider.toUpperCase(),
                reason: testResult.reason ? `: ${testResult.reason}` : "",
              })
        );
      } catch (testErr) {
        setConnectionTests((prev) => ({
          ...prev,
          [provider]: undefined,
        }));
        setCredentialNotice(
          t("settings.notice.adminKeySavedTestError", {
            provider: provider.toUpperCase(),
            error: toErrorMessage(testErr, t("settings.error.connectionTestFailed")),
          })
        );
      } finally {
        setActiveTestProvider(null);
      }
      await refresh();
    } catch (err) {
      setCredentialError(toErrorMessage(err, t("settings.error.saveProviderKey", { provider: provider.toUpperCase() })));
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
        setCredentialNotice(t("settings.notice.adminStoredKeyRemovedEnv", { provider: provider.toUpperCase() }));
      } else {
        setCredentialNotice(t("settings.notice.adminKeyRemoved", { provider: provider.toUpperCase() }));
      }
      setConnectionTests((prev) => ({
        ...prev,
        [provider]: undefined,
      }));
      await refresh();
    } catch (err) {
      setCredentialError(toErrorMessage(err, t("settings.error.deleteProviderKey", { provider: provider.toUpperCase() })));
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
        setCredentialNotice(t("settings.notice.connectionPassed", { provider: provider.toUpperCase() }));
      } else {
        setCredentialNotice(
          t("settings.notice.connectionFailed", {
            provider: provider.toUpperCase(),
            reason: result.reason ? `: ${result.reason}` : "",
          })
        );
      }
      await refresh();
    } catch (err) {
      setCredentialError(
        toErrorMessage(err, t("settings.error.testProviderConnection", { provider: provider.toUpperCase() }))
      );
    } finally {
      setActiveTestProvider(null);
    }
  };

  const onSaveUserProviderKey = async (provider: ProviderName) => {
    const apiKey = userCredentialDrafts[provider]?.trim() ?? "";
    if (apiKey.length < 8) {
      setUserCredentialError(t("settings.error.apiKeyTooShort"));
      return;
    }

    setUserCredentialError(null);
    setUserCredentialNotice(null);
    setActiveUserSaveProvider(provider);
    try {
      await upsertUserProviderCredential(provider, {
        api_key: apiKey,
      });
      setUserCredentialDrafts((prev) => ({
        ...prev,
        [provider]: "",
      }));
      setUserCredentialNotice(t("settings.notice.personalKeySaved", { provider: provider.toUpperCase() }));
      await refresh();
    } catch (err) {
      setUserCredentialError(
        toErrorMessage(err, t("settings.error.savePersonalKey", { provider: provider.toUpperCase() }))
      );
    } finally {
      setActiveUserSaveProvider(null);
    }
  };

  const onSaveUserCredentialMode = async (provider: ProviderName) => {
    const nextMode = userCredentialModeDrafts[provider];
    if (!nextMode) {
      return;
    }

    setUserCredentialError(null);
    setUserCredentialNotice(null);
    setActiveUserModeProvider(provider);
    try {
      await upsertUserProviderCredential(provider, {
        selected_credential_mode: nextMode,
      });
      setUserCredentialModeDrafts((prev) => ({
        ...prev,
        [provider]: nextMode,
      }));
      setUserCredentialNotice(
        t("settings.notice.modeUpdated", {
          provider: provider.toUpperCase(),
          value: formatSelectedUserCredentialModeLabel(nextMode, t),
        })
      );
      await refresh();
    } catch (err) {
      setUserCredentialError(
        toErrorMessage(err, t("settings.error.updateCredentialMode", { provider: provider.toUpperCase() }))
      );
    } finally {
      setActiveUserModeProvider(null);
    }
  };

  const onSaveUserCredentialPriority = async (provider: ProviderName) => {
    const nextPriority = userCredentialPriorityDrafts[provider];
    if (!nextPriority) {
      return;
    }

    setUserCredentialError(null);
    setUserCredentialNotice(null);
    setActiveUserPriorityProvider(provider);
    try {
      await upsertUserProviderCredential(provider, {
        credential_priority: nextPriority,
      });
      setUserCredentialPriorityDrafts((prev) => ({
        ...prev,
        [provider]: nextPriority,
      }));
      setUserCredentialNotice(
        t("settings.notice.priorityUpdated", {
          provider: provider.toUpperCase(),
          value: formatCredentialPriorityLabel(nextPriority, t),
        })
      );
      await refresh();
    } catch (err) {
      setUserCredentialError(
        toErrorMessage(err, t("settings.error.updateCredentialPriority", { provider: provider.toUpperCase() }))
      );
    } finally {
      setActiveUserPriorityProvider(null);
    }
  };

  const onDeleteUserProviderCredential = async (provider: ProviderName) => {
    setUserCredentialError(null);
    setUserCredentialNotice(null);
    setActiveUserDeleteProvider(provider);
    try {
      await deleteUserProviderCredential(provider);
      setUserConnectionTests((prev) => ({
        ...prev,
        [provider]: undefined,
      }));
      setUserCredentialPriorityDrafts((prev) => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });
      setUserCredentialModeDrafts((prev) => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });
      setUserCredentialNotice(t("settings.notice.personalCredentialRemoved", { provider: provider.toUpperCase() }));
      await refresh();
    } catch (err) {
      setUserCredentialError(
        toErrorMessage(err, t("settings.error.removePersonalCredential", { provider: provider.toUpperCase() }))
      );
    } finally {
      setActiveUserDeleteProvider(null);
    }
  };

  const onTestUserProviderConnection = async (provider: ProviderName) => {
    setUserCredentialError(null);
    setUserCredentialNotice(null);
    setActiveUserTestProvider(provider);
    try {
      const result = await testUserProviderCredential(provider);
      setUserConnectionTests((prev) => ({
        ...prev,
        [provider]: result,
      }));
      if (result.ok) {
        setUserCredentialNotice(t("settings.notice.personalCredentialTestPassed", { provider: provider.toUpperCase() }));
      } else {
        setUserCredentialNotice(
          t("settings.notice.personalCredentialTestFailed", {
            provider: provider.toUpperCase(),
            reason: result.reason ? `: ${result.reason}` : "",
          })
        );
      }
      await refresh();
    } catch (err) {
      setUserCredentialError(
        toErrorMessage(err, t("settings.error.testPersonalCredential", { provider: provider.toUpperCase() }))
      );
    } finally {
      setActiveUserTestProvider(null);
    }
  };

  const onConnectUserProviderOauth = async (provider: Extract<ProviderName, "openai" | "gemini">) => {
    setUserCredentialError(null);
    setUserCredentialNotice(null);
    setActiveOauthProvider(provider);

    try {
      const started = await startUserProviderOauth(provider);
      const popup = window.open(
        started.auth_url,
        `jarvis-oauth-${provider}`,
        "popup=yes,width=640,height=760"
      );
      if (!popup) {
        throw new Error(t("settings.error.oauthPopupBlocked"));
      }
      const allowedCallbackOrigins = new Set<string>([
        window.location.origin,
        ...(Array.isArray(started.callback_origins) ? started.callback_origins : []),
      ]);

      const callbackPayload = await new Promise<{ code: string; state: string }>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error(t("settings.error.oauthTimedOut")));
        }, 180000);
        const closeWatcher = window.setInterval(() => {
          if (popup.closed) {
            cleanup();
            reject(new Error(t("settings.error.oauthPopupClosed")));
          }
        }, 400);

        const cleanup = () => {
          window.clearTimeout(timeout);
          window.clearInterval(closeWatcher);
          window.removeEventListener("message", onMessage);
        };

        const onMessage = (event: MessageEvent) => {
          if (!allowedCallbackOrigins.has(event.origin)) {
            return;
          }
          const payload = event.data as {
            type?: string;
            code?: string | null;
            state?: string | null;
            error?: string | null;
          };
          if (payload?.type !== "jarvis_oauth_callback") {
            return;
          }
          if (payload.error) {
            cleanup();
            reject(new Error(payload.error));
            return;
          }
          if (typeof payload.code !== "string" || typeof payload.state !== "string") {
            cleanup();
            reject(new Error(t("settings.error.oauthMissingCodeState")));
            return;
          }

          cleanup();
          resolve({
            code: payload.code,
            state: payload.state,
          });
        };

        window.addEventListener("message", onMessage);
      });

      await completeUserProviderOauth(provider, callbackPayload);
      setUserCredentialNotice(t("settings.notice.oauthConnected", { provider: provider.toUpperCase() }));
      await refresh();
    } catch (err) {
      setUserCredentialError(toErrorMessage(err, t("settings.error.connectOauth", { provider: provider.toUpperCase() })));
    } finally {
      setActiveOauthProvider(null);
    }
  };

  const onToggleHudAutoFocusDefault = () => {
    const next = !hudAutoFocusDefault;
    writeMissionAutoFocusEnabledPreference(next);
    setHudAutoFocusDefault(next);
    setHudRuntimeNotice(t("settings.hud.notice.autoFocusUpdated", { value: next ? t("common.on") : t("common.off") }));
  };

  const onToggleVisualCore = () => {
    const next = !visualCoreEnabled;
    writeVisualCoreEnabledPreference(next);
    setVisualCoreEnabled(next);
    setHudRuntimeNotice(
      next ? t("settings.hud.notice.visualCoreEnabled") : t("settings.hud.notice.visualCoreDisabled")
    );
  };

  const onSaveHudHoldSeconds = () => {
    const normalized = parseMissionAutoFocusHoldSecondsInput(hudHoldSecondsDraft);
    writeMissionAutoFocusHoldSecondsPreference(normalized);
    setHudHoldSecondsDraft(String(normalized));
    setHudRuntimeNotice(t("settings.hud.notice.manualHoldUpdated", { value: normalized }));
  };

  const onSavePolicy = async () => {
    if (!policyDraft.task_type.trim() || !policyDraft.model_id.trim()) {
      setPolicyError(t("settings.routingPolicies.error.required"));
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
      setPolicyNotice(
        t("settings.routingPolicies.notice.saved", {
          taskType: policyDraft.task_type,
          provider: policyDraft.provider,
          model: policyDraft.model_id,
        })
      );
      setPolicyDraft({ task_type: "", provider: "openai", model_id: "", tier: 1, priority: 0 });
      setShowPolicyForm(false);
      const pol = await getTaskModelPolicies();
      setPolicies(pol.policies ?? []);
    } catch (err) {
      setPolicyError(toErrorMessage(err, t("settings.routingPolicies.error.saveFailed")));
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
      setPolicyError(toErrorMessage(err, t("settings.routingPolicies.error.toggleFailed")));
    }
  };

  const notificationRuntime = settingsOverview?.notification_runtime ?? null;
  const notificationPolicy = settingsOverview?.notification_policy ?? null;
  const radarPolicy = settingsOverview?.radar_policy ?? null;
  const radarScannerWorker = settingsOverview?.radar_scanner_worker ?? radarPolicy?.scanner_worker ?? null;
  const radarControl = radarPolicy?.control ?? null;
  const radarSources = useMemo(() => radarPolicy?.sources ?? [], [radarPolicy?.sources]);
  const radarPackMetrics = useMemo(
    () =>
      [...(radarPolicy?.domain_pack_metrics ?? [])].sort((left, right) => {
        if (right.calibrationScore !== left.calibrationScore) {
          return right.calibrationScore - left.calibrationScore;
        }
        return (right.lastEventAt ? Date.parse(right.lastEventAt) : 0) - (left.lastEventAt ? Date.parse(left.lastEventAt) : 0);
      }),
    [radarPolicy]
  );
  const radarControlItems = useMemo(() => {
    if (!radarControl) {
      return [];
    }
    return [
      {
        label: t("settings.radar.control.globalKillSwitch"),
        value: radarControl.globalKillSwitch ? t("common.enabled") : t("common.disabled"),
        tone: radarControl.globalKillSwitch ? "text-rose-300 border-rose-400/30 bg-rose-500/10" : "text-emerald-300 border-emerald-400/30 bg-emerald-500/10",
      },
      {
        label: t("settings.radar.control.dossierPromotion"),
        value: radarControl.dossierPromotionEnabled ? t("common.enabled") : t("common.disabled"),
        tone: radarControl.dossierPromotionEnabled ? "text-cyan-200 border-cyan-400/30 bg-cyan-500/10" : "text-white/55 border-white/15 bg-white/5",
      },
      {
        label: t("settings.radar.control.autoExecution"),
        value: radarControl.autoExecutionEnabled ? t("common.enabled") : t("common.disabled"),
        tone: radarControl.autoExecutionEnabled ? "text-amber-200 border-amber-400/30 bg-amber-500/10" : "text-white/55 border-white/15 bg-white/5",
      },
      {
        label: t("settings.radar.control.tier3Escalation"),
        value: radarControl.tier3EscalationEnabled ? t("common.enabled") : t("common.disabled"),
        tone: radarControl.tier3EscalationEnabled ? "text-fuchsia-200 border-fuchsia-400/30 bg-fuchsia-500/10" : "text-white/55 border-white/15 bg-white/5",
      },
    ];
  }, [radarControl, t]);
  const radarSourceSummary = useMemo(() => {
    const enabledCount = radarSources.filter((source) => source.enabled).length;
    const failedCount = radarSources.filter((source) => Boolean(source.lastError)).length;
    return {
      total: radarSources.length,
      enabled: enabledCount,
      disabled: Math.max(0, radarSources.length - enabledCount),
      failed: failedCount,
    };
  }, [radarSources]);
  const notificationChannels = [
    {
      key: "in_app",
      label: t("settings.channel.inApp"),
      policy: notificationPolicy?.in_app ?? { enabled: true, min_severity: "info", event_types: ["*"] },
      runtime: null,
    },
    {
      key: "webhook",
      label: t("settings.channel.webhook"),
      policy: notificationPolicy?.webhook ?? null,
      runtime: notificationRuntime?.channels.find((channel) => channel.name === "webhook") ?? null,
    },
    {
      key: "telegram",
      label: t("settings.channel.telegram"),
      policy: notificationPolicy?.telegram ?? null,
      runtime: notificationRuntime?.channels.find((channel) => channel.name === "telegram") ?? null,
    },
  ] as const;

  return (
    <main className="flex min-h-full w-full flex-col bg-transparent p-4 text-neutral-950">
      <header className="mb-4 border-l-2 border-black/20 pl-3">
        <h2 className="flex items-center gap-2 text-sm font-mono font-bold tracking-widest text-neutral-950">
          <Settings2 size={14} /> {t("settings.title").toUpperCase()}
        </h2>
        <p className="mt-1 text-xs text-neutral-600">
          {t("settings.subtitle")}
        </p>
      </header>

      <AsyncState
        loading={loading}
        error={error}
        empty={false}
        loadingText={t("settings.loading")}
        onRetry={() => void refresh()}
        className="mb-3"
      />

      <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-black/10 bg-[#fffdf8] p-3 shadow-sm">
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-neutral-500">{t("settings.summary.language")}</p>
          <p className="mt-2 text-sm font-semibold text-neutral-950">{activeLocaleLabel}</p>
        </div>
        <div className="rounded-xl border border-black/10 bg-[#fffdf8] p-3 shadow-sm">
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-neutral-500">{t("settings.summary.personalConnections")}</p>
          <p className="mt-2 text-sm font-semibold text-neutral-950">{t("settings.summary.personalConnectionsValue", { value: connectedProvidersCount })}</p>
        </div>
        <div className="rounded-xl border border-black/10 bg-[#fffdf8] p-3 shadow-sm">
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-neutral-500">{t("settings.summary.workspaceKeys")}</p>
          <p className="mt-2 text-sm font-semibold text-neutral-950">{t("settings.summary.workspaceKeysValue", { value: workspaceKeyCount })}</p>
        </div>
        <div className="rounded-xl border border-black/10 bg-[#fffdf8] p-3 shadow-sm">
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-neutral-500">{t("settings.summary.runtimeHealth")}</p>
          <p className="mt-2 text-sm font-semibold text-neutral-950">{runtimeSummaryLabel}</p>
        </div>
      </section>

      <div className="mb-4 flex flex-wrap gap-2">
        {settingsTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.22em] transition-colors ${
              activeTab === tab.id
                ? "border-cyan-300 bg-cyan-50 text-cyan-900"
                : "border-black/10 bg-white text-neutral-600 hover:border-black/20 hover:text-neutral-950"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "interface" && (
      <section className="mb-4 rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-[#fffdf8] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-cyan-900">{t("settings.language.title")}</h3>
            <p className="mt-1 text-xs text-neutral-600">{t("settings.language.subtitle")}</p>
          </div>
          <div className="text-right text-[11px] text-neutral-500">
            <p>{t("settings.language.activeLocale")}</p>
            <p className="mt-1 text-cyan-700">{activeLocaleLabel}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
          <label className="text-[11px] font-mono uppercase tracking-[0.24em] text-neutral-500">
            {t("settings.language.preference")}
          </label>
          <select
            value={preference}
            onChange={(event) => onLanguagePreferenceChange(event.target.value as "auto" | "ko" | "en")}
            className="h-10 rounded border border-black/10 bg-white px-3 text-sm text-neutral-900"
          >
            <option value="auto">{t("common.auto")}</option>
            <option value="ko">{t("common.korean")}</option>
            <option value="en">{t("common.english")}</option>
          </select>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">{t("settings.language.autoHint")}</p>
        {languageNotice ? <p className="mt-2 text-xs text-emerald-700">{languageNotice}</p> : null}
      </section>
      )}

      {activeTab === "policies" && (
      <section className="mb-4">
        <h3 className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-600">
          <RadioTower size={12} /> {t("settings.connectors")}
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
            <div className="rounded-xl border border-dashed border-black/10 bg-white px-4 py-4 text-sm font-mono text-neutral-500">{t("settings.noConnectorData")}</div>
          )}
        </div>
      </section>
      )}

      {activeTab === "personal" && (
      <section className="mb-4 rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-[#fffdf8] p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-cyan-900">
              <KeyRound size={14} /> {t("settings.myCredentials")}
            </h3>
            <p className="mt-1 text-xs text-neutral-600">
              {t("settings.myCredentialsSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex h-8 items-center gap-1 rounded border border-black/10 bg-white px-3 text-xs text-neutral-700 hover:border-black/20 hover:bg-neutral-50 hover:text-neutral-950"
          >
            <RefreshCw size={12} /> {t("common.refresh")}
          </button>
        </div>
        <div className="space-y-3">
          {userProviderRows.map((row) => {
            const modeDraft = userCredentialModeDrafts[row.provider] ?? row.selected_user_credential_mode;
            const modeDirty = modeDraft !== row.selected_user_credential_mode;
            const priorityDraft = userCredentialPriorityDrafts[row.provider] ?? row.credential_priority;
            const priorityDirty = priorityDraft !== row.credential_priority;
            const effectiveMode = formatCredentialModeLabel(row.selected_credential_mode, t);
            const canUseOauth = row.oauth_enabled || row.has_user_oauth_official || row.has_user_oauth_token;
            const canConnectOauth = row.oauth_enabled;
            return (
              <div key={`user-${row.provider}`} className="rounded-2xl border border-black/10 bg-white p-3 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold tracking-wide text-neutral-950">{row.provider.toUpperCase()}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${credentialSourceClass(row.source)}`}>
                      {formatCredentialSourceLabel(row.source, t)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] text-cyan-800">
                      {t("settings.active")}: {effectiveMode}
                    </span>
                    <span className="rounded-full border border-black/10 bg-[#fffdf8] px-2 py-0.5 text-[11px] text-neutral-600">
                      {t("settings.mode")}: {formatSelectedUserCredentialModeLabel(row.selected_user_credential_mode, t)}
                    </span>
                    <span className="rounded-full border border-black/10 bg-[#fffdf8] px-2 py-0.5 text-[11px] text-neutral-600">
                      {t("settings.priority")}: {formatCredentialPriorityLabel(row.credential_priority, t)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    type="password"
                    placeholder={t("settings.personalApiKeyPlaceholder", { provider: row.provider.toUpperCase() })}
                    value={userCredentialDrafts[row.provider] ?? ""}
                    onChange={(event) =>
                      setUserCredentialDrafts((prev) => ({
                        ...prev,
                        [row.provider]: event.target.value,
                      }))
                    }
                    className="h-9 rounded border border-black/10 bg-[#fffdf8] px-3 text-sm text-neutral-900"
                  />
                  <button
                    type="button"
                    onClick={() => void onSaveUserProviderKey(row.provider)}
                    disabled={(userCredentialDrafts[row.provider]?.trim().length ?? 0) < 8 || activeUserSaveProvider === row.provider}
                    className="h-9 rounded border border-cyan-300 bg-cyan-100 px-3 text-xs font-semibold text-cyan-800 disabled:opacity-40"
                  >
                    {activeUserSaveProvider === row.provider ? t("settings.saving") : t("settings.saveApiKey")}
                  </button>
                  {canConnectOauth && (
                    <button
                      type="button"
                      onClick={() => void onConnectUserProviderOauth(row.provider as Extract<ProviderName, "openai" | "gemini">)}
                      disabled={activeOauthProvider === (row.provider as Extract<ProviderName, "openai" | "gemini">)}
                      className="h-9 rounded border border-fuchsia-300 bg-fuchsia-100 px-3 text-xs font-semibold text-fuchsia-800 disabled:opacity-40"
                    >
                      {activeOauthProvider === row.provider ? t("settings.connectingOauth") : t("settings.connectOauth")}
                    </button>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[220px_auto_220px_auto_auto_auto]">
                  <select
                    value={modeDraft}
                    onChange={(event) =>
                      setUserCredentialModeDrafts((prev) => ({
                        ...prev,
                        [row.provider]: event.target.value as ProviderCredentialSelectionMode,
                      }))
                    }
                    className="h-9 rounded border border-black/10 bg-[#fffdf8] px-2 text-sm text-neutral-900"
                  >
                    <option value="auto">{t("common.auto")}</option>
                    <option value="api_key">{t("settings.credential.apiKey")}</option>
                    {canUseOauth && <option value="oauth_official">{t("settings.credential.oauthOfficial")}</option>}
                  </select>
                  <button
                    type="button"
                    onClick={() => void onSaveUserCredentialMode(row.provider)}
                    disabled={!modeDirty || activeUserModeProvider === row.provider}
                    className="h-9 rounded border border-black/10 bg-white px-3 text-xs font-semibold text-neutral-800 disabled:opacity-40"
                  >
                    {activeUserModeProvider === row.provider ? t("settings.applying") : t("settings.applyMode")}
                  </button>
                  <select
                    value={priorityDraft}
                    onChange={(event) =>
                      setUserCredentialPriorityDrafts((prev) => ({
                        ...prev,
                        [row.provider]: event.target.value as ProviderCredentialPriority,
                      }))
                    }
                    className="h-9 rounded border border-black/10 bg-[#fffdf8] px-2 text-sm text-neutral-900"
                  >
                    <option value="auth_first">{t("settings.priority.oauthFirst")}</option>
                    <option value="api_key_first">{t("settings.priority.apiKeyFirst")}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void onSaveUserCredentialPriority(row.provider)}
                    disabled={!priorityDirty || activeUserPriorityProvider === row.provider}
                    className="h-9 rounded border border-black/10 bg-white px-3 text-xs font-semibold text-neutral-800 disabled:opacity-40"
                  >
                    {activeUserPriorityProvider === row.provider ? t("settings.applying") : t("settings.applyPriority")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onTestUserProviderConnection(row.provider)}
                    disabled={activeUserTestProvider === row.provider}
                    className="h-9 rounded border border-emerald-300 bg-emerald-100 px-3 text-xs font-semibold text-emerald-800 disabled:opacity-40"
                  >
                    {activeUserTestProvider === row.provider ? t("settings.testing") : t("settings.test")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteUserProviderCredential(row.provider)}
                    disabled={!row.has_user_credential || activeUserDeleteProvider === row.provider}
                    className="h-9 rounded border border-black/10 bg-white px-3 text-xs font-semibold text-neutral-800 disabled:opacity-40"
                  >
                    {activeUserDeleteProvider === row.provider ? t("settings.removing") : t("settings.remove")}
                  </button>
                </div>

                <div className="mt-2 space-y-1 text-xs text-neutral-600">
                  <p>
                    {t("settings.flag.credential")}={row.has_user_credential ? t("modelControl.yes") : t("modelControl.no")} · {t("settings.flag.apiKey")}={row.has_user_api_key ? t("modelControl.yes") : t("modelControl.no")} · {t("settings.flag.oauth")}={row.has_user_oauth_token ? t("modelControl.yes") : t("modelControl.no")}
                    {row.user_updated_at ? ` · ${t("settings.updatedAt", { value: formatDateTime(row.user_updated_at) })}` : ""}
                  </p>
                  {row.auth_access_token_expires_at && (
                    <p>{t("settings.oauthExpiresAt", { value: formatDateTime(row.auth_access_token_expires_at) })}</p>
                  )}
                  {userConnectionTests[row.provider] && (
                    <p className={userConnectionTests[row.provider]?.ok ? "text-emerald-300" : "text-amber-300"}>
                      {t("settings.testResult", {
                        status: userConnectionTests[row.provider]?.ok ? t("settings.status.ok") : t("settings.status.failed"),
                        latency: userConnectionTests[row.provider]?.latency_ms ?? 0,
                      })}
                      {userConnectionTests[row.provider]?.reason ? ` · ${userConnectionTests[row.provider]?.reason}` : ""}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {(userCredentialLoading || activeUserSaveProvider || activeUserDeleteProvider || activeUserTestProvider || activeOauthProvider || activeUserModeProvider || activeUserPriorityProvider) && (
            <p className="text-xs text-neutral-600">{t("settings.syncingPersonalCredentials")}</p>
          )}
          {userCredentialError && <p className="text-xs text-rose-700">{userCredentialError}</p>}
          {userCredentialNotice && <p className="text-xs text-emerald-700">{userCredentialNotice}</p>}
        </div>
      </section>
      )}

      {activeTab === "workspace" && isAdmin && (
      <section className="mb-4 rounded-2xl border border-black/10 bg-[#fffdf8] p-3 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-600">
            <KeyRound size={12} /> {t("settings.providerApiKeysTitle")}
          </h3>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-7 items-center gap-1 rounded border border-black/10 bg-white px-2 text-[10px] font-mono text-neutral-700 hover:border-black/20 hover:text-neutral-950"
            >
              <RefreshCw size={11} /> {t("common.refresh")}
            </button>
          )}
        </div>

        {isAdmin ? (
          <div className="space-y-2">
            {providerCredentialRows.map((row) => (
              <div key={row.provider} className="rounded-xl border border-black/10 bg-white p-2">
                <div className="mb-2 flex items-center justify-between text-xs font-mono text-neutral-800">
                  <span>{row.provider.toUpperCase()}</span>
                  <span
                    className={
                      row.source === "stored"
                        ? "text-cyan-700"
                        : row.source === "env"
                          ? "text-amber-700"
                          : "text-neutral-500"
                    }
                  >
                    {row.source === "stored" ? t("settings.source.stored") : row.source === "env" ? t("settings.source.env") : t("settings.source.none")}
                  </span>
                </div>
                <div className="flex flex-col lg:flex-row gap-2">
                  <input
                    type="password"
                    placeholder={t("settings.providerApiKeyPlaceholder", { provider: row.provider.toUpperCase() })}
                    value={credentialDrafts[row.provider] ?? ""}
                    onChange={(event) =>
                      setCredentialDrafts((prev) => ({
                        ...prev,
                        [row.provider]: event.target.value,
                      }))
                    }
                    className="h-8 flex-1 rounded border border-black/10 bg-[#fffdf8] px-2 text-xs font-mono text-neutral-900"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                    onClick={() => void onSaveProviderKey(row.provider)}
                    disabled={(credentialDrafts[row.provider]?.trim().length ?? 0) < 8 || activeSaveProvider === row.provider}
                    className="h-8 rounded border border-cyan-300 bg-cyan-100 px-3 text-[10px] font-mono tracking-widest text-cyan-800 disabled:opacity-40"
                  >
                      {activeSaveProvider === row.provider ? t("settings.saving").toUpperCase() : t("common.save").toUpperCase()}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onTestProviderConnection(row.provider)}
                      disabled={activeTestProvider === row.provider}
                      className="h-8 rounded border border-emerald-300 bg-emerald-100 px-3 text-[10px] font-mono tracking-widest text-emerald-800 disabled:opacity-40"
                    >
                      {activeTestProvider === row.provider ? t("settings.testing").toUpperCase() : t("settings.test").toUpperCase()}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteStoredProviderKey(row.provider)}
                      disabled={row.source !== "stored" || activeDeleteProvider === row.provider}
                      className="h-8 rounded border border-black/10 bg-white px-3 text-[10px] font-mono tracking-widest text-neutral-800 disabled:opacity-40"
                    >
                      {activeDeleteProvider === row.provider ? t("settings.removing").toUpperCase() : t("settings.removeStored").toUpperCase()}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[10px] font-mono text-neutral-500">
                  {row.has_key ? t("settings.keyAvailable") : t("settings.noKey")} ·{" "}
                  {row.updated_at ? t("settings.updatedAt", { value: formatDateTime(row.updated_at) }) : t("settings.noStoredTimestamp")}
                </p>
                {connectionTests[row.provider] && (
                  <p
                    className={`mt-1 text-[10px] font-mono ${
                      connectionTests[row.provider]?.ok ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {t("settings.adminTestResult", {
                      status: connectionTests[row.provider]?.ok ? t("settings.status.ok") : t("settings.status.failed"),
                      latency: connectionTests[row.provider]?.latency_ms ?? 0,
                      models: connectionTests[row.provider]?.model_count ?? 0,
                    })}
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
              <p className="text-[10px] font-mono text-neutral-500">{t("settings.syncingProviderCredentials")}</p>
            )}
            {credentialError && <p className="text-[10px] font-mono text-rose-700">{credentialError}</p>}
            {credentialNotice && <p className="text-[10px] font-mono text-emerald-700">{credentialNotice}</p>}
          </div>
        ) : (
          <p className="text-xs font-mono text-neutral-500">
            {t("settings.providerApiKeysAdminOnly")}
          </p>
        )}
      </section>
      )}

      {activeTab === "interface" && (
      <section className="rounded-2xl border border-black/10 bg-[#fffdf8] p-3 shadow-sm">
        <h3 className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-600">
          <Clock3 size={12} /> {t("settings.hudRuntime")}
        </h3>
        <div className="mb-4 space-y-2 text-xs text-neutral-700">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-neutral-600">{t("settings.hud.visualCore")}</span>
            <button
              type="button"
              onClick={onToggleVisualCore}
              className={`h-7 px-2 rounded border text-[10px] font-mono tracking-widest ${
                visualCoreEnabled
                  ? "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800"
                  : "border-black/10 bg-white text-neutral-800"
              }`}
            >
              {visualCoreEnabled ? t("common.on") : t("common.off")}
            </button>
            <span className="text-[10px] text-neutral-500">{t("settings.hud.visualCoreHint")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-neutral-600">{t("settings.hud.autoFocusDefault")}</span>
            <button
              type="button"
              onClick={onToggleHudAutoFocusDefault}
              className={`h-7 px-2 rounded border text-[10px] font-mono tracking-widest ${
                hudAutoFocusDefault
                  ? "border-cyan-300 bg-cyan-100 text-cyan-800"
                  : "border-black/10 bg-white text-neutral-800"
              }`}
            >
              {hudAutoFocusDefault ? t("common.on") : t("common.off")}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-neutral-600">{t("settings.hud.manualHoldSeconds")}</span>
            <input
              type="number"
              min={15}
              max={600}
              step={1}
              value={hudHoldSecondsDraft}
              onChange={(event) => setHudHoldSecondsDraft(event.target.value)}
              className="h-7 w-24 rounded border border-black/10 bg-white px-2 text-[11px] font-mono text-neutral-900"
            />
            <button
              type="button"
              onClick={onSaveHudHoldSeconds}
              className="h-7 rounded border border-cyan-300 bg-cyan-100 px-2 text-[10px] font-mono tracking-widest text-cyan-800"
            >
              {t("common.save").toUpperCase()}
            </button>
            <span className="text-neutral-500">{t("settings.hud.manualHoldRange")}</span>
          </div>
          {hudRuntimeNotice && <p className="text-[10px] font-mono text-emerald-700">{hudRuntimeNotice}</p>}
        </div>
      </section>
      )}

      {activeTab === "policies" && (
      <section className="mt-4 rounded-2xl border border-black/10 bg-[#fffdf8] p-3 shadow-sm">
        <h3 className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-600">
          <RadioTower size={12} /> {t("settings.notificationChannels")}
        </h3>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {notificationChannels.map((channel) => (
            <div key={channel.key} className="rounded-xl border border-black/10 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-neutral-950">{channel.label}</p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-mono ${
                    channel.policy?.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-black/10 bg-[#fffdf8] text-neutral-500"
                  }`}
                >
                  {channel.policy?.enabled ? t("common.enabled") : t("common.disabled")}
                </span>
              </div>
              <div className="mt-3 space-y-1 text-[11px] text-neutral-600">
                <p>{t("settings.notification.minSeverity")}: {channel.policy?.min_severity ?? "-"}</p>
                <p>{t("settings.notification.events")}: {channel.policy ? formatEventTypes(channel.policy.event_types, t) : "-"}</p>
                {channel.runtime ? (
                  <>
                    <p>{t("settings.notification.sent")}: {channel.runtime.sent}</p>
                    <p>{t("settings.notification.skipped")}: {channel.runtime.skipped}</p>
                    <p>{t("settings.notification.failed")}: {channel.runtime.failed}</p>
                    <p>{t("settings.notification.lastSuccess")}: {channel.runtime.lastSuccessAt ? formatDateTime(channel.runtime.lastSuccessAt) : "-"}</p>
                    <p>{t("settings.notification.lastError")}: {channel.runtime.lastErrorAt ? formatDateTime(channel.runtime.lastErrorAt) : "-"}</p>
                    {channel.runtime.lastError ? <p className="text-amber-300">{channel.runtime.lastError}</p> : null}
                  </>
                ) : channel.key === "in_app" ? (
                  <>
                    <p>{t("settings.notification.listeners")}: {notificationRuntime?.listeners ?? 0}</p>
                    <p>{t("settings.notification.emitted")}: {notificationRuntime?.emitted ?? 0}</p>
                    <p>{t("settings.notification.suppressed")}: {notificationRuntime?.suppressed ?? 0}</p>
                    <p>{t("settings.notification.lastEvent")}: {notificationRuntime?.lastEventAt ? formatDateTime(notificationRuntime.lastEventAt) : "-"}</p>
                  </>
                ) : (
                  <p className="text-white/45">{t("settings.notification.runtimeInactive")}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      )}

      {activeTab === "policies" && (
      <section className="border border-white/10 rounded p-3 bg-black/30">
        <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase mb-2 flex items-center gap-2">
          <Shield size={12} /> {t("settings.policy.title")}
        </h3>
        <ul className="space-y-1 text-xs text-white/70">
          {policyItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      )}

      {activeTab === "policies" && (
      <section className="mt-4 border border-white/10 rounded p-3 bg-black/30">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase flex items-center gap-2">
              <Route size={12} /> {t("settings.policiesRuntime.title")}
            </h3>
            <p className="mt-1 text-[11px] text-white/45">{t("settings.policiesRuntime.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvancedRuntime((prev) => !prev)}
            className="inline-flex items-center gap-1 h-7 px-2 rounded border border-white/15 text-[10px] font-mono text-white/70 hover:text-white hover:border-white/30"
          >
            {showAdvancedRuntime ? t("settings.advanced.hide") : t("settings.advanced.show")}
          </button>
        </div>

        {!showAdvancedRuntime ? (
          <p className="text-xs text-white/55">{t("settings.advanced.hiddenHint")}</p>
        ) : (
          <>
        <section className="mb-4 border border-white/10 rounded p-3 bg-black/20">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase flex items-center gap-2">
                <RadioTower size={12} /> {t("settings.radar.title")}
              </h3>
              <p className="mt-1 text-[11px] text-white/45">{t("settings.radar.subtitle")}</p>
            </div>
            <span className="text-[10px] font-mono text-white/40">
              {t("settings.radar.metricsCount", { value: radarPackMetrics.length })}
            </span>
          </div>
          {!radarControl ? (
            <p className="text-xs font-mono text-white/40">{t("settings.radar.empty")}</p>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {radarControlItems.map((item) => (
                  <div key={item.label} className={`rounded border px-2 py-2 ${item.tone}`}>
                    <p className="text-[10px] font-mono uppercase tracking-widest opacity-70">{item.label}</p>
                    <p className="mt-1 text-sm font-semibold">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">{t("settings.radar.scanner.status")}</p>
                  <p className="mt-1 text-white/70">
                    {radarScannerWorker?.enabled ? t("common.enabled") : t("common.disabled")}
                    {radarScannerWorker?.inflight ? ` · ${t("settings.radar.scanner.inflight")}` : ""}
                  </p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">{t("settings.radar.scanner.lastRun")}</p>
                  <p className="mt-1 text-white/70">
                    {radarScannerWorker?.lastRun && typeof radarScannerWorker.lastRun.finishedAt === "string"
                      ? formatDateTime(radarScannerWorker.lastRun.finishedAt)
                      : "-"}
                  </p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">{t("settings.radar.sources.title")}</p>
                  <p className="mt-1 text-white/70">
                    {t("settings.radar.sources.summary", {
                      enabled: radarSourceSummary.enabled,
                      total: radarSourceSummary.total,
                    })}
                  </p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">{t("settings.radar.sources.failed")}</p>
                  <p className="mt-1 text-white/70">{radarSourceSummary.failed}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 text-[11px] font-mono text-white/55">
                <div className="rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">{t("settings.radar.disabledSourceTiers")}</p>
                  <p className="mt-1 text-white/70">
                    {radarControl.disabledSourceTiers.length > 0 ? radarControl.disabledSourceTiers.join(", ") : t("common.none")}
                  </p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">{t("settings.radar.disabledDomains")}</p>
                  <p className="mt-1 text-white/70">
                    {radarControl.disabledDomainIds.length > 0 ? radarControl.disabledDomainIds.join(", ") : t("common.none")}
                  </p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">{t("settings.radar.updatedBy")}</p>
                  <p className="mt-1 text-white/70">{radarControl.updatedBy ?? t("common.system")}</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">{t("settings.radar.updatedAt")}</p>
                  <p className="mt-1 text-white/70">{formatDateTime(radarControl.updatedAt)}</p>
                </div>
              </div>

              <div className="mt-4">
                <div>
                  <h4 className="text-[10px] font-mono text-white/45 uppercase tracking-widest">{t("settings.radar.metricsTitle")}</h4>
                  <p className="mt-1 text-[11px] text-white/40">{t("settings.radar.metricsSubtitle")}</p>
                </div>
                {radarPackMetrics.length === 0 ? (
                  <p className="mt-2 text-xs font-mono text-white/40">{t("settings.radar.metricsEmpty")}</p>
                ) : (
                  <div className="mt-2 max-h-64 overflow-y-auto space-y-2">
                    {radarPackMetrics.map((metric) => (
                      <div key={metric.domainId} className="rounded border border-white/10 bg-black/20 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-mono text-white/75 truncate">{metric.domainId}</p>
                            <p className="mt-1 text-[10px] font-mono text-white/40">
                              {t("settings.radar.metric.lastEvent")}: {metric.lastEventAt ? formatDateTime(metric.lastEventAt) : "-"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-mono uppercase tracking-widest text-white/35">{t("settings.radar.metric.calibration")}</p>
                            <p className="text-base font-semibold text-cyan-200">{Math.round(metric.calibrationScore * 100)}%</p>
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-mono text-white/55 md:grid-cols-4 xl:grid-cols-8">
                          <div>
                            <p className="text-white/35">{t("settings.radar.metric.promotions")}</p>
                            <p className="mt-1 text-white/75">{metric.promotionCount}</p>
                          </div>
                          <div>
                            <p className="text-white/35">{t("settings.radar.metric.dossiers")}</p>
                            <p className="mt-1 text-white/75">{metric.dossierCount}</p>
                          </div>
                          <div>
                            <p className="text-white/35">{t("settings.radar.metric.actions")}</p>
                            <p className="mt-1 text-white/75">{metric.actionCount}</p>
                          </div>
                          <div>
                            <p className="text-white/35">{t("settings.radar.metric.autoExecute")}</p>
                            <p className="mt-1 text-white/75">{metric.autoExecuteCount}</p>
                          </div>
                          <div>
                            <p className="text-white/35">{t("settings.radar.metric.confirmed")}</p>
                            <p className="mt-1 text-emerald-300">{metric.confirmedCount}</p>
                          </div>
                          <div>
                            <p className="text-white/35">{t("settings.radar.metric.invalidated")}</p>
                            <p className="mt-1 text-rose-300">{metric.invalidatedCount}</p>
                          </div>
                          <div>
                            <p className="text-white/35">{t("settings.radar.metric.mixed")}</p>
                            <p className="mt-1 text-amber-300">{metric.mixedCount}</p>
                          </div>
                          <div>
                            <p className="text-white/35">{t("settings.radar.metric.unresolved")}</p>
                            <p className="mt-1 text-white/75">{metric.unresolvedCount}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <section className="mb-4 border border-white/10 rounded p-3 bg-black/20">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase flex items-center gap-2">
              <Database size={12} /> {t("settings.modelRegistry.title")}
            </h3>
            <span className="text-[10px] font-mono text-white/40">
              {registryLoading ? "..." : t("settings.modelRegistry.count", { value: registryModels.length })}
            </span>
          </div>
          {registryModels.length === 0 && !registryLoading && (
            <p className="text-xs font-mono text-white/40">{t("settings.modelRegistry.empty")}</p>
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

        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] font-mono text-white/50 tracking-widest uppercase flex items-center gap-2">
            <Route size={12} /> {t("settings.routingPolicies.title")}
          </h3>
          <button
            type="button"
            onClick={() => setShowPolicyForm(!showPolicyForm)}
            className="inline-flex items-center gap-1 h-6 px-2 rounded border border-cyan-500/30 text-[10px] font-mono text-cyan-300 hover:text-cyan-100"
          >
            <Plus size={10} /> {t("common.add")}
          </button>
        </div>

        {showPolicyForm && (
          <div className="mb-3 p-2 border border-cyan-500/20 rounded bg-cyan-950/10 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder={t("settings.routingPolicies.form.taskTypePlaceholder")}
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
              placeholder={t("settings.routingPolicies.form.modelIdPlaceholder")}
              value={policyDraft.model_id}
              onChange={(e) => setPolicyDraft((d) => ({ ...d, model_id: e.target.value }))}
              className="w-full h-7 rounded border border-white/15 bg-black/50 px-2 text-[11px] font-mono"
            />
            <div className="flex gap-2 items-center">
              <label className="text-[10px] text-white/50">{t("settings.routingPolicies.form.tier")}</label>
              <input
                type="number" min={1} max={3}
                value={policyDraft.tier}
                onChange={(e) => setPolicyDraft((d) => ({ ...d, tier: Number(e.target.value) }))}
                className="h-7 w-14 rounded border border-white/15 bg-black/50 px-2 text-[11px] font-mono"
              />
              <label className="text-[10px] text-white/50">{t("settings.routingPolicies.form.priority")}</label>
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
                {t("common.save").toUpperCase()}
              </button>
            </div>
          </div>
        )}

        {policyError && <p className="text-[10px] font-mono text-rose-300 mb-2">{policyError}</p>}
        {policyNotice && <p className="text-[10px] font-mono text-emerald-300 mb-2">{policyNotice}</p>}

        {policiesLoading && <p className="text-[10px] font-mono text-white/40">{t("settings.routingPolicies.loading")}</p>}
        {!policiesLoading && policies.length === 0 && (
          <p className="text-xs font-mono text-white/40">{t("settings.routingPolicies.empty")}</p>
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
                    {p.is_active ? t("common.on") : t("common.off")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
          </>
        )}
      </section>
      )}
    </main>
  );
}
