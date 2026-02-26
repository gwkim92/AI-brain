import type { FastifyReply, FastifyRequest } from 'fastify';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR'
  | 'PLAN_GENERATION_FAILED';

export type ApiErrorBody = {
  request_id: string;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
};

export function sendSuccess(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  data: unknown,
  meta: Record<string, unknown> = {}
): FastifyReply {
  return reply.code(statusCode).send({
    request_id: request.id,
    data,
    meta
  });
}

export function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown
): FastifyReply {
  const body: ApiErrorBody = {
    request_id: request.id,
    error: {
      code,
      message,
      details
    }
  };

  return reply.code(statusCode).send(body);
}
