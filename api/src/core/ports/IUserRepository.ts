import { User, UserProps } from '../entities/User.js';

export interface CreateUserData {
  emailNormalized: string;
  passwordHash: string;
  role: UserProps['role'];
  accountStatus: UserProps['accountStatus'];
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(emailNormalized: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  countAdmins(): Promise<number>;
}
