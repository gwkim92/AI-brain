import type { TranslationKey } from "@/lib/locale";

export type NormalizedExecutionOption =
  | "read_only_review"
  | "approval_required_write"
  | "safe_auto_run";

export type ExecutionOptionDescriptor = {
  value: NormalizedExecutionOption;
  label: string;
  hint: string;
  toneClassName: string;
};

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

export function normalizeExecutionOption(
  value: string | null | undefined
): NormalizedExecutionOption | null {
  if (value === "read_only_first" || value === "read_only_review") {
    return "read_only_review";
  }
  if (value === "standard" || value === "approval_required_write") {
    return "approval_required_write";
  }
  if (value === "safe_auto_run") {
    return "safe_auto_run";
  }
  return null;
}

export function describeExecutionOption(
  t: Translate,
  value: string | null | undefined
): ExecutionOptionDescriptor | null {
  const normalized = normalizeExecutionOption(value);
  if (!normalized) {
    return null;
  }
  if (normalized === "read_only_review") {
    return {
      value: normalized,
      label: t("assistant.executionOption.readOnlyReview.label"),
      hint: t("assistant.executionOption.readOnlyReview.hint"),
      toneClassName: "border-cyan-500/25 bg-cyan-500/10 text-cyan-100",
    };
  }
  if (normalized === "approval_required_write") {
    return {
      value: normalized,
      label: t("assistant.executionOption.approvalRequiredWrite.label"),
      hint: t("assistant.executionOption.approvalRequiredWrite.hint"),
      toneClassName: "border-amber-500/25 bg-amber-500/10 text-amber-100",
    };
  }
  return {
    value: normalized,
    label: t("assistant.executionOption.safeAutoRun.label"),
    hint: t("assistant.executionOption.safeAutoRun.hint"),
    toneClassName: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
  };
}
