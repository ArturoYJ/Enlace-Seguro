export interface RefreshTokenProps {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  isRevoked: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export class RefreshToken {
  public readonly id: string;
  public readonly userId: string;
  public readonly tokenHash: string;
  public readonly familyId: string;
  public readonly isRevoked: boolean;
  public readonly createdAt: Date;
  public readonly expiresAt: Date;

  constructor(props: RefreshTokenProps) {
    this.id = props.id;
    this.userId = props.userId;
    this.tokenHash = props.tokenHash;
    this.familyId = props.familyId;
    this.isRevoked = props.isRevoked;
    this.createdAt = props.createdAt;
    this.expiresAt = props.expiresAt;
  }

  public isExpired(now: Date = new Date()): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }

  public isValid(now: Date = new Date()): boolean {
    return !this.isRevoked && !this.isExpired(now);
  }
}
