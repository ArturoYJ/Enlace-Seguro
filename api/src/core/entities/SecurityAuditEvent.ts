export type AuditEventType =
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'authz.denied'
  | 'account.registered'
  | 'analysis.accepted'
  | 'analysis.validation_failed'
  | 'analysis.completed'
  | 'analysis.inconclusive'
  | 'analysis.failed'
  | 'admin.audit.read';

export type AuditEventOutcome = 'success' | 'failure' | 'denied' | 'partial';

export interface SecurityAuditEventProps {
  id: string;
  occurredAt: Date;
  purgeAt: Date;
  eventType: AuditEventType;
  actorType?: string;
  actorId?: string;
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

export class SecurityAuditEvent {
  public readonly id: string;
  public readonly occurredAt: Date;
  public readonly purgeAt: Date;
  public readonly eventType: AuditEventType;
  public readonly actorType?: string;
  public readonly actorId?: string;
  public readonly action?: string;
  public readonly outcome?: AuditEventOutcome;
  public readonly resourceType?: string;
  public readonly resourceId?: string;
  public readonly requestId?: string;
  public readonly metadata?: SecurityAuditEventProps['metadata'];

  constructor(props: SecurityAuditEventProps) {
    this.id = props.id;
    this.occurredAt = props.occurredAt;
    this.purgeAt = props.purgeAt;
    this.eventType = props.eventType;
    this.actorType = props.actorType;
    this.actorId = props.actorId;
    this.action = props.action;
    this.outcome = props.outcome;
    this.resourceType = props.resourceType;
    this.resourceId = props.resourceId;
    this.requestId = props.requestId;
    this.metadata = props.metadata;
  }
}
