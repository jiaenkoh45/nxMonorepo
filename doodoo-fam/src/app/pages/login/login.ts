import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private router = inject(Router);
  private authService = inject(AuthService);

  email = signal('');
  password = signal('');
  showPassword = signal(false);
  showForgotMessage = signal(false);
  error = signal('');
  loading = signal(false);

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  async onLogin() {
    if (!this.email() || !this.password()) {
      this.error.set('Please enter your email and password.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      await this.authService.login(this.email(), this.password());
      this.router.navigate(['/landing']);
    } catch {
      this.error.set('Invalid email or password.');
    } finally {
      this.loading.set(false);
    }
  }

  onForgotPassword(e: Event) {
    e.preventDefault();
    this.showForgotMessage.set(true);
  }
}
