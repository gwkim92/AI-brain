import { z } from 'zod';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const ABI_PATTERN = /^\d+\.x$/u;

export const ModuleManifestSchema = z.object({
  module_id: z.string().min(3).max(120),
  title: z.string().min(1).max(160).default('Untitled Module'),
  description: z.string().max(2000).default(''),
  owner: z.string().max(120).optional(),
  module_version: z.string().regex(SEMVER_PATTERN, 'module_version must be semver'),
  abi_version: z.string().regex(ABI_PATTERN, 'abi_version must look like 1.x'),
  input_schema_ref: z.string().min(1).max(500),
  output_schema_ref: z.string().min(1).max(500),
  required_permissions: z.array(z.string().min(1).max(120)).max(100).default([]),
  dependencies: z.array(z.string().min(1).max(240)).max(100).default([]),
  failure_modes: z.array(z.string().min(1).max(240)).max(100).default([]),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

export function parseModuleManifest(input: unknown): ModuleManifest {
  return ModuleManifestSchema.parse(input);
}

export function getAbiMajor(abiVersion: string): number | null {
  const [major] = abiVersion.split('.', 1);
  const parsed = Number.parseInt(major ?? '', 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}
