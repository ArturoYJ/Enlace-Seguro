import { SourceFailure, SourceResult } from '../entities/Analysis.js';

/**
 * Consulta de reputación en una fuente externa (por ejemplo Google Safe Browsing).
 * Nunca lanza errores: si la fuente no responde se devuelve `unavailable` y el
 * análisis continúa solo con el veredicto del sandbox.
 */
export type ReputationCheck =
  | { status: 'listed'; sourceResult: SourceResult; threatTypes: string[] }
  | { status: 'clean'; sourceResult: SourceResult }
  | { status: 'unavailable'; failure: SourceFailure };

export interface IReputationService {
  check(urls: string[]): Promise<ReputationCheck>;
}
