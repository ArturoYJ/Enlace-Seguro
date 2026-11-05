import { Db, ObjectId } from 'mongodb';
import {
  ISecurityAuditRepository,
  RecordAuditEventData,
  ListAuditEventsFilter,
  PaginatedAuditEventsResult
} from '../../../core/ports/ISecurityAuditRepository.js';
import { SecurityAuditEvent, AuditEventType, AuditEventOutcome } from '../../../core/entities/SecurityAuditEvent.js';
import { ValidationError } from '../../../core/errors/DomainErrors.js';
import { omitUndefinedDeep } from './omitUndefinedDeep.js';

const PRODUCT_TIME_ZONE = 'America/Mexico_City';
const mexicoDateFormatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
  timeZone: PRODUCT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function mexicoCalendarDate(epochMs: number): string {
  const parts = Object.fromEntries(mexicoDateFormatter.formatToParts(new Date(epochMs)).map((part) => [part.type, part.value]));
  return `${parts['year']!.padStart(4, '0')}-${parts['month']}-${parts['day']}`;
}

function utcMidnightEpoch(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error('Audit date must use YYYY-MM-DD.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  if (value.toISOString().slice(0, 10) !== date) throw new Error('Audit date must be a real calendar date.');
  return value.getTime();
}

/** Finds the first instant belonging to this civil date in the product zone.
 * Binary search handles historical offset changes (including a midnight gap)
 * without assuming today's fixed UTC-06:00 offset also applied in the past.
 */
function startOfMexicoDate(date: string): Date {
  const approximateUtcMidnight = utcMidnightEpoch(date);
  let low = approximateUtcMidnight - 48 * 60 * 60 * 1000;
  let high = approximateUtcMidnight + 48 * 60 * 60 * 1000;
  if (mexicoCalendarDate(low) >= date || mexicoCalendarDate(high) < date) {
    throw new Error('Could not resolve the requested Mexico City calendar-day boundary.');
  }
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (mexicoCalendarDate(middle) >= date) high = middle;
    else low = middle;
  }
  if (mexicoCalendarDate(high) !== date) throw new Error('The requested calendar date does not exist in America/Mexico_City.');
  return new Date(high);
}

function nextCalendarDate(date: string): string {
  const next = new Date(utcMidnightEpoch(date));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function decodeAuditCursor(cursor: string): { occurredAt: Date; id: ObjectId } {
  const invalidCursor = () => new ValidationError('The audit pagination cursor is invalid.', [
    { name: 'cursor', reason: 'Use the cursor returned by the previous audit-events page.' }
  ]);

  if (cursor.length > 128 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalidCursor();

  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(json).toString('base64url') !== cursor) throw invalidCursor();
    const decoded: unknown = JSON.parse(json);
    if (typeof decoded !== 'object' || decoded === null) throw invalidCursor();

    const value = decoded as { occurredAt?: unknown; id?: unknown };
    if (typeof value.occurredAt !== 'string' || typeof value.id !== 'string' || !/^[a-f0-9]{24}$/.test(value.id)) {
      throw invalidCursor();
    }
    const occurredAt = new Date(value.occurredAt);
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== value.occurredAt) throw invalidCursor();
    return { occurredAt, id: new ObjectId(value.id) };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw invalidCursor();
  }
}

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

    // MongoDB's BSON serializer can encode JavaScript `undefined` as BSON null.
    // The strict collection validator intentionally distinguishes absent optional fields from null.
    const result = await this.collection.insertOne(omitUndefinedDeep(doc) as SecurityAuditEventDoc);
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
    const startDateTime = startOfMexicoDate(filter.startDate);
    const endExclusiveDateTime = startOfMexicoDate(nextCalendarDate(filter.endDate));

    const query: Record<string, unknown> = {
      occurredAt: { $gte: startDateTime, $lt: endExclusiveDateTime },
      purgeAt: { $gt: new Date() }
    };

    if (filter.eventType) {
      query['eventType'] = filter.eventType;
    }

    if (filter.cursor !== undefined) {
      const decoded = decodeAuditCursor(filter.cursor);
      query['$or'] = [
        { occurredAt: { $lt: decoded.occurredAt } },
        {
          occurredAt: decoded.occurredAt,
          _id: { $lt: decoded.id }
        }
      ];
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
