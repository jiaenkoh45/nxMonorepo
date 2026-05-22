import { computed, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface CurrentUser {
  id: number;
  email: string;
  role: 'owner' | 'admin' | 'read-only';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _currentUser = signal<CurrentUser | null>(null);
  readonly currentUser = this._currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this._currentUser() !== null);
  readonly canEdit = computed(() => {
    const r = this._currentUser()?.role;
    return r === 'owner' || r === 'admin';
  });

  constructor(private http: HttpClient) {}

  async login(email: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/login', { email, password }));
    await this.checkAuth();
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', {}));
    this._currentUser.set(null);
  }

  async checkAuth(): Promise<boolean> {
    try {
      const user = await firstValueFrom(this.http.get<CurrentUser>('/api/auth/me'));
      this._currentUser.set(user);
      return true;
    } catch {
      this._currentUser.set(null);
      return false;
    }
  }
}
