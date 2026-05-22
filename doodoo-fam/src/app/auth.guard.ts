import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const authService = inject(AuthService);
  const router = inject(Router);

  const ok = await authService.checkAuth();
  if (!ok) {
    router.navigate(['/']);
    return false;
  }
  return true;
};

export const loginGuard: CanActivateFn = async () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const authService = inject(AuthService);
  const router = inject(Router);

  const ok = await authService.checkAuth();
  if (ok) {
    router.navigate(['/landing']);
    return false;
  }
  return true;
};

export const adminGuard: CanActivateFn = async () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const authService = inject(AuthService);
  const router = inject(Router);

  const ok = await authService.checkAuth();
  if (!ok) { router.navigate(['/']); return false; }

  const role = authService.currentUser()?.role;
  if (role !== 'owner' && role !== 'admin') {
    router.navigate(['/landing']);
    return false;
  }
  return true;
};
