import { ISecurityAuditRepository, PaginatedAuditEventsResult, ListAuditEventsFilter } from '../../core/ports/ISecurityAuditRepository.js';
import { UnauthorizedAccessError } from '../../core/errors/DomainErrors.js';
import { UserRole } from '../../core/entities/User.js';

export interface ListAuditEventsInput extends ListAuditEventsFilter {
  requestingRole: UserRole;
  requestingUserId: string;
}

export class ListAuditEventsUseCase {
  constructor(private readonly securityAuditRepository: ISecurityAuditRepository) {}

  public async execute(input: ListAuditEventsInput): Promise<PaginatedAuditEventsResult> {
    if (input.requestingRole !== 'admin') {
      throw new UnauthorizedAccessError('Only administrators can review security audit logs.');
    }

    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

    const result = await this.securityAuditRepository.listEvents({
      startDate: input.startDate,
      endDate: input.endDate,
      eventType: input.eventType,
      limit,
      cursor: input.cursor
    });

    const now = new Date();
    await this.securityAuditRepository.record({
      occurredAt: now,
      purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      eventType: 'admin.audit.read',
      actorType: 'user',
      actorId: input.requestingUserId,
      action: 'list_audit_events',
      outcome: 'success',
      resourceType: 'audit_collection'
    });

    return result;
  }
}
