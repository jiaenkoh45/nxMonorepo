import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../auth.service';

interface User {
  id: number;
  email: string;
  role: 'owner' | 'admin' | 'read-only';
  name: string | null;
  created_at: string;
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user.html',
  styleUrl: './user.scss',
})
export class Users implements OnInit {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  users = signal<User[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  // Add-user form
  showAddForm = signal(false);
  newEmail = signal('');
  newPassword = signal('');
  newRole = signal<'admin' | 'read-only'>('read-only');
  newName = signal('');
  adding = signal(false);

  // Current user info
  currentUser = this.auth.currentUser;

  canManage = computed(() => {
    const r = this.currentUser()?.role;
    return r === 'owner' || r === 'admin';
  });

  ngOnInit() {
    this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await firstValueFrom(this.http.get<User[]>('/api/users'));
      this.users.set(list);
    } catch {
      this.error.set('Failed to load users.');
    } finally {
      this.loading.set(false);
    }
  }

  async addUser() {
    if (!this.newEmail() || !this.newPassword()) return;
    this.adding.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post('/api/users', {
          email: this.newEmail(),
          password: this.newPassword(),
          role: this.newRole(),
          name: this.newName() || undefined,
        }),
      );
      this.newEmail.set('');
      this.newPassword.set('');
      this.newRole.set('read-only');
      this.newName.set('');
      this.showAddForm.set(false);
      await this.load();
    } catch (err: unknown) {
      const msg = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(msg ?? 'Failed to add user.');
    } finally {
      this.adding.set(false);
    }
  }

  async changeRole(user: User, role: string) {
    this.error.set(null);
    try {
      await firstValueFrom(this.http.patch(`/api/users/${user.id}/role`, { role }));
      await this.load();
    } catch (err: unknown) {
      const msg = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(msg ?? 'Failed to update role.');
    }
  }

  async deleteUser(user: User) {
    if (!confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    this.error.set(null);
    try {
      await firstValueFrom(this.http.delete(`/api/users/${user.id}`));
      await this.load();
    } catch (err: unknown) {
      const msg = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(msg ?? 'Failed to delete user.');
    }
  }

  canModify(user: User): boolean {
    if (user.role === 'owner') return false;
    if (user.id === this.currentUser()?.id) return false;
    return this.canManage();
  }

  roleBadgeClass(role: string): string {
    if (role === 'owner') return 'badge badge--owner';
    if (role === 'admin') return 'badge badge--admin';
    return 'badge badge--readonly';
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }
}
