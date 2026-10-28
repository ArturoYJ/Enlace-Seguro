import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, ValidationError } from '../../core/errors/DomainErrors.js';

export interface ProblemDetailsResponse {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  invalidParams?: Array<{ name: string; reason: string }>;
}

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  const instance = request.url;

  if (error instanceof DomainError) {
    const problem: ProblemDetailsResponse = {
      type: `https://api.enlaceseguro.internal/errors/${error.code.toLowerCase().replace(/_/g, '-')}`,
      title: error.message,
      status: error.statusCode,
      detail: error.detail ?? error.message,
      instance
    };

    if (error instanceof ValidationError && error.invalidParams) {
      problem.invalidParams = error.invalidParams;
    }

    reply.status(error.statusCode).header('content-type', 'application/problem+json').send(problem);
    return;
  }

  // Fastify Schema Validation Error
  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    const invalidParams = fastifyError.validation.map((v) => {
      const missing =
        v.params && typeof v.params === 'object' && 'missingProperty' in v.params
          ? String((v.params as Record<string, unknown>)['missingProperty'])
          : null;
      const paramName = v.instancePath && v.instancePath.length > 0 ? v.instancePath : (missing || 'payload');
      return {
        name: paramName,
        reason: v.message || 'Invalid value'
      };
    });

    const problem: ProblemDetailsResponse = {
      type: 'https://api.enlaceseguro.internal/errors/validation-failed',
      title: 'Validation failed',
      status: 400,
      detail: 'The request body, query parameters or headers failed schema validation.',
      instance,
      invalidParams
    };

    reply.status(400).header('content-type', 'application/problem+json').send(problem);
    return;
  }

  // Generic Uncaught Exception (500)
  request.log.error(error, 'Unhandled internal server error');

  const problem: ProblemDetailsResponse = {
    type: 'https://api.enlaceseguro.internal/errors/internal-server-error',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected internal error occurred. Please contact system support.',
    instance
  };

  reply.status(500).header('content-type', 'application/problem+json').send(problem);
}
