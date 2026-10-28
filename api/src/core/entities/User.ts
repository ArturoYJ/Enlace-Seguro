export type UserRole = 'admin' | 'usuario';
export type AccountStatus = 'active' | 'disabled';

export interface UserProps {
  id: string;
  emailNormalized: string;
  passwordHash: string;
  role: UserRole;
  accountStatus: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  public readonly id: string;
  public readonly emailNormalized: string;
  public readonly passwordHash: string;
  public readonly role: UserRole;
  public readonly accountStatus: AccountStatus;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: UserProps) {
    this.id = props.id;
    this.emailNormalized = props.emailNormalized;
    this.passwordHash = props.passwordHash;
    this.role = props.role;
    this.accountStatus = props.accountStatus;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  public isActive(): boolean {
    return this.accountStatus === 'active';
  }

  public isAdmin(): boolean {
    return this.role === 'admin';
  }
}
