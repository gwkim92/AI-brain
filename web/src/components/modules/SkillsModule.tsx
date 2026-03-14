"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, BookOpenText, Play, Search, Wand2 } from "lucide-react";

import { MarkdownLite } from "@/components/ui/MarkdownLite";
import { useHUD } from "@/components/providers/HUDProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { ApiRequestError } from "@/lib/api/client";
import { findSkills, getSkillResource, listSkills, useSkill as executeSkill } from "@/lib/api/endpoints";
import type {
  SkillFindResult,
  SkillRecord,
  SkillResourceRecord,
  SkillUseResult,
} from "@/lib/api/types";
import type { TranslationKey } from "@/lib/locale";
import { consumeSkillPrefill, subscribeSkillPrefill } from "@/lib/skills/prefill";

function mapWorkspaceLabel(
  value: SkillRecord["suggestedWorkspacePreset"] | SkillUseResult["preview"]["suggestedWorkspacePreset"],
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
): string {
  if (value === "research") return t("sidebar.workspace.research.title");
  if (value === "execution") return t("sidebar.workspace.code.title");
  if (value === "control") return t("sidebar.workspace.intelligence.title");
  return t("sidebar.workspace.mission.title");
}

function uniqueWidgets(value: string[]): string[] {
  return Array.from(new Set(value.filter((item) => item.trim().length > 0)));
}

