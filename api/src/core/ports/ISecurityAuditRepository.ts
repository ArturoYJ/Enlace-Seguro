import { SecurityAuditEvent, SecurityAuditEventProps, AuditEventType } from '../entities/SecurityAuditEvent.js';

export interface RecordAuditEventData {
  occurredAt: Date;
  purgeAt: Date;
  eventType: AuditEventType;
  actorType?: string;
  actorId?: string;
  action?: string;
  outcome?: SecurityAuditEventProps['outcome'];
  resourceType?: string;
  resourceId?: string;
  requestId?: string;
  metadata?: SecurityAuditEventProps['metadata'];
}

export interface ListAuditEventsFilter {
  startDate: string;
  endDate: string;
  eventType?: AuditEventType;
  limit: number;
  cursor?: string;
}

export interface PaginatedAuditEventsResult {
  items: SecurityAuditEvent[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ISecurityAuditRepository {
  record(data: RecordAuditEventData): Promise<SecurityAuditEvent>;
  listEvents(filter: ListAuditEventsFilter): Promise<PaginatedAuditEventsResult>;
}
