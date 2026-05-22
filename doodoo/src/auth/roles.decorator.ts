import { SetMetadata } from '@nestjs/common';

export type Role = 'owner' | 'admin' | 'read-only';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
