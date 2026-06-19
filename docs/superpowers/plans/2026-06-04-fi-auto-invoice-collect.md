# FI Auto Invoice Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On first visit to `/creditors` each day, automatically scrape FashionIndex for new IWS invoices and save their PDFs into monthly folders under the "Fashion Index" creditor in the file system.

**Architecture:** A new `FiAutoCollectService` (NestJS) runs a background job triggered by a new `GET /api/fashion-index/collect/check-daily` endpoint. The Creator Angular component calls this on `ngOnInit`, gets back a `jobId`, polls status, and shows a dismissible banner. The job scrapes the FI order list for new IWS Invoice IDs (not yet in `fi_saved_invoices` DB table), downloads each invoice as PDF via Playwright, and saves them via `FsService` into `YYYY-MM` folders under the existing "Fashion Index" creditor node.

**Tech Stack:** NestJS, Playwright (chromium), PostgreSQL, Angular 21 signals, `page.pdf()` for HTML→PDF conversion.

---

## File Map

### New Backend Files
- `doodoo/migrations/006-fi-auto-collect.sql` — `last_fi_check` on users + `fi_saved_invoices` table
- `doodoo/src/fashion-index/fi-auto-collect.service.ts` — orchestration + in-memory job tracking
- `doodoo/src/fashion-index/fi-auto-collect.service.spec.ts` — unit tests
- `doodoo/src/fashion-index/fi-auto-collect.controller.ts` — `check-daily` + `jobs/:jobId` endpoints

### Modified Backend Files
- `doodoo/src/fashion-index/fashion-index.scraper.ts` — add `scrapeOrderList()` + `downloadInvoicePdfs()`
- `doodoo/src/fashion-index/fashion-index.scraper.spec.ts` — tests for new scraper methods
- `doodoo/src/fashion-index/fi.types.ts` — add `FiDiscoveredOrder`, `FiAutoCollectJob`
- `doodoo/src/fashion-index/fashion-index.module.ts` — import FsModule, register new service + controller
- `doodoo/src/fs/fs.module.ts` — export `FsService` and `FsStorageService`

### New Frontend Files
- `doodoo-fam/src/app/pages/invoice/creator/fi-collect.service.ts` — HTTP wrapper (check-daily + poll)

### Modified Frontend Files
- `doodoo-fam/src/app/pages/invoice/creator/creator.ts` — banner signals + poll on init
- `doodoo-fam/src/app/pages/invoice/creator/creator.html` — banner markup
- `doodoo-fam/src/app/pages/invoice/creator/creator.scss` — banner styles

---

## Tasks

### Task 1: DB Migration — fi-auto-collect schema

**Goal:** Add `last_fi_check` column to `users` and create `fi_saved_invoices` tracking table.

**Files:**
- Create: `doodoo/migrations/006-fi-auto-collect.sql`

**Acceptance Criteria:**
- [ ] `users` table has a nullable `last_fi_check TIMESTAMPTZ` column
- [ ] `fi_saved_invoices` table exists with `iws_id` as primary key, `saved_at`, and `fs_node_id`
- [ ] Migration is idempotent (`IF NOT EXISTS` / `IF NOT EXISTS` column guard)

**Verify:** Run `psql $DATABASE_URL -f doodoo/migrations/006-fi-auto-collect.sql` twice without error, then `\d users` shows `last_fi_check` and `\dt fi_saved_invoices` shows the table.

**Steps:**

- [ ] **Step 1: Write the migration SQL**

```sql
-- 006-fi-auto-collect.sql

-- Track last daily collect per user
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_fi_check TIMESTAMPTZ;

-- Track which IWS invoices have been saved
CREATE TABLE IF NOT EXISTS fi_saved_invoices (
  iws_id      VARCHAR(50)  PRIMARY KEY,
  saved_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  fs_node_id  UUID
);
```

- [ ] **Step 2: Run migration**

```bash
cd doodoo
psql $DATABASE_URL -f migrations/006-fi-auto-collect.sql
```

- [ ] **Step 3: Commit**

```bash
git add doodoo/migrations/006-fi-auto-collect.sql
git commit -m "feat(db): add fi_saved_invoices table and last_fi_check on users"
```

---

### Task 2: Types — FiDiscoveredOrder + FiAutoCollectJob

**Goal:** Extend `fi.types.ts` with two new interfaces needed by the scraper and service.

**Files:**
- Modify: `doodoo/src/fashion-index/fi.types.ts`

**Acceptance Criteria:**
- [ ] `FiDiscoveredOrder` has `iwsId: string` and `numericOrderId: string`
- [ ] `FiAutoCollectJob` has `status: 'running' | 'done' | 'error'`, `message: string`, `newCount?: number`, `error?: string`
- [ ] TypeScript compiles without errors

**Verify:** `cd doodoo && npx tsc --noEmit` → no errors.

**Steps:**

- [ ] **Step 1: Add new interfaces to fi.types.ts**

Append after the existing `FiJob` interface:

