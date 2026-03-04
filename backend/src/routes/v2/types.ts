import type { RouteContext } from '../types';

export type V2FeatureFlags = {
  routesEnabled: boolean;
  commandCompilerEnabled: boolean;
  retrievalEnabled: boolean;
  teamEnabled: boolean;
  codeLoopEnabled: boolean;
  financeEnabled: boolean;
  schemaUiEnabled: boolean;
};

export type V2RouteContext = RouteContext & {
  v2Flags: V2FeatureFlags;
};

export function resolveV2FeatureFlags(ctx: RouteContext): V2FeatureFlags {
  return {
    routesEnabled: ctx.env.V2_ROUTES_ENABLED,
    commandCompilerEnabled: ctx.env.V2_COMMAND_COMPILER_ENABLED,
    retrievalEnabled: ctx.env.V2_RETRIEVAL_ENABLED,
    teamEnabled: ctx.env.V2_TEAM_ENABLED,
    codeLoopEnabled: ctx.env.V2_CODE_LOOP_ENABLED,
    financeEnabled: ctx.env.V2_FINANCE_ENABLED,
    schemaUiEnabled: ctx.env.V2_SCHEMA_UI_ENABLED
  };
}

