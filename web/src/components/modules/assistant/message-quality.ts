export type ProviderUnavailableReason = "NEWS_BRIEFING_UNAVAILABLE" | "GROUNDED_RETRIEVAL_UNAVAILABLE";
export type QualityGateResult = "hard_fail" | "soft_warn" | "pass";

type BlockedReasonCode =
    | "grounding_local_violation"
    | "template_artifact"
    | "language_mismatch"
    | "insufficient_claim_citation_coverage"
    | "missing_grounded_claims"
    | "insufficient_sources"
    | "insufficient_domain_diversity"
    | "insufficient_retrieval_sources"
    | "insufficient_retrieval_domain_diversity"
    | "insufficient_retrieval_freshness"
    | "low_retrieval_freshness_ratio";

const BLOCKED_REASON_LABELS: Record<BlockedReasonCode, string> = {
    grounding_local_violation: "로컬 모델 경로에서 grounding 정책 위반이 감지되었습니다.",
    template_artifact: "모델 출력 형식이 깨져 안전하게 표시할 수 없습니다.",
    language_mismatch: "요청한 언어와 응답 언어가 일치하지 않았습니다.",
    insufficient_claim_citation_coverage: "문장과 출처 연결이 부족해 근거 신뢰도가 낮습니다.",
    missing_grounded_claims: "출처로 검증 가능한 핵심 문장을 만들지 못했습니다.",
    insufficient_sources: "근거 출처 수가 부족합니다.",
    insufficient_domain_diversity: "출처 도메인이 편중되어 신뢰도를 확보하지 못했습니다.",
    insufficient_retrieval_sources: "검색 결과 수가 부족합니다.",
    insufficient_retrieval_domain_diversity: "검색 출처가 한두 도메인에 편중되었습니다.",
    insufficient_retrieval_freshness: "최신성 기준을 만족하는 출처가 부족합니다.",
    low_retrieval_freshness_ratio: "최신 출처 비율이 기준보다 낮습니다.",
};

export function isQualityGuardFallbackOutput(output: string): boolean {
    return (
        output.includes("근거 기반 응답 품질 검증에 실패했습니다.") ||
        output.includes("실시간 뉴스 브리핑 품질 검증에 실패했습니다.")
    );
}

export function buildProviderUnavailableMessage(reason: ProviderUnavailableReason): string {
    if (reason === "NEWS_BRIEFING_UNAVAILABLE") {
        return [
            "현재 뉴스 브리핑을 실행할 수 없습니다.",
            "외부 뉴스 품질 provider(OpenAI/Gemini/Anthropic)가 연결되어 있지 않아 신뢰 가능한 최신 브리핑을 생성할 수 없습니다.",
            "설정 > Providers에서 API 키를 연결한 뒤 다시 요청하세요.",
        ].join("\n");
    }

    return [
        "현재 최신성/사실성 검증이 필요한 요청을 실행할 수 없습니다.",
        "외부 grounding provider(OpenAI/Gemini/Anthropic)가 연결되어 있지 않아 근거 기반 응답을 생성할 수 없습니다.",
        "설정 > Providers에서 API 키를 연결한 뒤 다시 요청하세요.",
    ].join("\n");
}

export function resolveProviderUnavailableReason(details: unknown): ProviderUnavailableReason | null {
    if (!details || typeof details !== "object") {
        return null;
    }
    const reason = (details as { reason?: unknown }).reason;
    if (reason === "NEWS_BRIEFING_UNAVAILABLE" || reason === "GROUNDED_RETRIEVAL_UNAVAILABLE") {
        return reason;
    }
    return null;
}

function normalizeQualityGateResult(value: unknown): QualityGateResult | null {
    if (value === "hard_fail" || value === "soft_warn" || value === "pass") {
        return value;
    }
    return null;
}

export function resolveQualityGateResult(params: {
    content: string;
    groundingStatus?: string;
    qualityGateResult?: string;
}): QualityGateResult {
    const explicit = normalizeQualityGateResult(params.qualityGateResult);
    if (explicit) {
        return explicit;
    }
    if (params.groundingStatus === "blocked_due_to_quality_gate") {
        return "hard_fail";
    }
    if (params.groundingStatus === "soft_warn" || params.groundingStatus === "served_with_limits") {
        return "soft_warn";
    }
    return "pass";
}

export function isBlockedQualityOutput(content: string, groundingStatus?: string, qualityGateResult?: string): boolean {
    return resolveQualityGateResult({ content, groundingStatus, qualityGateResult }) === "hard_fail";
}

export function isSoftWarnQualityOutput(content: string, groundingStatus?: string, qualityGateResult?: string): boolean {
    return resolveQualityGateResult({ content, groundingStatus, qualityGateResult }) === "soft_warn";
}

export function parseQualityReasonCodes(content: string, preferredCodes?: string[]): string[] {
    if (Array.isArray(preferredCodes) && preferredCodes.length > 0) {
        return Array.from(
            new Set(
                preferredCodes
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0)
            )
        );
    }
    return parseBlockedReasons(content);
}

export function isSoftWarnReasonCode(code: string): boolean {
    return code === "language_mismatch" || code === "insufficient_claim_citation_coverage";
}

export function hasOnlySoftWarnReasons(codes: string[]): boolean {
    return codes.length > 0 && codes.every((code) => isSoftWarnReasonCode(code));
}

export function parseBlockedReasons(content: string): string[] {
    const reasonLine = content
        .split(/\r?\n/g)
        .find((line) => line.trim().toLowerCase().startsWith("사유:"));
    if (!reasonLine) {
        return [];
    }
    const parsed = reasonLine
        .replace(/^사유:\s*/iu, "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    return Array.from(new Set(parsed));
}

export function mapBlockedReasonLabel(code: string): string {
    if (code in BLOCKED_REASON_LABELS) {
        return BLOCKED_REASON_LABELS[code as BlockedReasonCode];
    }
    return "응답 품질 기준을 충족하지 못했습니다.";
}
