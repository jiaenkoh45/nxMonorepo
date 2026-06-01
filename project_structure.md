# doo-account — Project Structure

## What This Project Is

**doodoo-fam** is an invoice management web app for a fashion/consumer-goods business. It lets users manage creditors (suppliers), browse uploaded invoice files in a folder hierarchy, and compare client vs supplier invoices to detect price and quantity discrepancies.

---

## Top-Level Layout

```
doo-account/
├── .do/                    DigitalOcean App Platform config
├── .vscode/                VS Code workspace settings
├── CLAUDE.md               Project context guide for Claude
├── README.md               Quick notes (SSH config)
├── deploy.sh               Deployment script
├── dist/                   Compiled frontend output
├── doodoo/                 NestJS backend API
├── doodoo-fam/             Angular 21 frontend
└── spiders/                Scrapy web scrapers (Python)
```

Three independent `npm` projects: root, `doodoo-fam/`, and `doodoo/`. They do not share node_modules.

---

## Frontend — `doodoo-fam/`

**Framework:** Angular 21.2 — standalone components, signals
**Build:** Vite 8 via `@analogjs/vite-plugin-angular`
**SSR:** Angular SSR + Express (`server.ts`) with event-replay hydration
**Testing:** Vitest 4 + jsdom; Playwright for e2e

### Configuration

| File | Purpose |
|---|---|
| `angular.json` | Angular CLI config (SSR entry, Vite builder, output path `dist/doodoo-fam`) |
| `package.json` | Dependencies (Angular, RxJS, CoreUI, Express) |
| `tsconfig.json` | TypeScript 5.9 base config |
| `tsconfig.app.json` | App-specific TS config |
| `tsconfig.spec.json` | Test-specific TS config |
| `proxy.conf.json` | Dev proxy: `/api/*` → `http://localhost:3000` |
| `vite.config.mts` | Vite config with Angular plugin |

### `src/` Layout

```
src/
├── app/
│   ├── app.ts / app.html / app.scss     Root component — just <router-outlet>
│   ├── app.config.ts                    Providers: router, HttpClient, hydration
│   ├── app.config.server.ts             SSR-specific providers
│   ├── app.routes.ts                    Top-level route definitions
│   ├── app.routes.server.ts             SSR route config
│   ├── app.spec.ts                      Root component test
│   ├── auth.service.ts                  AuthService (signals + HTTP)
│   ├── auth.guard.ts                    authGuard, loginGuard, adminGuard
│   ├── components/UI/
│   │   ├── header/                      Header stub (not actively used)
│   │   └── sidebar/                     Sidebar component + SidebarService
│   └── pages/
│       ├── landing.ts / .html / .scss   Layout shell (sidebar + header + content)
│       ├── login/                       Login page
│       ├── users/                       User admin panel (owner/admin only)
│       └── invoice/
│           ├── creator/                 Creditor browser + file manager
│           └── comparison/              Invoice comparison page
├── environments/
│   ├── environment.ts                   Dev: apiBase = 'http://localhost:3000'
│   └── environment.prod.ts             Prod: apiBase = '' (relative URLs)
├── styles.scss                          Global CSS variables & reset
├── index.html                           Fonts, Material Icons link
├── main.ts                              Browser bootstrap
├── main.server.ts                       Server bootstrap
└── server.ts                            Express SSR server
```

### Routing

```
/               → Login          (loginGuard: redirects → /landing if authenticated)
/landing        → Landing        (authGuard: redirects → / if unauthenticated)
  ├─ /creditors    → Creator     (authGuard inherited)
  ├─ /comparisons  → Comparison  (authGuard inherited)
  └─ /users        → Users       (adminGuard: owner or admin only)
```

Login is outside the Landing shell so it renders without the sidebar/header.

### Route Guards — `auth.guard.ts`

| Guard | Behaviour |
|---|---|
| `authGuard` | Calls `AuthService.checkAuth()` (GET `/api/auth/me`); redirects to `/` on failure |
| `loginGuard` | Redirects to `/landing` if already authenticated |
| `adminGuard` | Requires auth + `owner` or `admin` role; redirects to `/landing` otherwise |

All guards check `isPlatformBrowser` to handle SSR correctly.

---

### `auth.service.ts` — `AuthService`

Injectable, provided in root. Manages auth state via Angular Signals.