```typescript
export interface FiDiscoveredOrder {
  iwsId: string;
  numericOrderId: string;
}

export type FiAutoCollectStatus = 'running' | 'done' | 'error';

export interface FiAutoCollectJob {
  status: FiAutoCollectStatus;
  message: string;
  newCount?: number;
  error?: string;
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd doodoo && npx tsc --noEmit
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add doodoo/src/fashion-index/fi.types.ts
git commit -m "feat(fi-types): add FiDiscoveredOrder and FiAutoCollectJob"
```

---

### Task 3: Scraper — order list discovery

**Goal:** Add `scrapeOrderList()` to `FashionIndexScraper` — logs into FI, reads the order list page, returns unique `FiDiscoveredOrder[]` (IWS Invoice ID + numeric order ID pairs, rows without an IWS ID are skipped).

**Files:**
- Modify: `doodoo/src/fashion-index/fashion-index.scraper.ts`
- Modify: `doodoo/src/fashion-index/fashion-index.scraper.spec.ts`

**Acceptance Criteria:**
- [ ] `scrapeOrderList()` returns only rows where `iwsId` is non-empty and not `'-'`
- [ ] Results are deduplicated by `iwsId` (first-seen `numericOrderId` wins)
- [ ] Numeric order ID is extracted from the "View Order" link `href` via `/\/order\/(\d+)/` regex
- [ ] Unit test: mock page returns 3 rows, 2 share same IWS ID → result has 2 entries
- [ ] Unit test: rows with `iwsId === '-'` or empty are excluded

**Verify:** `cd doodoo && npx jest fashion-index.scraper --testNamePattern="scrapeOrderList" --no-coverage` → all pass.

**Steps:**

- [ ] **Step 1: Write failing tests**

Add to `doodoo/src/fashion-index/fashion-index.scraper.spec.ts`:

```typescript
describe('FashionIndexScraper.scrapeOrderList', () => {
  let scraper: FashionIndexScraper;
  let mockPage: any;
  let mockBrowser: any;
  let mockContext: any;

  beforeEach(() => {
    mockPage = {
      goto: jest.fn(),
      fill: jest.fn(),
      click: jest.fn(),
      waitForLoadState: jest.fn(),
      $eval: jest.fn(),
      $$eval: jest.fn(),
      $: jest.fn(),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
    };
    mockContext = { newPage: jest.fn().mockResolvedValue(mockPage), close: jest.fn() };
    mockBrowser = { newContext: jest.fn().mockResolvedValue(mockContext), close: jest.fn() };
    (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
    scraper = new FashionIndexScraper();
  });

  it('returns deduplicated FiDiscoveredOrder[] skipping rows without IWS ID', async () => {
    // Mock login check
    mockPage.$ = jest.fn().mockResolvedValue({ textContent: async () => 'Log Out' });
    // Mock nav href
    mockPage.$eval.mockResolvedValueOnce('https://b2b.fashionindex.com.my/orders');
    // Mock table rows: row1 iwsId=IWS001 numericId=100, row2 iwsId=IWS001 numericId=101 (dup), row3 iwsId='-' (skip)
    mockPage.$$eval.mockResolvedValueOnce([
      { iwsId: 'IWS001', numericOrderId: '100' },
      { iwsId: 'IWS001', numericOrderId: '101' },
      { iwsId: '-', numericOrderId: '102' },
    ]);
    const result = await scraper.scrapeOrderList();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ iwsId: 'IWS001', numericOrderId: '100' });
  });

  it('returns empty array when no rows have valid IWS ID', async () => {
    mockPage.$ = jest.fn().mockResolvedValue({ textContent: async () => 'Log Out' });
    mockPage.$eval.mockResolvedValueOnce('https://b2b.fashionindex.com.my/orders');
    mockPage.$$eval.mockResolvedValueOnce([]);
    const result = await scraper.scrapeOrderList();
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd doodoo && npx jest fashion-index.scraper --testNamePattern="scrapeOrderList" --no-coverage
```

Expected: FAIL — `scrapeOrderList is not a function`.

- [ ] **Step 3: Add `scrapeOrderList` selector constant and method**

Add constants at the top of `fashion-index.scraper.ts` (after existing constants):

```typescript
const FI_ORDER_LIST_ROW_SELECTOR = 'table tbody tr';
```

Add the public method and private helper to `FashionIndexScraper`:

