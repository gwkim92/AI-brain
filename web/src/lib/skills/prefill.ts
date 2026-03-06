import type { SkillId } from "@/lib/api/types";

const STORAGE_KEY = "jarvis.skills.prefill.v1";
const EVENT_NAME = "jarvis:skills-prefill";

export type SkillPrefill = {
  prompt: string;
  skillId?: SkillId;
};

function parseStoredValue(raw: string | null): SkillPrefill | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SkillPrefill;
    if (!parsed || typeof parsed.prompt !== "string" || parsed.prompt.trim().length === 0) {
      return null;
    }
    return {
      prompt: parsed.prompt,
      skillId: typeof parsed.skillId === "string" ? parsed.skillId : undefined,
    };
  } catch {
    return null;
  }
}

export function publishSkillPrefill(prefill: SkillPrefill): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefill));
  window.dispatchEvent(new CustomEvent<SkillPrefill>(EVENT_NAME, { detail: prefill }));
}

export function consumeSkillPrefill(): SkillPrefill | null {
  if (typeof window === "undefined") return null;
  const parsed = parseStoredValue(window.sessionStorage.getItem(STORAGE_KEY));
  if (parsed) {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
  return parsed;
}

export function subscribeSkillPrefill(handler: (prefill: SkillPrefill) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SkillPrefill>).detail;
    if (!detail || typeof detail.prompt !== "string" || detail.prompt.trim().length === 0) {
      return;
    }
    handler(detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
