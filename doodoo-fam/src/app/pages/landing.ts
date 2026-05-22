import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-landing',
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {
  private router = inject(Router);
  private auth = inject(AuthService);

  menuOpen = signal(false);
  canManageUsers = this.auth.canEdit;
  currentUser = this.auth.currentUser;

  toggleMenu(): void {
    this.menuOpen.update(v => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  get isHome(): boolean {
    return this.router.url === '/landing';
  }

  async logOut(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['']);
  }
}