```typescript
async scrapeOrderList(): Promise<FiDiscoveredOrder[]> {
  const browser = await chromium.launch({
    headless: process.env['PLAYWRIGHT_HEADFUL'] !== 'true',
  });
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await this.loginFashionIndex(page);
    const ordersHref = await page.$eval(
      FI_ORDERS_NAV,
      (el: HTMLAnchorElement) => el.href,
    );
    await page.goto(ordersHref);
    await page.waitForLoadState('networkidle');
    return await this.extractOrderListRows(page);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

private async extractOrderListRows(page: Page): Promise<FiDiscoveredOrder[]> {
  const raw = await page.$$eval(FI_ORDER_LIST_ROW_SELECTOR, (rows: Element[]) =>
    rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      // Invoice ID is the 6th column (index 5)
      const iwsId = cells[5]?.textContent?.trim() ?? '';
      const viewLink = row.querySelector('a[href*="/order/"]') as HTMLAnchorElement | null;
      const href = viewLink?.getAttribute('href') ?? '';
      const match = href.match(/\/order\/(\d+)/);
      const numericOrderId = match?.[1] ?? '';
      return { iwsId, numericOrderId };
    }),
  );

  // Deduplicate by iwsId, keeping first occurrence, skip empty/dash
  const seen = new Set<string>();
  const result: FiDiscoveredOrder[] = [];
  for (const row of raw) {
    if (!row.iwsId || row.iwsId === '-' || !row.numericOrderId) continue;
    if (seen.has(row.iwsId)) continue;
    seen.add(row.iwsId);
    result.push(row as FiDiscoveredOrder);
  }
  return result;
}
```

Add `FiDiscoveredOrder` to the import at the top of `fashion-index.scraper.ts`:

```typescript
import { DoodooOrderItem, FiDiscoveredOrder, FiOrderRow, FiScrapedItem } from './fi.types';
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd doodoo && npx jest fashion-index.scraper --testNamePattern="scrapeOrderList" --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add doodoo/src/fashion-index/fashion-index.scraper.ts doodoo/src/fashion-index/fashion-index.scraper.spec.ts
git commit -m "feat(fi-scraper): add scrapeOrderList for auto IWS invoice discovery"
```

---

### Task 4: Scraper — download invoice PDFs

**Goal:** Add `downloadInvoicePdfs(orders)` to `FashionIndexScraper` — logs into FI once, navigates to each `/order/{numericId}/invoice` page, captures it as PDF via `page.pdf()`, returns `Map<iwsId, Buffer>`.

**Files:**
- Modify: `doodoo/src/fashion-index/fashion-index.scraper.ts`
- Modify: `doodoo/src/fashion-index/fashion-index.scraper.spec.ts`

**Acceptance Criteria:**
- [ ] One browser session for all downloads (single login)
- [ ] Returns `Map<string, Buffer>` keyed by `iwsId`
- [ ] If `page.pdf()` throws for one order, logs a warning and continues — that `iwsId` is absent from the result map
- [ ] Unit test: mock `page.pdf()` returns a buffer → map has entry
- [ ] Unit test: mock `page.pdf()` throws → map entry absent, other entries present

**Verify:** `cd doodoo && npx jest fashion-index.scraper --testNamePattern="downloadInvoicePdfs" --no-coverage` → all pass.

**Steps:**

- [ ] **Step 1: Write failing tests**

Add to the scraper spec file:

```typescript
describe('FashionIndexScraper.downloadInvoicePdfs', () => {
  let scraper: FashionIndexScraper;
  let mockPage: any;
  let mockBrowser: any;
  let mockContext: any;

  beforeEach(() => {
    mockPage = {
      goto: jest.fn(),
      fill: jest.fn(),
      click: jest.fn(),
      waitForLoadState: jest.fn(),
      $: jest.fn().mockResolvedValue({ textContent: async () => 'Log Out' }),
      $eval: jest.fn(),
      $$eval: jest.fn(),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn(),
    };
    mockContext = { newPage: jest.fn().mockResolvedValue(mockPage), close: jest.fn() };
    mockBrowser = { newContext: jest.fn().mockResolvedValue(mockContext), close: jest.fn() };
    (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
    scraper = new FashionIndexScraper();
  });

  it('returns map with PDF buffer for each order', async () => {
    const fakePdf = Buffer.from('%PDF-test');
    mockPage.pdf.mockResolvedValue(fakePdf);
    const orders: FiDiscoveredOrder[] = [
      { iwsId: 'IWS001', numericOrderId: '100' },
      { iwsId: 'IWS002', numericOrderId: '200' },
    ];
    const result = await scraper.downloadInvoicePdfs(orders);
    expect(result.size).toBe(2);
    expect(result.get('IWS001')).toEqual(fakePdf);
    expect(result.get('IWS002')).toEqual(fakePdf);
  });

  it('skips failed PDF download and continues with remaining orders', async () => {
    const fakePdf = Buffer.from('%PDF-ok');
    mockPage.pdf
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(fakePdf);
    const orders: FiDiscoveredOrder[] = [
      { iwsId: 'IWS001', numericOrderId: '100' },
      { iwsId: 'IWS002', numericOrderId: '200' },
    ];
    const result = await scraper.downloadInvoicePdfs(orders);
    expect(result.has('IWS001')).toBe(false);
    expect(result.get('IWS002')).toEqual(fakePdf);
  });
});
```

Also add the import at the top of the spec file:
```typescript
import { FiDiscoveredOrder } from './fi.types';
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd doodoo && npx jest fashion-index.scraper --testNamePattern="downloadInvoicePdfs" --no-coverage
```

