import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../invoice/database.service';
import * as bcrypt from 'bcryptjs';

export interface UserRow {
  id: number;
  email: string;
  role: string;
  name: string | null;
  created_at: string;
}

@Injectable()
export class UsersService {
  constructor(private db: DatabaseService) {}

  async findAll(): Promise<UserRow[]> {
    const { rows } = await this.db.query(
      'SELECT id, email, role, name, created_at FROM users ORDER BY created_at ASC',
    );
    return rows;
  }

  async create(email: string, password: string, role: string, name?: string): Promise<UserRow> {
    if (role === 'owner') throw new BadRequestException('Cannot assign owner role');
    const hash = bcrypt.hashSync(password, 12);
    const { rows } = await this.db.query(
      'INSERT INTO users (email, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING id, email, role, name, created_at',
      [email, hash, role, name ?? null],
    );
    return rows[0];
  }

  async updateRole(
    targetId: number,
    newRole: string,
    actorRole: string,
  ): Promise<UserRow> {
    if (newRole === 'owner') throw new BadRequestException('Cannot assign owner role');

    const { rows } = await this.db.query('SELECT id, role FROM users WHERE id = $1', [targetId]);
    const target = rows[0];
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'owner') throw new ForbiddenException('Cannot change an owner\'s role');

    const { rows: updated } = await this.db.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role, name, created_at',
      [newRole, targetId],
    );
    return updated[0];
  }

  async remove(targetId: number, actorId: number): Promise<void> {
    if (targetId === actorId) throw new BadRequestException('Cannot delete your own account');

    const { rows } = await this.db.query('SELECT role FROM users WHERE id = $1', [targetId]);
    const target = rows[0];
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'owner') throw new ForbiddenException('Cannot delete an owner');

    await this.db.query('DELETE FROM users WHERE id = $1', [targetId]);
  }
}
