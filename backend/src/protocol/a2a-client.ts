export type A2AAgentCapabilities = {
  supportedVersions: string[];
};

export type A2ANegotiationResult =
  | { ok: true; version: string }
  | { ok: false; reason: 'version_mismatch' };

export function negotiateA2AVersion(
  local: A2AAgentCapabilities,
  remote: A2AAgentCapabilities
): A2ANegotiationResult {
  const shared = local.supportedVersions.filter((version) => remote.supportedVersions.includes(version));

  if (shared.length === 0) {
    return {
      ok: false,
      reason: 'version_mismatch'
    };
  }

  const selected = shared.sort(compareVersionDesc)[0]!;
  return {
    ok: true,
    version: selected
  };
}

function compareVersionDesc(left: string, right: string): number {
  const l = toTuple(left);
  const r = toTuple(right);

  for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
    const lv = l[i] ?? 0;
    const rv = r[i] ?? 0;
    if (lv !== rv) {
      return rv - lv;
    }
  }

  return 0;
}

function toTuple(version: string): number[] {
  return version.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
}
