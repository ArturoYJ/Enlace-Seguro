import { createHash, randomUUID } from 'node:crypto';
import { IDailyAnalysisRepository } from '../../core/ports/IDailyAnalysisRepository.js';
import { ISecurityAuditRepository } from '../../core/ports/ISecurityAuditRepository.js';
import { QuotaExceededError, ValidationError } from '../../core/errors/DomainErrors.js';
import { getLocalDate } from '../../core/utils/dateUtils.js';
import { AttemptProps, ProcessingStatus } from '../../core/entities/Analysis.js';

export interface SubmitAnalysisInput {
  userId: string;
  input: string;
  requestId?: string;
}

export interface AnalysisAdmissionDTO {
  attemptId: string;
  receivedAt: Date;
  localDate: string;
  processingStatus: ProcessingStatus;
  inputDigest: string;
  inputSizeBytes: number;
}

export class SubmitAnalysisUseCase {
  constructor(
    private readonly dailyAnalysisRepository: IDailyAnalysisRepository,
    private readonly securityAuditRepository: ISecurityAuditRepository,
    private readonly timezone = 'America/Mexico_City',
    private readonly dailyLimit = 5
  ) {}

  public async execute(input: SubmitAnalysisInput): Promise<AnalysisAdmissionDTO> {
    if (!input.input || typeof input.input !== 'string' || input.input.trim().length === 0) {
      throw new ValidationError('A non-empty URL or text input is required.');
    }

    const trimmedInput = input.input.trim();
    const inputSizeBytes = Buffer.byteLength(trimmedInput, 'utf8');

    if (inputSizeBytes > 65536) {
      throw new ValidationError('Input payload exceeds maximum allowed size of 64 KiB.');
    }

    const inputDigest = createHash('sha256').update(trimmedInput).digest('hex');
    const localDate = getLocalDate(new Date(), this.timezone);
    const attemptId = randomUUID();
    const now = new Date();

    const attempt: AttemptProps = {
      attemptId,
      receivedAt: now,
      updatedAt: now,
      processingStatus: 'received',
      inputDigest,
      inputSizeBytes,
      submittedInput: inputSizeBytes <= 8192 ? trimmedInput : undefined
    };

    const admission = await this.dailyAnalysisRepository.admitAttemptAtomic(
      input.userId,
      localDate,
      attempt,
      this.dailyLimit
    );

    if (!admission.success) {
      if (admission.reason === 'quota_exceeded') {
        throw new QuotaExceededError(this.dailyLimit, this.timezone);
      }
      throw new ValidationError('Failed to admit analysis request.');
    }

    await this.securityAuditRepository.record({
      occurredAt: now,
      purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      eventType: 'analysis.accepted',
      actorType: 'user',
      actorId: input.userId,
      action: 'submit_analysis',
      outcome: 'success',
      resourceType: 'attempt',
      resourceId: attemptId,
      requestId: input.requestId,
      metadata: {
        analysisStatus: 'received'
      }
    });

    return {
      attemptId,
      receivedAt: now,
      localDate,
      processingStatus: 'received',
      inputDigest,
      inputSizeBytes
    };
  }
}
