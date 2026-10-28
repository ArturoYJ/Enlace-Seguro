import bcrypt from 'bcrypt';
import { IPasswordHasher } from '../../core/ports/ISecurityServices.js';

export class BcryptPasswordHasher implements IPasswordHasher {
  constructor(private readonly saltRounds = 12) {}

  public async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  public async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
