export type QueryRewriteInput = {
  prompt: string;
  maxVariants?: number;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.?!,;:]+$/u, '').trim();
}

export function generateQueryRewriteCandidates(input: QueryRewriteInput): string[] {
  const maxVariants = Math.max(1, Math.min(input.maxVariants ?? 4, 8));
  const base = normalizeWhitespace(stripTrailingPunctuation(input.prompt));
  if (!base) {
    return [];
  }

  const candidates = new Set<string>();
  candidates.add(base);

  const temporal = `${base} latest updates`;
  const koreanTemporal = `${base} 최신 업데이트`;
  const sourceFocused = `${base} source links`;

  for (const candidate of [temporal, koreanTemporal, sourceFocused]) {
    const normalized = normalizeWhitespace(candidate);
    if (normalized.length > 0) {
      candidates.add(normalized);
    }
    if (candidates.size >= maxVariants) {
      break;
    }
  }

  return Array.from(candidates).slice(0, maxVariants);
}