**Signals & Computed:**
- `currentUser` — `signal<CurrentUser | null>`
- `isAuthenticated` — `computed(() => currentUser() !== null)`
- `canEdit` — `computed(() => role === 'owner' || role === 'admin')`

**Interface:**
```typescript
CurrentUser {
  id: number;
  email: string;
  role: 'owner' | 'admin' | 'read-only';
}
```

**Methods:**
| Method | HTTP | Endpoint | Notes |
|---|---|---|---|
| `login(email, password)` | POST | `/api/auth/login` | Sets `access_token` httpOnly cookie → calls `checkAuth()` |
| `logout()` | POST | `/api/auth/logout` | Clears cookie; resets `currentUser` to null |
| `checkAuth()` | GET | `/api/auth/me` | Updates `currentUser` signal; throws on failure |

---

### `pages/landing.ts` — `Landing` (Layout Shell)

Renders the full app frame: sidebar, header, and a `<router-outlet>` for child routes.

**Signals:**
- `menuOpen: signal<boolean>` — mobile sidebar toggle
- `canManageUsers: computed<boolean>` — delegated from `AuthService.canEdit`
- `currentUser` — delegated from `AuthService`

**Template features:** logo, nav links (Creditors / Comparison / Users), logout button, widget cards on home screen, mobile backdrop overlay.

---

### `pages/login/login.ts` — `Login`

**Signals:** `email`, `password`, `showPassword`, `showForgotMessage`, `error`, `loading`

**Key behaviour:** Shows "Ask an Admin to reset your password" on forgot-password click (no self-service reset flow).

---

### `pages/users/user.ts` — `Users` (Admin Panel)

Guarded by `adminGuard`. Lists all users, lets owner/admin create, change roles, and delete.

**Interface:**
```typescript
User {
  id: number;
  email: string;
  role: 'owner' | 'admin' | 'read-only';
  name: string | null;
  created_at: string;
}
```

**Methods:** `load()`, `addUser()`, `changeRole(user, role)`, `deleteUser(user)`, `canModify(user)`.

Cannot modify owner's role, cannot delete self or owner.

---

### `pages/invoice/creator/creator.ts` — `Creator`

Creditor browser and file manager. Navigation state is fully driven by Angular Signals.

**FsNode interface (shared with backend):**
```typescript
FsNode {
  id: string;          // UUID
  parent_id: string | null;
  type: 'creditor' | 'folder' | 'file';
  name: string;
  size_bytes: number | null;
  storage_path: string | null;
  created_at: string;
  phone: string | null;
  email: string | null;
  description: string | null;
}
```

**Navigation signals:** `currentNodeId`, `currentNode`, `breadcrumb`, `children`

**Computed:** `folders`, `files`, `isAtRoot`, `currentCreditor`

**Methods:** `openNode(id)`, `refresh()`, `addCreditor()`, `editCreditorInfo()`, `addFolder()`, `onFileSelected(event)`, `deleteNode(node)`, `renameNode(node)`, `exportZip()`, `navigateBreadcrumb(node)`

---

### `pages/invoice/creator/fs.service.ts` — `FsApiService`

Injectable, provided in root. All methods return Promises.

| Method | HTTP | Endpoint |
|---|---|---|
| `listChildren(parentId)` | GET | `/api/fs/children?parentId=` |
| `getNode(id)` | GET | `/api/fs/node/{id}` |
| `getPath(id)` | GET | `/api/fs/path/{id}` |
| `createCreditor(name, info)` | POST | `/api/fs/creditors` |
| `updateCreditor(id, info)` | PATCH | `/api/fs/creditors/{id}` |
| `createFolder(parentId, name)` | POST | `/api/fs/folders` |
| `uploadFile(parentId, file)` | POST | `/api/fs/files` (FormData) |
| `rename(id, name)` | PATCH | `/api/fs/nodes/{id}` |
| `delete(id)` | DELETE | `/api/fs/nodes/{id}` |
| `fileUrl(id, name?)` | — | Returns `/api/fs/files/{id}/raw/[name]` |
| `zipUrl(folderId)` | — | Returns `/api/fs/folders/{id}/zip` |

---

### `pages/invoice/comparison/comparison.ts` — `Comparison`

Upload client and creditor invoice PDFs, run comparison, display per-item match/mismatch results. Includes a file picker modal to pull files directly from the creditor file system.

