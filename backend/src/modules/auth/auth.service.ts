import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { EmailDto, ResetPasswordDto } from './dto/password-reset.dto';

type UserRecord = {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  permissions: string[];
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.findUserWithPermissions(dto.email);
    if (!user || !(await compare(dto.password, user.password_hash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      name: user.full_name,
      permissions: user.permissions,
    };

    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'refresh' },
      { expiresIn: '7d' },
    );

    // Store hashed refresh token
    const tokenHash = this.hashToken(refreshToken);
    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, tokenHash],
    );

    // Update last login
    await this.db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.full_name, permissions: user.permissions },
    };
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    return { message: 'Logged out successfully.' };
  }

  async refresh(dto: RefreshDto) {
    let decoded: { sub: string; type?: string };
    try {
      decoded = await this.jwt.verifyAsync(dto.refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (decoded.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const tokenHash = this.hashToken(dto.refreshToken);

    // Validate and delete old refresh token (rotation)
    const result = await this.db.query(
      `DELETE FROM refresh_tokens
       WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()
       RETURNING id`,
      [decoded.sub, tokenHash],
    );

    if (result.rowCount === 0) {
      // Token reuse detected — revoke all tokens for this user
      await this.db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [decoded.sub]);
      this.logger.warn(`Refresh token reuse detected for user ${decoded.sub}`);
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Fetch user with fresh permissions
    const user = await this.findUserWithPermissionsById(decoded.sub);
    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      name: user.full_name,
      permissions: user.permissions,
    };

    const accessToken = await this.jwt.signAsync(payload);
    const newRefreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'refresh' },
      { expiresIn: '7d' },
    );

    // Store new hashed refresh token
    const newTokenHash = this.hashToken(newRefreshToken);
    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, newTokenHash],
    );

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: { id: user.id, email: user.email, fullName: user.full_name, permissions: user.permissions },
    };
  }

  async requestPasswordReset(dto: EmailDto) {
    const user = await this.db.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 AND is_active = true',
      [dto.email],
    );

    // Always return success to prevent email enumeration
    if (user.rowCount === 0) {
      return { message: 'If the email exists, a password reset link has been sent.' };
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);

    await this.db.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.rows[0].id, tokenHash],
    );

    // In production, send email with the reset token
    this.logger.log(`Password reset requested for user ${user.rows[0].id}`);

    return { message: 'If the email exists, a password reset link has been sent.', token };
  }

  async confirmPasswordReset(dto: ResetPasswordDto) {
    const tokenHash = this.hashToken(dto.token);

    const result = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM password_resets
       WHERE token_hash = $1 AND expires_at > NOW() AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [tokenHash],
    );

    if (result.rowCount === 0) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const userId = result.rows[0].user_id;
    const newHash = await hash(dto.newPassword, 12);

    await this.db.transaction(async (client) => {
      await client.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [newHash, userId],
      );
      await client.query(
        'UPDATE password_resets SET used_at = NOW() WHERE token_hash = $1',
        [tokenHash],
      );
      // Revoke all refresh tokens on password change
      await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    });

    return { message: 'Password has been reset successfully.' };
  }

  private async findUserWithPermissions(email: string): Promise<UserRecord | null> {
    const result = await this.db.query<UserRecord>(
      `
      SELECT u.id, u.email, u.password_hash, u.full_name,
             COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.email = $1 AND u.is_active = true
      GROUP BY u.id
      `,
      [email],
    );
    return result.rows[0] ?? null;
  }

  private async findUserWithPermissionsById(userId: string): Promise<UserRecord | null> {
    const result = await this.db.query<UserRecord>(
      `
      SELECT u.id, u.email, u.password_hash, u.full_name,
             COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = $1 AND u.is_active = true
      GROUP BY u.id
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
