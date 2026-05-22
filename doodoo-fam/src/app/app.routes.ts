import { Route } from '@angular/router';
import { Landing } from './pages/landing';
import { Login } from './pages/login/login';
import { Comparison } from './pages/invoice/comparison/comparison';
import { Creator } from './pages/invoice/creator/creator';
import { Users } from './pages/users/user';
import { adminGuard, authGuard, loginGuard } from './auth.guard';

export const appRoutes: Route[] = [
    { path: '', component: Login, canActivate: [loginGuard] },
    {
        path: 'landing',
        component: Landing,
        canActivate: [authGuard],
        children: [
            { path: 'comparisons', component: Comparison },
            { path: 'creditors',   component: Creator    },
            { path: 'users',       component: Users, canActivate: [adminGuard] },
        ],
    },
];