Expected: FAIL — `downloadInvoicePdfs is not a function`.

- [ ] **Step 3: Implement `downloadInvoicePdfs`**

Add to `FashionIndexScraper`:

```typescript
async downloadInvoicePdfs(
  orders: FiDiscoveredOrder[],
): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  if (orders.length === 0) return result;

  const browser = await chromium.launch({
    headless: process.env['PLAYWRIGHT_HEADFUL'] !== 'true',
  });
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await this.loginFashionIndex(page);
    for (const order of orders) {
      try {
        await page.goto(
          `${FI_URL}/order/${order.numericOrderId}/invoice`,
        );
        await page.waitForLoadState('networkidle');
        const pdfBuffer = Buffer.from(
          await page.pdf({ format: 'A4', printBackground: true }),
        );
        result.set(order.iwsId, pdfBuffer);
      } catch (err: any) {
        this.logger.warn(
          `Failed to download invoice PDF for ${order.iwsId}: ${err.message}`,
        );
      }
    }
    return result;
  } finally {
    await ctx.close();
    await browser.close();
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd doodoo && npx jest fashion-index.scraper --testNamePattern="downloadInvoicePdfs" --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add doodoo/src/fashion-index/fashion-index.scraper.ts doodoo/src/fashion-index/fashion-index.scraper.spec.ts
git commit -m "feat(fi-scraper): add downloadInvoicePdfs for invoice PDF capture"
```

---

### Task 5: FiAutoCollectService

**Goal:** Implement `FiAutoCollectService` — the orchestrator that runs the full daily collect pipeline as a background job, persists results to `fi_saved_invoices`, and saves PDFs to the file system via `FsService`.

**Files:**
- Create: `doodoo/src/fashion-index/fi-auto-collect.service.ts`
- Create: `doodoo/src/fashion-index/fi-auto-collect.service.spec.ts`

**Acceptance Criteria:**
- [ ] `startCollect(userId)` returns a job ID synchronously; pipeline runs async
- [ ] If `last_fi_check` is today (UTC date), returns existing running job ID or starts a new one (caller decides — service always starts a new job when called)
- [ ] Skips IWS IDs already in `fi_saved_invoices`
- [ ] If no new IWS IDs found, job reaches `done` with `newCount: 0` without scraping PDFs
- [ ] Finds "Fashion Index" creditor via case-insensitive name match; logs warning and sets error if not found
- [ ] Creates `YYYY-MM` folder if it doesn't exist (formatted from `new Date()` → `toISOString().slice(0,7)`)
- [ ] Inserts each saved invoice into `fi_saved_invoices` with `fs_node_id`
- [ ] Job reaches `error` status if any unrecoverable exception occurs
- [ ] Tests mock `FashionIndexScraper` and `FsService`

**Verify:** `cd doodoo && npx jest fi-auto-collect.service --no-coverage` → all pass.

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `doodoo/src/fashion-index/fi-auto-collect.service.spec.ts`:

