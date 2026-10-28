import { Db, ObjectId } from 'mongodb';
import {
  ISecurityAuditRepository,
  RecordAuditEventData,
  ListAuditEventsFilter,
  PaginatedAuditEventsResult
} from '../../../core/ports/ISecurityAuditRepository.js';
import { SecurityAuditEvent, AuditEventType, AuditEventOutcome } from '../../../core/entities/SecurityAuditEvent.js';

interface SecurityAuditEventDoc {
  _id: ObjectId;
  schemaVersion: number;
  occurredAt: Date;
  purgeAt: Date;
  eventType: AuditEventType;
  actorType?: string;
  actorId?: ObjectId;
  action?: string;
  outcome?: AuditEventOutcome;
  resourceType?: string;
  resourceId?: string;
  requestId?: string;
  metadata?: {
    reasonCode?: string;
    sourceName?: string;
    providerCode?: string;
    analysisStatus?: string;
    httpStatus?: number;
  };
}

export class MongoSecurityAuditRepository implements ISecurityAuditRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<SecurityAuditEventDoc>('security_audit_events');
  }

  public async record(data: RecordAuditEventData): Promise<SecurityAuditEvent> {
    const doc: Omit<SecurityAuditEventDoc, '_id'> = {
      schemaVersion: 1,
      occurredAt: data.occurredAt,
      purgeAt: data.purgeAt,
      eventType: data.eventType,
      actorType: data.actorType,
      actorId: data.actorId && ObjectId.isValid(data.actorId) ? new ObjectId(data.actorId) : undefined,
      action: data.action,
      outcome: data.outcome,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      requestId: data.requestId,
      metadata: data.metadata
    };

    const result = await this.collection.insertOne(doc as SecurityAuditEventDoc);
    return new SecurityAuditEvent({
      id: result.insertedId.toHexString(),
      occurredAt: data.occurredAt,
      purgeAt: data.purgeAt,
      eventType: data.eventType,
      actorType: data.actorType,
      actorId: data.actorId,
      action: data.action,
      outcome: data.outcome,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      requestId: data.requestId,
      metadata: data.metadata
    });
  }

  public async listEvents(filter: ListAuditEventsFilter): Promise<PaginatedAuditEventsResult> {
    const startDateTime = new Date(`${filter.startDate}T00:00:00.000Z`);
    const endDateTime = new Date(`${filter.endDate}T23:59:59.999Z`);

    const query: Record<string, unknown> = {
      occurredAt: { $gte: startDateTime, $lte: endDateTime },
      purgeAt: { $gt: new Date() }
    };

    if (filter.eventType) {
      query['eventType'] = filter.eventType;
    }

    if (filter.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(filter.cursor, 'base64url').toString('utf8')) as {
          occurredAt: string;
          id: string;
        };

        query['$or'] = [
          { occurredAt: { $lt: new Date(decoded.occurredAt) } },
          {
            occurredAt: new Date(decoded.occurredAt),
            _id: { $lt: new ObjectId(decoded.id) }
          }
        ];
      } catch {
        // Ignore malformed cursor
      }
    }

    const docs = await this.collection
      .find(query)
      .sort({ occurredAt: -1, _id: -1 })
      .limit(filter.limit + 1)
      .toArray();

    const hasMore = docs.length > filter.limit;
    const items = docs.slice(0, filter.limit).map((doc) => this.toEntity(doc));

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          occurredAt: lastItem.occurredAt.toISOString(),
          id: lastItem.id
        })
      ).toString('base64url');
    }

    return {
      items,
      hasMore,
      nextCursor
    };
  }

  private toEntity(doc: SecurityAuditEventDoc): SecurityAuditEvent {
    return new SecurityAuditEvent({
      id: doc._id.toHexString(),
      occurredAt: doc.occurredAt,
      purgeAt: doc.purgeAt,
      eventType: doc.eventType,
      actorType: doc.actorType,
      actorId: doc.actorId?.toHexString(),
      action: doc.action,
      outcome: doc.outcome,
      resourceType: doc.resourceType,
      resourceId: doc.resourceId,
      requestId: doc.requestId,
      metadata: doc.metadata
    });
  }
}