**Key interfaces:**
```typescript
FileEntry  { file: File; name: string; preview?: SafeResourceUrl }
ItemComparison {
  code: string; description: string;
  clientQty: number; supplierQty: number;
  match: boolean;
  clientFiles: FileRef[]; supplierFiles: FileRef[];
}
FileRef { filename: string; qty: number; customerName: string }
```

**Signals:** `clientFiles`, `creditorFiles`, `activeClientIdx`, `activeCreditorIdx`, `isLoading`, `parseError`, `result`, `pickerOpen`, `pickerGroup`, `pickerPath`, `pickerNodes`, `pickerLoading`

**Computed:** `clientPreview`, `creditorPreview`, `matchCount`, `mismatchCount`

**Methods:** `onFilesAdded(group, event)`, `removeFile(group, idx)`, `runComparison()`, `openPicker(group)`, `pickerNavigate(node)`, `pickerSelectFile(node)`, `reset()`

---

### `components/UI/sidebar/sidebar.service.ts` — `SidebarService`

RxJS `BehaviorSubject<boolean>` for cross-component sidebar open/close state.
Methods: `toggle()`, `open()`, `close()`.

---

### Design System — `src/styles.scss`

| Token | Value |
|---|---|
| `--text` | `#111111` |
| `--text-muted` | `#6b7280` |
| `--border` | `#e5e7eb` |
| `--surface` | `#ffffff` |
| `--surface-2` | `#f9fafb` |
| `--brand` | `#174d28` (dark green) |
| `--brand-light` | `#e8f2eb` |
| Border radius | 8px / 6px (small) |
| Fonts | Work Sans (body), Inconsolata (mono/numbers) |

---

## Backend — `doodoo/`

**Framework:** NestJS 11 — REST API
**Language:** TypeScript 5.7
**Auth:** Passport + JWT (httpOnly cookie)
**Database:** PostgreSQL via `pg`
**File uploads:** Multer
**PDF parsing:** `pdf-parse`
**ZIP generation:** `archiver`
**Password hashing:** `bcryptjs`
**Testing:** Jest

### Configuration

| File | Purpose |
|---|---|
| `package.json` | Backend dependencies |
| `tsconfig.json` | TypeScript 5.7 config |
| `jest.config.json` | Jest test config |
| `.env` | `DATABASE_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGIN`, `NODE_ENV` |

### Bootstrap — `src/main.ts`

- Loads `.env` via `dotenv`
- Attaches `cookieParser` middleware
- Enables CORS with `credentials: true` (origin from `CORS_ORIGIN` env var)
- Sets global API prefix `/api`
- Listens on `PORT` (default 3000)

### Root Module — `src/app.module.ts`

```
Imports:   DatabaseModule, AuthModule, UsersModule, InvoiceModule, FsModule
APP_GUARD: JwtAuthGuard — all routes require JWT by default
```

---

### Auth Module — `src/auth/`

#### `auth.controller.ts`

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | `@Public()` | Body `{ email, password }`; sets `access_token` httpOnly cookie (8h, sameSite=lax) |
| POST | `/api/auth/logout` | JWT | Clears `access_token` cookie |
| GET | `/api/auth/me` | JWT | Returns `{ id, email, role }` |

#### `auth.service.ts`

- `validateUser(email, password)` — DB lookup + bcrypt compare; throws `UnauthorizedException` on mismatch
- `signToken(user)` — JWT sign with payload `{ sub, email, role }`, expiry 8h

#### `jwt.strategy.ts`

Extends `PassportStrategy(Strategy)`. Extracts JWT from `access_token` cookie. Validates against `JWT_SECRET`. Returns `{ id: sub, email, role }`.

#### Guards & Decorators

| File | Purpose |
|---|---|
| `jwt-auth.guard.ts` | Extends `AuthGuard('jwt')`; skips if route has `@Public()` metadata |
| `public.decorator.ts` | `@Public()` — bypasses JWT guard |
| `roles.decorator.ts` | `@Roles(...roles)` — sets required roles metadata |
| `roles.guard.ts` | Checks `user.role` against `@Roles` metadata; throws `ForbiddenException` on mismatch |

---

### Users Module — `src/users/`

All endpoints guarded by `@UseGuards(RolesGuard) @Roles('owner', 'admin')`.