```typescript
import { FiAutoCollectService } from './fi-auto-collect.service';
import { FashionIndexScraper } from './fashion-index.scraper';
import { FsService } from '../fs/fs.service';
import { DatabaseService } from '../invoice/database.service';

jest.mock('./fashion-index.scraper');
jest.mock('../fs/fs.service');
jest.mock('../invoice/database.service');

describe('FiAutoCollectService', () => {
  let service: FiAutoCollectService;
  let scraper: jest.Mocked<FashionIndexScraper>;
  let fsService: jest.Mocked<FsService>;
  let db: jest.Mocked<DatabaseService>;

  beforeEach(() => {
    scraper = new FashionIndexScraper() as jest.Mocked<FashionIndexScraper>;
    fsService = new FsService(null as any, null as any) as jest.Mocked<FsService>;
    db = new DatabaseService() as jest.Mocked<DatabaseService>;
    service = new FiAutoCollectService(scraper, fsService, db);
  });

  it('startCollect returns a job ID string immediately', () => {
    scraper.scrapeOrderList = jest.fn().mockResolvedValue([]);
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    const jobId = service.startCollect(1);
    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);
  });

  it('job reaches done with newCount 0 when no new IWS IDs', async () => {
    scraper.scrapeOrderList = jest.fn().mockResolvedValue([
      { iwsId: 'IWS001', numericOrderId: '100' },
    ]);
    // DB says IWS001 already saved
    db.query = jest.fn().mockResolvedValue({ rows: [{ iws_id: 'IWS001' }] });
    const jobId = service.startCollect(1);
    await new Promise(r => setTimeout(r, 50));
    const job = service.getJob(jobId);
    expect(job?.status).toBe('done');
    expect(job?.newCount).toBe(0);
    expect(scraper.downloadInvoicePdfs).not.toHaveBeenCalled();
  });

  it('job reaches done with newCount N when new IWS IDs found', async () => {
    scraper.scrapeOrderList = jest.fn().mockResolvedValue([
      { iwsId: 'IWS002', numericOrderId: '200' },
    ]);
    // DB says none saved yet
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [] }) // fi_saved_invoices check
      .mockResolvedValueOnce({ rows: [{ id: 'creditor-uuid' }] }) // find FI creditor
      .mockResolvedValueOnce({ rows: [] }) // find existing YYYY-MM folder
      .mockResolvedValueOnce({ rows: [{ id: 'folder-uuid', type: 'folder', name: '2026-06' }] }) // createFolder
      .mockResolvedValueOnce({ rows: [] }); // insert fi_saved_invoices
    scraper.downloadInvoicePdfs = jest.fn().mockResolvedValue(
      new Map([['IWS002', Buffer.from('%PDF')]]),
    );
    fsService.createFolder = jest.fn().mockResolvedValue({ id: 'folder-uuid', type: 'folder', name: '2026-06', parent_id: 'creditor-uuid', size_bytes: null, storage_path: null, created_at: '', phone: null, email: null, description: null });
    fsService.createFile = jest.fn().mockResolvedValue({ id: 'file-uuid', type: 'file', name: 'IWS002.pdf', parent_id: 'folder-uuid', size_bytes: 4, storage_path: 'file-uuid', created_at: '', phone: null, email: null, description: null });

    const jobId = service.startCollect(1);
    await new Promise(r => setTimeout(r, 100));
    const job = service.getJob(jobId);
    expect(job?.status).toBe('done');
    expect(job?.newCount).toBe(1);
  });

  it('job reaches error if scraper throws', async () => {
    scraper.scrapeOrderList = jest.fn().mockRejectedValue(new Error('FI login failed'));
    const jobId = service.startCollect(1);
    await new Promise(r => setTimeout(r, 50));
    const job = service.getJob(jobId);
    expect(job?.status).toBe('error');
    expect(job?.error).toContain('FI login failed');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd doodoo && npx jest fi-auto-collect.service --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FiAutoCollectService`**

Create `doodoo/src/fashion-index/fi-auto-collect.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FashionIndexScraper } from './fashion-index.scraper';
import { FsService } from '../fs/fs.service';
import { DatabaseService } from '../invoice/database.service';
import { FiAutoCollectJob, FiDiscoveredOrder } from './fi.types';

@Injectable()
export class FiAutoCollectService {
  private readonly logger = new Logger(FiAutoCollectService.name);
  private readonly jobs = new Map<string, FiAutoCollectJob>();

  constructor(
    private readonly scraper: FashionIndexScraper,
    private readonly fsService: FsService,
    private readonly db: DatabaseService,
  ) {}

  startCollect(userId: number): string {
    const jobId = randomUUID();
    this.jobs.set(jobId, { status: 'running', message: 'Checking for new FI invoices…' });
    this.runCollect(jobId, userId).catch(() => {});
    return jobId;
  }

  getJob(jobId: string): FiAutoCollectJob | undefined {
    return this.jobs.get(jobId);
  }

  private update(jobId: string, patch: Partial<FiAutoCollectJob>): void {
    const job = this.jobs.get(jobId);
    if (job) Object.assign(job, patch);
  }

  private async runCollect(jobId: string, _userId: number): Promise<void> {
    try {
      this.update(jobId, { message: 'Scraping FI order list…' });
      const discovered = await this.scraper.scrapeOrderList();

      if (discovered.length === 0) {
        this.update(jobId, { status: 'done', message: 'No new invoices.', newCount: 0 });
        return;
      }

      // Filter out already-saved IWS IDs
      const { rows: savedRows } = await this.db.query(
        `SELECT iws_id FROM fi_saved_invoices WHERE iws_id = ANY($1)`,
        [discovered.map((d) => d.iwsId)],
      );
      const savedIds = new Set((savedRows as { iws_id: string }[]).map((r) => r.iws_id));
      const newOrders: FiDiscoveredOrder[] = discovered.filter((d) => !savedIds.has(d.iwsId));

      if (newOrders.length === 0) {
        this.update(jobId, { status: 'done', message: 'No new invoices.', newCount: 0 });
        return;
      }

      this.update(jobId, { message: `Downloading ${newOrders.length} invoice PDF(s)…` });
      const pdfMap = await this.scraper.downloadInvoicePdfs(newOrders);

      this.update(jobId, { message: 'Saving to file system…' });
      const folderId = await this.getOrCreateMonthlyFolder();
      if (!folderId) {
        throw new Error('Fashion Index creditor not found in file system');
      }

      const month = new Date().toISOString().slice(0, 7); // YYYY-MM
      let savedCount = 0;
      for (const order of newOrders) {
        const pdfBuffer = pdfMap.get(order.iwsId);
        if (!pdfBuffer) {
          this.logger.warn(`No PDF buffer for ${order.iwsId} — skipping`);
          continue;
        }
        try {
          const fileNode = await this.fsService.createFile(folderId, {
            buffer: pdfBuffer,
            originalname: `${order.iwsId}.pdf`,
          });
          await this.db.query(
            `INSERT INTO fi_saved_invoices (iws_id, fs_node_id) VALUES ($1, $2) ON CONFLICT (iws_id) DO NOTHING`,
            [order.iwsId, fileNode.id],
          );
          savedCount++;
        } catch (err: any) {
          this.logger.warn(`Failed to save ${order.iwsId}: ${err.message}`);
        }
      }

      this.update(jobId, {
        status: 'done',
        message: savedCount > 0
          ? `${savedCount} new invoice(s) saved to Fashion Index / ${month}`
          : 'No new invoices.',
        newCount: savedCount,
      });
    } catch (err: any) {
      this.logger.error(`Auto-collect job ${jobId} failed: ${err.message}`);
      this.update(jobId, { status: 'error', message: err.message, error: err.message });
    }
  }

  private async getOrCreateMonthlyFolder(): Promise<string | null> {
    // Find "Fashion Index" creditor (case-insensitive)
    const { rows: creditorRows } = await this.db.query(
      `SELECT id FROM fs_nodes WHERE type = 'creditor' AND LOWER(name) LIKE '%fashion%' LIMIT 1`,
    );
    if (!creditorRows[0]) {
      this.logger.warn('No "Fashion Index" creditor found in fs_nodes');
      return null;
    }
    const creditorId: string = creditorRows[0].id;

    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    // Find or create monthly folder
    const { rows: folderRows } = await this.db.query(
      `SELECT id FROM fs_nodes WHERE parent_id = $1 AND type = 'folder' AND name = $2`,
      [creditorId, month],
    );
    if (folderRows[0]) return folderRows[0].id as string;

    const folder = await this.fsService.createFolder(creditorId, month);
    return folder.id;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd doodoo && npx jest fi-auto-collect.service --no-coverage
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add doodoo/src/fashion-index/fi-auto-collect.service.ts doodoo/src/fashion-index/fi-auto-collect.service.spec.ts
git commit -m "feat(fi-auto-collect): implement FiAutoCollectService with daily collect pipeline"
```

