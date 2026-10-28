import { IUserRepository } from '../../core/ports/IUserRepository.js';
import { ISecurityAuditRepository } from '../../core/ports/ISecurityAuditRepository.js';
import { IPasswordHasher } from '../../core/ports/ISecurityServices.js';
import { EmailAlreadyExistsError, ValidationError } from '../../core/errors/DomainErrors.js';
import { UserRole, AccountStatus } from '../../core/entities/User.js';

export interface RegisterUserInput {
  email: string;
  password: string;
  requestId?: string;
}

export interface UserResponseDTO {
  id: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
  createdAt: Date;
}

export class RegisterUserUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly securityAuditRepository: ISecurityAuditRepository,
    private readonly passwordHasher: IPasswordHasher
  ) {}

  public async execute(input: RegisterUserInput): Promise<UserResponseDTO> {
    const emailNormalized = input.email.trim().toLowerCase();

    if (!emailNormalized || !emailNormalized.includes('@') || emailNormalized.length > 254) {
      throw new ValidationError('A valid email address is required.');
    }

    if (!input.password || input.password.length < 8 || input.password.length > 128) {
      throw new ValidationError('Password must be between 8 and 128 characters long.');
    }

    const existingUser = await this.userRepository.findByEmail(emailNormalized);
    if (existingUser) {
      await this.securityAuditRepository.record({
        occurredAt: new Date(),
        purgeAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        eventType: 'account.registered',
        action: 'register',
        outcome: 'failure',
        resourceType: 'user',
        requestId: input.requestId,
        metadata: { reasonCode: 'email_already_exists' }
      });

      throw new EmailAlreadyExistsError(emailNormalized);
    }

    const passwordHash = await this.passwordHasher.hash(input.password);

    const createdUser = await this.userRepository.create({
      emailNormalized,
      passwordHash,
      role: 'usuario',
      accountStatus: 'active'
    });

    await this.securityAuditRepository.record({
      occurredAt: new Date(),
      purgeAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      eventType: 'account.registered',
      actorType: 'user',
      actorId: createdUser.id,
      action: 'register',
      outcome: 'success',
      resourceType: 'user',
      resourceId: createdUser.id,
      requestId: input.requestId
    });

    return {
      id: createdUser.id,
      email: createdUser.emailNormalized,
      role: createdUser.role,
      accountStatus: createdUser.accountStatus,
      createdAt: createdUser.createdAt
    };
  }
}