#### `users.controller.ts`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user (body: `{ email, password, role, name? }`) |
| PATCH | `/api/users/:id/role` | Update user role (body: `{ role }`) |
| DELETE | `/api/users/:id` | Delete user |

#### `users.service.ts`

- `findAll()` — SELECT all, ordered by `created_at`
- `create(email, password, role, name?)` — Rejects `'owner'` role; hashes password (bcrypt cost 12); INSERT
- `updateRole(targetId, newRole, actorRole)` — Rejects `'owner'` assignment; rejects modifying owner's role; UPDATE
- `remove(targetId, actorId)` — Rejects self-deletion; rejects deleting owner; DELETE

---

### File System Module — `src/fs/`

#### `fs.controller.ts`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/fs/children?parentId=` | List root or folder children |
| GET | `/api/fs/path/:id` | Get breadcrumb path to node |
| GET | `/api/fs/node/:id` | Get single node details |
| POST | `/api/fs/creditors` | Create creditor |
| PATCH | `/api/fs/creditors/:id` | Update creditor info (phone, email, description) |
| POST | `/api/fs/folders` | Create folder |
| POST | `/api/fs/files` | Upload file (Multer `FileInterceptor`) |
| PATCH | `/api/fs/nodes/:id` | Rename any node |
| DELETE | `/api/fs/nodes/:id` | Delete node recursively |
| GET | `/api/fs/files/:id/raw[/:filename]` | Download file (binary) |
| GET | `/api/fs/folders/:id/zip` | Download folder as ZIP stream |

#### `fs.service.ts` — `FsService`

- `listChildren(parentId)` — Query `fs_nodes` ordered by type, name
- `getNode(id)` — SELECT single node
- `getPath(id)` — Recursive CTE to walk parent chain (returns breadcrumb array)
- `createCreditor(name, info)` — INSERT creditor (parent_id = null)
- `updateCreditor(id, info)` — PATCH phone, email, description
- `createFolder(parentId, name)` — Verify parent exists and is not a file; INSERT folder
- `createFile(parentId, file)` — Verify parent; save buffer to storage; INSERT file node
- `renameNode(id, name)` — UPDATE fs_nodes SET name
- `deleteNode(id)` — Recursive CTE to collect all descendants; delete storage files; DELETE from DB
- `getFile(id)` — Query node → read from storage
- `streamFolderZip(folderId)` — Recursive tree walk → append files to archiver → return ZIP stream

#### `fs-storage.service.ts` — `FsStorageService`

Disk I/O for uploaded files. Root: `cwd/uploads/`. Path-traversal protection enforced.

- `save(relative, buffer)` — Create parent dirs + write file
- `read(relative)` — Read file buffer
- `delete(relative)` — Delete file (silently ignores ENOENT)

---

### Invoice Module — `src/invoice/`

#### `invoice.controller.ts`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/invoice/compare` | Upload & compare client + supplier PDFs (up to 50 each) |
| GET | `/api/invoice/history` | List comparison sessions (last 50) |
| GET | `/api/invoice/history/:id` | Get single session + line items |

Compare flow: parse each PDF → `compareGroups()` → persist to DB → return results.

#### `invoice-parser.service.ts` — `InvoiceParserService`

**Invoice type detection:**
- Client: PDF contains "LIVE ORDER" or "名字" (Chinese)
- Supplier: PDF contains "INVOICE" and "UNIT"

**Code validation regex:** `/^[A-Z]{1,3}\d{1,4}(?:-\d+)*$/`
**Blacklisted codes:** `['ATTN', 'PACKAGE', 'FEE', 'NOTE', 'REMARK']`

**Key interfaces:**
```typescript
InvoiceItem {
  code: string; description: string; qty: number;
  unitPrice?: number; subtotal?: number; discount?: string; isGift: boolean;
}
ParsedInvoice {
  type: 'client' | 'supplier'; filename: string; customerName: string;
  orderNo?: string; invoiceNo?: string; date: string;
  items: InvoiceItem[]; jpegBase64: string | null;
}
ItemComparison {
  code: string; description: string;
  clientQty: number; supplierQty: number;
  clientSubtotal: number; supplierSubtotal: number;
  match: boolean;
  clientFiles: Array<{ filename, qty, customerName, unitPrice?, subtotal? }>;
  supplierFiles: Array<{ filename, qty, customerName, unitPrice?, subtotal?, discount? }>;
}
```