---

### Task 6: NestJS wiring — module, controller, FsModule export

**Goal:** Wire `FiAutoCollectService` and its controller into NestJS; export `FsService` from `FsModule` so `FashionIndexModule` can inject it.

**Files:**
- Create: `doodoo/src/fashion-index/fi-auto-collect.controller.ts`
- Modify: `doodoo/src/fashion-index/fashion-index.module.ts`
- Modify: `doodoo/src/fs/fs.module.ts`

**Acceptance Criteria:**
- [ ] `GET /api/fashion-index/collect/check-daily` triggers a new job if `last_fi_check` is not today (UTC), updates `users.last_fi_check`, returns `{ jobId: string | null }`
- [ ] `GET /api/fashion-index/collect/jobs/:jobId` returns the job status
- [ ] `FsModule` exports `FsService` and `FsStorageService`
- [ ] `FashionIndexModule` imports `FsModule`
- [ ] `npx tsc --noEmit` passes

**Verify:** `cd doodoo && npx tsc --noEmit` → no errors. Manual test: `curl -X GET http://localhost:3000/api/fashion-index/collect/check-daily` (with valid auth cookie) → `{"jobId":"..."}` or `{"jobId":null}`.

**Steps:**

- [ ] **Step 1: Create `fi-auto-collect.controller.ts`**

```typescript
import { Controller, Get, NotFoundException, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { FiAutoCollectService } from './fi-auto-collect.service';
import { DatabaseService } from '../invoice/database.service';

interface AuthenticatedRequest extends Request {
  user: { id: number; email: string; role: string };
}

@Controller('fashion-index/collect')
export class FiAutoCollectController {
  constructor(
    private readonly autoCollect: FiAutoCollectService,
    private readonly db: DatabaseService,
  ) {}

  @Get('check-daily')
  async checkDaily(@Req() req: AuthenticatedRequest): Promise<{ jobId: string | null }> {
    const userId = req.user.id;
    const { rows } = await this.db.query(
      `SELECT last_fi_check FROM users WHERE id = $1`,
      [userId],
    );
    const lastCheck: Date | null = rows[0]?.last_fi_check ?? null;
    const todayUTC = new Date().toISOString().slice(0, 10);
    const lastCheckDate = lastCheck
      ? new Date(lastCheck).toISOString().slice(0, 10)
      : null;

    if (lastCheckDate === todayUTC) {
      return { jobId: null };
    }

    await this.db.query(
      `UPDATE users SET last_fi_check = now() WHERE id = $1`,
      [userId],
    );
    const jobId = this.autoCollect.startCollect(userId);
    return { jobId };
  }

  @Get('jobs/:jobId')
  getJob(@Param('jobId') jobId: string) {
    const job = this.autoCollect.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    return job;
  }
}
```

- [ ] **Step 2: Export FsService from FsModule**

