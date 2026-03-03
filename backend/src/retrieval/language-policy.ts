export type ResponseLanguage = 'ko' | 'en' | 'ja' | 'zh' | 'unknown';

type ScriptCounts = {
  hangul: number;
  kana: number;
  han: number;
  latin: number;
};

function stripNoisySegments(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/giu, '$1')
    .replace(/https?:\/\/[^\s<>()]+/giu, ' ')
    .replace(/[`*_#>-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function extractBodyBeforeSources(value: string): string {
  const marker = /\n\s*sources?\s*:/iu.exec(value);
  if (!marker || typeof marker.index !== 'number') {
    return value;
  }
  return value.slice(0, marker.index);
}

function countScripts(value: string): ScriptCounts {
  const counts: ScriptCounts = {
    hangul: 0,
    kana: 0,
    han: 0,
    latin: 0
  };

  for (const ch of value) {
    if (/[\uac00-\ud7a3]/u.test(ch)) {
      counts.hangul += 1;
      continue;
    }
    if (/[\u3040-\u30ff]/u.test(ch)) {
      counts.kana += 1;
      continue;
    }
    if (/[\u4e00-\u9fff]/u.test(ch)) {
      counts.han += 1;
      continue;
    }
    if (/[a-z]/iu.test(ch)) {
      counts.latin += 1;
    }
  }

  return counts;
}

function dominantLanguageFromCounts(counts: ScriptCounts): ResponseLanguage {
  const maxCount = Math.max(counts.hangul, counts.kana, counts.han, counts.latin);
  if (maxCount <= 0) {
    return 'unknown';
  }

  if (counts.hangul === maxCount) {
    return 'ko';
  }
  if (counts.kana === maxCount) {
    return 'ja';
  }
  if (counts.han === maxCount && counts.hangul === 0 && counts.kana === 0) {
    return 'zh';
  }
  if (counts.latin === maxCount) {
    return 'en';
  }
  return 'unknown';
}

function scoreAlignment(language: ResponseLanguage, counts: ScriptCounts): number {
  const total = counts.hangul + counts.kana + counts.han + counts.latin;
  if (total <= 0) {
    return 1;
  }

  if (language === 'ko') {
    return counts.hangul / total;
  }
  if (language === 'en') {
    return counts.latin / total;
  }
  if (language === 'ja') {
    return (counts.kana + counts.han * 0.4) / total;
  }
  if (language === 'zh') {
    return counts.han / total;
  }
  return 1;
}

export function detectPromptLanguage(prompt: string): ResponseLanguage {
  const text = stripNoisySegments(prompt);
  const counts = countScripts(text);
  return dominantLanguageFromCounts(counts);
}

export function buildLanguageSystemInstruction(prompt: string): {
  expectedLanguage: ResponseLanguage | null;
  instruction: string;
} {
  const detected = detectPromptLanguage(prompt);
  if (detected === 'unknown') {
    return {
      expectedLanguage: null,
      instruction: ''
    };
  }

  const languageLabel = {
    ko: 'Korean',
    en: 'English',
    ja: 'Japanese',
    zh: 'Chinese'
  }[detected];

  return {
    expectedLanguage: detected,
    instruction: [
      `Respond strictly in ${languageLabel}.`,
      'Do not mix other languages except unavoidable proper nouns, company names, or source titles.',
      'If a source is in another language, summarize its meaning in the target language.'
    ].join('\n')
  };
}

export function evaluateLanguageAlignment(
  expectedLanguage: ResponseLanguage | null | undefined,
  outputText: string
): {
  passed: boolean;
  detectedLanguage: ResponseLanguage;
  score: number;
} {
  if (!expectedLanguage || expectedLanguage === 'unknown') {
    return {
      passed: true,
      detectedLanguage: 'unknown',
      score: 1
    };
  }

  const body = extractBodyBeforeSources(outputText);
  const normalized = stripNoisySegments(body);
  const counts = countScripts(normalized);
  const detectedLanguage = dominantLanguageFromCounts(counts);
  const score = scoreAlignment(expectedLanguage, counts);
  const minScoreByLanguage: Record<Exclude<ResponseLanguage, 'unknown'>, number> = {
    ko: 0.55,
    en: 0.65,
    ja: 0.5,
    zh: 0.65
  };

  return {
    passed: score >= minScoreByLanguage[expectedLanguage],
    detectedLanguage,
    score
  };
}