export function SkillsModule() {
  const { t } = useLocale();
  const { openWidgets } = useHUD();
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [matches, setMatches] = useState<SkillFindResult["matches"]>([]);
  const [selectedResource, setSelectedResource] = useState<SkillResourceRecord | null>(null);
  const [previewResult, setPreviewResult] = useState<SkillUseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedId) ?? null,
    [selectedId, skills]
  );

  const applyPrefill = useCallback((prefill: { prompt: string; skillId?: string }) => {
    setPrompt(prefill.prompt);
    if (prefill.skillId) {
      setSelectedId(prefill.skillId);
    }
  }, []);

  const refreshSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listSkills();
      setSkills(result.skills);
      setSelectedId((current) => current ?? result.skills[0]?.id ?? null);
      const queuedPrefill = consumeSkillPrefill();
      if (queuedPrefill) {
        applyPrefill(queuedPrefill);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("skills.error.load"));
      }
      setSkills([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, [applyPrefill, t]);

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  useEffect(() => subscribeSkillPrefill(applyPrefill), [applyPrefill]);

  const loadResource = async (resourceId: string) => {
    if (!selectedSkill) return;
    setError(null);
    try {
      const result = await getSkillResource(selectedSkill.id, resourceId);
      setSelectedResource(result.resource);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("skills.error.resource"));
      }
    }
  };

  const onFind = async () => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return;
    setSearching(true);
    setError(null);
    try {
      const result = await findSkills({ prompt: normalizedPrompt, limit: 5 });
      setMatches(result.matches);
      if (result.recommended_skill_id) {
        setSelectedId(result.recommended_skill_id);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("skills.error.find"));
      }
    } finally {
      setSearching(false);
    }
  };

  const onUse = async (execute: boolean) => {
    if (!selectedSkill || !prompt.trim()) return;
    setExecuting(true);
    setError(null);
    try {
      const result = await executeSkill({
        skill_id: selectedSkill.id,
        prompt: prompt.trim(),
        execute,
      });
      setPreviewResult(result);

      if (!execute) return;

      if (result.result_type === "jarvis_request" && result.session) {
        const widgetPlan = uniqueWidgets(["skills", ...result.preview.suggestedWidgets]);
        const focus = widgetPlan.includes("dossier")
          ? "dossier"
          : widgetPlan.includes("assistant")
            ? "assistant"
            : widgetPlan[0] ?? "skills";
        openWidgets(widgetPlan, {
          focus,
          replace: false,
          activate: "all",
        });
      } else if (result.result_type === "model_recommendation") {
        openWidgets(["skills", "model_control", "notifications"], {
          focus: "model_control",
          replace: false,
          activate: "all",
        });
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t("skills.error.use"));
      }
    } finally {
      setExecuting(false);
    }
  };

  return (
    <main className="w-full h-full bg-transparent text-white p-4 flex flex-col gap-4">
      <header className="border-l-2 border-cyan-500 pl-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-mono font-bold tracking-widest text-cyan-400 flex items-center gap-2">
            <Bot size={14} /> {t("widget.title.skills").toUpperCase()}
          </h2>
          <p className="text-[10px] font-mono text-white/40">{t("skills.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void refreshSkills()}
          className="inline-flex items-center gap-1 h-7 px-2 rounded border border-white/20 text-[10px] font-mono text-white/70 hover:text-white"
        >
          <BookOpenText size={11} /> {t("common.refresh").toUpperCase()}
        </button>
      </header>

      <section className="rounded border border-white/10 bg-black/30 p-3 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-2">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder={t("skills.promptPlaceholder")}
          className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs"
        />
        <div className="flex xl:flex-col gap-2">
          <button
            type="button"
            onClick={() => void onFind()}
            disabled={searching}
            className="inline-flex items-center justify-center gap-1 rounded border border-cyan-500/40 px-3 py-2 text-[10px] font-mono text-cyan-300 disabled:opacity-50"
          >
            <Search size={11} /> {(searching ? t("skills.matching") : t("common.find")).toUpperCase()}
          </button>
          <button
            type="button"
            onClick={() => void onUse(false)}
            disabled={executing || !selectedSkill}
            className="inline-flex items-center justify-center gap-1 rounded border border-white/20 px-3 py-2 text-[10px] font-mono text-white/75 disabled:opacity-50"
          >
            <Wand2 size={11} /> {t("common.preview").toUpperCase()}
          </button>
          <button
            type="button"
            onClick={() => void onUse(true)}
            disabled={executing || !selectedSkill}
            className="inline-flex items-center justify-center gap-1 rounded border border-emerald-500/40 px-3 py-2 text-[10px] font-mono text-emerald-300 disabled:opacity-50"
          >
            <Play size={11} /> {(executing ? t("taskStatus.running") : t("common.execute")).toUpperCase()}
          </button>
        </div>
      </section>

      {error && <p className="text-xs font-mono text-rose-300">{error}</p>}

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-3 overflow-hidden">
        <section className="rounded border border-white/10 bg-black/30 overflow-y-auto p-2 space-y-2">
          {loading && <p className="text-xs font-mono text-white/45">{t("skills.loading")}</p>}
          {!loading && skills.length === 0 && <p className="text-xs font-mono text-white/45">{t("skills.empty")}</p>}
          {skills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => {
                setSelectedId(skill.id);
                setSelectedResource(null);
              }}
              className={`w-full rounded border px-3 py-2 text-left ${selectedId === skill.id ? "border-cyan-500/40 bg-cyan-500/10" : "border-white/10 bg-black/30"}`}
            >
              <p className="text-sm text-white/90">{skill.title}</p>
              <p className="mt-1 text-[10px] font-mono text-white/45">{skill.category} · {skill.executionKind}</p>
            </button>
          ))}
        </section>

        <section className="rounded border border-white/10 bg-black/30 overflow-y-auto p-4 space-y-4">
          {!selectedSkill && <p className="text-xs font-mono text-white/45">{t("skills.select")}</p>}
          {selectedSkill && (
            <>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg text-white/90">{selectedSkill.title}</h3>
                  <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-mono text-cyan-200">
                    {selectedSkill.executionKind}
                  </span>
                  <span className="rounded border border-white/15 bg-black/40 px-2 py-0.5 text-[9px] font-mono text-white/55">
                    {mapWorkspaceLabel(selectedSkill.suggestedWorkspacePreset, t)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-white/70">{selectedSkill.summary}</p>
                <p className="mt-2 text-[10px] font-mono text-white/45">
                  {t("skills.line.widgets", { value: selectedSkill.suggestedWidgets.join(" · ") })}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedSkill.resources.map((resource) => (
                  <button
                    key={resource.id}
                    type="button"
                    onClick={() => void loadResource(resource.id)}
                    className={`rounded border px-2 py-1 text-[10px] font-mono ${selectedResource?.id === resource.id ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/15 bg-black/35 text-white/65"}`}
                  >
                    {resource.title}
                  </button>
                ))}
              </div>

              {matches.length > 0 && (
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <p className="text-[10px] font-mono tracking-widest text-white/45">{t("skills.matches").toUpperCase()}</p>
                  <div className="mt-2 space-y-2">
                    {matches.map((match) => (
                      <div key={match.skill.id} className="rounded border border-white/10 bg-black/30 px-3 py-2">
                        <p className="text-sm text-white/85">
                          {match.skill.title}{" "}
                          <span className="text-[10px] font-mono text-white/40">
                            {t("common.score")} {match.score}
                          </span>
                        </p>
                        <p className="mt-1 text-[11px] text-white/60">{match.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {previewResult?.preview && (
                <div className="rounded border border-emerald-500/20 bg-emerald-500/10 p-3 space-y-2">
                  <p className="text-[10px] font-mono tracking-widest text-emerald-200">{t("skills.previewTitle").toUpperCase()}</p>
                  <p className="text-sm text-white/80">{previewResult.preview.rationale}</p>
                  <p className="text-[10px] font-mono text-white/45">
                    {t("skills.line.workspace", {
                      workspace: mapWorkspaceLabel(previewResult.preview.suggestedWorkspacePreset, t),
                      widgets: previewResult.preview.suggestedWidgets.join(" · "),
                    })}
                  </p>
                  <pre className="whitespace-pre-wrap rounded border border-white/10 bg-black/30 p-3 text-[11px] text-white/75">
                    {previewResult.preview.suggestedPrompt}
                  </pre>
                  {previewResult.result_type === "jarvis_request" && previewResult.session && (
                    <p className="text-[11px] text-emerald-100/90">
                      {t("skills.sessionCreated", {
                        id: previewResult.session.id,
                        status: previewResult.session.status,
                      })}
                    </p>
                  )}
                  {previewResult.result_type === "model_recommendation" && previewResult.recommendation && (
                    <p className="text-[11px] text-emerald-100/90">
                      {t("skills.recommendationResult", {
                        provider: previewResult.recommendation.recommendedProvider,
                        model: previewResult.recommendation.recommendedModelId,
                      })}
                    </p>
                  )}
                </div>
              )}

              {selectedResource && (
                <div className="rounded border border-white/10 bg-black/35 p-3">
                  <p className="text-[10px] font-mono tracking-widest text-white/45">{selectedResource.title}</p>
                  <div className="mt-3 text-sm text-white/80">
                    <MarkdownLite content={selectedResource.content} />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
