import type { WatcherWorldModelDelta } from "@/lib/api/types";
import type { TranslationKey } from "@/lib/locale";

type Translator = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export function formatWorldModelStateKey(key: string): string {
  return key.replaceAll("_", " ");
}

export function formatSignedWorldModelDelta(value: number): string {
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export function summarizeWorldModelDelta(
  delta: WatcherWorldModelDelta | null | undefined,
  t: Translator
): string | null {
  if (!delta?.hasMeaningfulShift) {
    return null;
  }

  const segments: string[] = [];

  if (delta.topStateShift && Math.abs(delta.topStateShift.delta) > 0) {
    segments.push(
      t("watchers.result.structuralShift.state", {
        value: `${formatWorldModelStateKey(delta.topStateShift.key)} ${formatSignedWorldModelDelta(delta.topStateShift.delta)}`,
      })
    );
  }
  if (Math.abs(delta.primaryHypothesisShift) > 0) {
    segments.push(
      t("watchers.result.structuralShift.primary", {
        value: formatSignedWorldModelDelta(delta.primaryHypothesisShift),
      })
    );
  }
  if (Math.abs(delta.counterHypothesisShift) > 0) {
    segments.push(
      t("watchers.result.structuralShift.counter", {
        value: formatSignedWorldModelDelta(delta.counterHypothesisShift),
      })
    );
  }
  if (delta.invalidationHitCount > 0) {
    segments.push(
      t("watchers.result.structuralShift.invalidation", {
        value: delta.invalidationHitCount,
      })
    );
  }
  if (delta.bottleneckShiftCount > 0) {
    segments.push(
      t("watchers.result.structuralShift.bottleneck", {
        value: delta.bottleneckShiftCount,
      })
    );
  }

  return segments.slice(0, 3).join(" · ");
}
