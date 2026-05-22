import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../invoice/database.service';
import * as bcrypt from 'bcryptjs';

export interface AuthUser {
  id: number;
  email: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private db: DatabaseService,
  ) {}

  async validateUser(email: string, password: string): Promise<AuthUser> {
    const { rows } = await this.db.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [email],
    );
    const user = rows[0];

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { id: user.id, email: user.email, role: user.role };
  }

  signToken(user: AuthUser): string {
    return this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
  }
}