Edit `doodoo/src/fs/fs.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { FsController } from './fs.controller';
import { FsService } from './fs.service';
import { FsStorageService } from './fs-storage.service';

@Module({
  controllers: [FsController],
  providers: [FsService, FsStorageService],
  exports: [FsService, FsStorageService],
})
export class FsModule {}
```

- [ ] **Step 3: Update FashionIndexModule**

Edit `doodoo/src/fashion-index/fashion-index.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { FashionIndexController } from './fashion-index.controller';
import { FashionIndexService } from './fashion-index.service';
import { FashionIndexScraper } from './fashion-index.scraper';
import { FiComparisonService } from './fi-comparison.service';
import { FiAutoCollectService } from './fi-auto-collect.service';
import { FiAutoCollectController } from './fi-auto-collect.controller';
import { FsModule } from '../fs/fs.module';

@Module({
  imports: [FsModule],
  controllers: [FashionIndexController, FiAutoCollectController],
  providers: [FashionIndexService, FashionIndexScraper, FiComparisonService, FiAutoCollectService],
})
export class FashionIndexModule {}
```

- [ ] **Step 4: Verify compilation**

```bash
cd doodoo && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add doodoo/src/fashion-index/fi-auto-collect.controller.ts doodoo/src/fashion-index/fashion-index.module.ts doodoo/src/fs/fs.module.ts
git commit -m "feat(fi-module): wire FiAutoCollectService, controller, and FsModule export"
```

---

### Task 7: Angular — FiCollectService + Creator banner

**Goal:** Add `FiCollectService` to call the `check-daily` and poll `jobs/:jobId` endpoints; add a dismissible banner to the Creator component that shows collect status on `ngOnInit`.

**Files:**
- Create: `doodoo-fam/src/app/pages/invoice/creator/fi-collect.service.ts`
- Modify: `doodoo-fam/src/app/pages/invoice/creator/creator.ts`
- Modify: `doodoo-fam/src/app/pages/invoice/creator/creator.html`
- Modify: `doodoo-fam/src/app/pages/invoice/creator/creator.scss`

**Acceptance Criteria:**
- [ ] `FiCollectService.checkDaily()` calls `GET /api/fashion-index/collect/check-daily` and returns `{ jobId: string | null }`
- [ ] `FiCollectService.getJobStatus(jobId)` calls `GET /api/fashion-index/collect/jobs/:jobId`
- [ ] `Creator.ngOnInit` calls `checkDaily()`, sets `fiCollectJobId` if non-null, and starts polling every 3 s
- [ ] When job status is `running`, banner shows "Checking for new FI invoices…"
- [ ] When job status is `done` and `newCount > 0`, banner shows "X new invoice(s) saved to Fashion Index / YYYY-MM" and file tree refreshes
- [ ] When job status is `done` and `newCount === 0`, banner shows "No new FI invoices found"
- [ ] When job status is `error`, banner shows error message
- [ ] Banner is dismissible (× button sets `fiCollectStatus` to `null`)
- [ ] Polling stops when status reaches `done` or `error`

**Verify:** Build passes: `cd NxMonorepo/angular && npx nx build doodoo-fam --configuration=production` → no errors.

**Steps:**

- [ ] **Step 1: Create `fi-collect.service.ts`**

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface FiAutoCollectJob {
  status: 'running' | 'done' | 'error';
  message: string;
  newCount?: number;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class FiCollectService {
  constructor(private http: HttpClient) {}

  checkDaily(): Promise<{ jobId: string | null }> {
    return firstValueFrom(
      this.http.get<{ jobId: string | null }>('/api/fashion-index/collect/check-daily'),
    );
  }

  getJobStatus(jobId: string): Promise<FiAutoCollectJob> {
    return firstValueFrom(
      this.http.get<FiAutoCollectJob>(`/api/fashion-index/collect/jobs/${jobId}`),
    );
  }
}
```

- [ ] **Step 2: Add signals + polling to `creator.ts`**

Add these imports and fields (show only the changes):

```typescript
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FsApiService, FsNode } from './fs.service';
import { AuthService } from '../../../auth.service';
import { FiCollectService, FiAutoCollectJob } from './fi-collect.service';
```

Add the service injection and new signals inside the class (after the existing signal declarations):

```typescript
private fiCollect = inject(FiCollectService);

fiCollectStatus = signal<FiAutoCollectJob | null>(null);
private fiPollTimer: ReturnType<typeof setInterval> | null = null;
```

Replace `ngOnInit` with:

```typescript
ngOnInit(): void {
  this.loadRoot();
  this.startDailyCollectCheck();
}
```

Add the new methods before `loadRoot`:

```typescript
private async startDailyCollectCheck(): Promise<void> {
  try {
    const { jobId } = await this.fiCollect.checkDaily();
    if (!jobId) return;
    this.fiCollectStatus.set({ status: 'running', message: 'Checking for new FI invoices…' });
    this.fiPollTimer = setInterval(async () => {
      try {
        const job = await this.fiCollect.getJobStatus(jobId!);
        this.fiCollectStatus.set(job);
        if (job.status === 'done' || job.status === 'error') {
          this.stopFiPoll();
          if (job.status === 'done' && (job.newCount ?? 0) > 0) {
            await this.refresh();
          }
        }
      } catch {
        this.stopFiPoll();
      }
    }, 3000);
  } catch {
    // daily check fails silently — don't block the page
  }
}