**Methods:**
- `parseMarkerFile(buffer, filename)` — Extract text via `pdf-parse` → detect type → parse items
- `compareGroups(clientGroup, supplierGroup)` — Aggregate items by code across all files; compare totals

#### `database.service.ts` — `DatabaseService`

PostgreSQL pool (configured via `DATABASE_URL` or individual env vars + SSL).

- `query(sql, params?)` — Execute parameterized SQL
- `connect()` — Get pool client for transactions
- `persistComparison(clientParsed, supplierParsed, comparison)` — Transactional insert: session → file records → comparison items → line items (BEGIN / COMMIT / ROLLBACK)

---

### Database Module — `src/database/`

`DatabaseModule` exports `DatabaseService` so other modules can inject it.

---

## Spiders — `spiders/`

Scrapy (Python) project for scraping the Fashion Index B2B platform.

```
spiders/
├── doo_admin/                    Scrapy project (admin orders)
│   ├── settings.py               Scrapy config (concurrency, throttling)
│   ├── items.py                  Data model definitions
│   ├── middlewares.py
│   ├── pipelines.py
│   └── spiders/
│       └── DoodooAdmin.py        Main order spider
├── doo_fashionindex/             Alternative Scrapy project
│   └── spiders/
│       └── BeautyStall.py        Beauty Stall scraper
├── scrapy.cfg                    Project root config
└── fashionIndex.json             Scraped data output
```

### `DoodooAdmin.py` — `loginBStall` spider

Target: `https://b2b.fashionindex.com.my/`

Flow: Login with CSRF → verify auth → paginate orders → extract per-product rows.

Output fields: `orderLink`, `trackingNo`, `shippingOrder`, `productName`, `productCode`, `priceValue`, `quantityValue`, `subtotalValue`.

---

## Full API Reference

### Auth
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Login; sets httpOnly JWT cookie |
| POST | `/api/auth/logout` | JWT | Logout; clears cookie |
| GET | `/api/auth/me` | JWT | Current user info |

### Users (owner/admin only)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user |
| PATCH | `/api/users/:id/role` | Update role |
| DELETE | `/api/users/:id` | Delete user |

### File System
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/fs/children?parentId=` | List folder contents |
| GET | `/api/fs/path/:id` | Breadcrumb path |
| GET | `/api/fs/node/:id` | Node details |
| POST | `/api/fs/creditors` | Create creditor |
| PATCH | `/api/fs/creditors/:id` | Update creditor info |
| POST | `/api/fs/folders` | Create folder |
| POST | `/api/fs/files` | Upload file |
| PATCH | `/api/fs/nodes/:id` | Rename node |
| DELETE | `/api/fs/nodes/:id` | Delete node (recursive) |
| GET | `/api/fs/files/:id/raw[/:filename]` | Download file |
| GET | `/api/fs/folders/:id/zip` | Download folder as ZIP |

### Invoice
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/invoice/compare` | Compare client + supplier PDFs |
| GET | `/api/invoice/history` | List comparison sessions |
| GET | `/api/invoice/history/:id` | Session details |

---

## Notable Conventions

- **httpOnly cookies** — JWT never stored in localStorage (XSS-safe); all API calls use `withCredentials: true`
- **Standalone components** — All Angular components use `standalone: true` (no NgModules)
- **Signals-first state** — Component state uses Angular Signals; RxJS only in services
- **File hierarchy** — Creditor → Folder → File (mirrors a real file system)
- **Recursive deletion** — Uses PostgreSQL recursive CTEs to collect descendants before deletion
- **UUID node IDs** — File system nodes identified by UUIDs
- **CJK filename handling** — PDF filenames decoded from latin1 to UTF-8
- **Transactional persistence** — Invoice comparisons saved atomically (BEGIN / COMMIT / ROLLBACK)
- **PDF preview** — `DomSanitizer.bypassSecurityTrustResourceUrl()` for inline viewing
- **SSR** — Angular SSR with Express; event-replay hydration for dynamic API-driven content

---

## Running the App

```bash
# Frontend (from doodoo-fam/)
nx serve doodoo-fam      # → http://localhost:4200

# Backend (from doodoo/)
npm run start:dev         # → http://localhost:3000
```

Dev proxy (`proxy.conf.json`) forwards `/api/*` → `http://localhost:3000` so both servers run independently during development.
