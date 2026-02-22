export type McpStreamRequest = {
  origin?: string;
  payload: {
    method: string;
    params?: unknown;
  };
};

export type McpTransportOptions = {
  allowedOrigins: string[];
};

export type McpStreamResult =
  | { accepted: true }
  | { accepted: false; reason: 'origin_not_allowed' };

export async function handleMcpStreamRequest(
  request: McpStreamRequest,
  options: McpTransportOptions
): Promise<McpStreamResult> {
  if (!isOriginAllowed(request.origin, options.allowedOrigins)) {
    return {
      accepted: false,
      reason: 'origin_not_allowed'
    };
  }

  return {
    accepted: true
  };
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) {
    return false;
  }
  return allowedOrigins.includes(origin);
}