dismissFiCollectBanner(): void {
  this.stopFiPoll();
  this.fiCollectStatus.set(null);
}

private stopFiPoll(): void {
  if (this.fiPollTimer !== null) {
    clearInterval(this.fiPollTimer);
    this.fiPollTimer = null;
  }
}
```

Implement `OnDestroy` to clean up the interval:

```typescript
ngOnDestroy(): void {
  this.stopFiPoll();
}
```

Update the class declaration line:

```typescript
export class Creator implements OnInit, OnDestroy {
```

- [ ] **Step 3: Add banner markup to `creator.html`**

Add the banner block immediately after the `@if (error())` block (around line 21):

```html
@if (fiCollectStatus(); as collect) {
<div class="fi-collect-banner"
     [class.fi-collect-banner--running]="collect.status === 'running'"
     [class.fi-collect-banner--done]="collect.status === 'done'"
     [class.fi-collect-banner--error]="collect.status === 'error'">
  <span class="material-symbols-outlined fi-collect-banner__icon">
    {{ collect.status === 'running' ? 'sync' : collect.status === 'done' ? 'check_circle' : 'error' }}
  </span>
  <span class="fi-collect-banner__message">{{ collect.message }}</span>
  <button class="fi-collect-banner__dismiss" (click)="dismissFiCollectBanner()" aria-label="Dismiss">×</button>
</div>
}
```

- [ ] **Step 4: Add banner styles to `creator.scss`**

Append to `creator.scss`:

```scss
.fi-collect-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 0.875rem;
  border: 1px solid var(--border);

  &--running {
    background: var(--brand-light);
    color: var(--brand);
    border-color: var(--brand);
  }

  &--done {
    background: #f0fdf4;
    color: #166534;
    border-color: #bbf7d0;
  }

  &--error {
    background: #fef2f2;
    color: #991b1b;
    border-color: #fecaca;
  }

  &__icon {
    font-size: 18px;
    flex-shrink: 0;
  }

  &__message {
    flex: 1;
  }

  &__dismiss {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.2rem;
    line-height: 1;
    color: inherit;
    padding: 0 4px;
    opacity: 0.6;

    &:hover { opacity: 1; }
  }
}
```

- [ ] **Step 5: Verify build passes**

```bash
cd NxMonorepo/angular && npx nx build doodoo-fam --configuration=production
```

Expected: `✔ Building...` with no errors.

- [ ] **Step 6: Commit**

```bash
git add doodoo-fam/src/app/pages/invoice/creator/fi-collect.service.ts \
        doodoo-fam/src/app/pages/invoice/creator/creator.ts \
        doodoo-fam/src/app/pages/invoice/creator/creator.html \
        doodoo-fam/src/app/pages/invoice/creator/creator.scss
git commit -m "feat(creator): add daily FI invoice collect banner with polling"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| Backend tracks `last_fi_check` per user | Task 1 (migration) + Task 6 (controller updates it) |
| "New" = IWS ID not in DB | Task 1 (`fi_saved_invoices` table) + Task 5 (filter logic) |
| Scrape FI order list for IWS IDs | Task 3 (`scrapeOrderList`) |
| Download invoice PDF at `/order/{id}/invoice` | Task 4 (`downloadInvoicePdfs`) |
| Save into Fashion Index creditor → YYYY-MM folder → IWS_ID.pdf | Task 5 (`getOrCreateMonthlyFolder` + `createFile`) |
| Trigger on first daily open of `/creditors` page | Task 6 (endpoint) + Task 7 (`ngOnInit` → `checkDaily()`) |
| Dismissible banner on `/creditors` | Task 7 (banner markup + `dismissFiCollectBanner`) |
| File tree refreshes when new files saved | Task 7 (`refresh()` call on `done` with `newCount > 0`) |

### Type consistency check

- `FiDiscoveredOrder` defined in Task 2 (types), used in Tasks 3, 4, 5 — consistent.
- `FiAutoCollectJob` defined in Task 2, used in Tasks 5, 6, 7 — consistent.
- `FiAutoCollectJob` in `fi-collect.service.ts` (Task 7) mirrors the backend type exactly.
- `scrapeOrderList()` returns `Promise<FiDiscoveredOrder[]>` in Task 3; consumed by `runCollect` in Task 5 — consistent.
- `downloadInvoicePdfs(orders: FiDiscoveredOrder[])` in Task 4; called in Task 5 — consistent.

### Placeholder scan

No TBD, TODO, or "similar to Task N" references found. All code blocks are complete.
