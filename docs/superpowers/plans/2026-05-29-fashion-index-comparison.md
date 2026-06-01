# Fashion Index Comparison Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Fashion Index comparison mode to `/comparisons` that accepts FI order IDs, scrapes both Fashion Index and doodoo520 admin using Playwright, parses shipping label PDFs to link the two systems, and displays per-item quantity match/mismatch results.

**Architecture:** A new `FashionIndexModule` in the NestJS backend orchestrates a Playwright-based TypeScript scraper that logs into both `b2b.fashionindex.com.my` and `doodoo520.com/admin`, then compares product code quantities. Jobs run in the background (in-memory Map); the Angular frontend polls a status endpoint. Results are persisted to three new DB tables.

**Tech Stack:** Playwright (chromium), pdf-parse (already installed), PostgreSQL, NestJS, Angular 21 signals.

---

## File Map

### New files
| Path | Responsibility |
|---|---|
| `doodoo/src/fashion-index/fi.types.ts` | All shared TS interfaces for this module |
| `doodoo/src/fashion-index/fi-pdf-parser.ts` | Extract `Content:#XXXXXX` order ID from a PDF buffer |
| `doodoo/src/fashion-index/fi-comparison.service.ts` | Pure comparison logic: match FI items vs doodoo items by product code |
| `doodoo/src/fashion-index/fashion-index.scraper.ts` | Playwright scraper: FI login + order scrape + PDF download + doodoo login + order scrape |
| `doodoo/src/fashion-index/fashion-index.service.ts` | Job orchestration (in-memory Map), calls scraper → pdf parser → comparison service → DB persist |
| `doodoo/src/fashion-index/fashion-index.controller.ts` | HTTP endpoints: POST /compare, GET /jobs/:id, GET /history |
| `doodoo/src/fashion-index/fashion-index.module.ts` | NestJS module wiring |
| `doodoo/migrations/004-fi-tables.sql` | Three new DB tables |
| `doodoo-fam/src/app/pages/invoice/comparison/fi.service.ts` | Angular service: startComparison + pollJob |

### Modified files
| Path | Change |
|---|---|
| `doodoo/.env` | Add FI_EMAIL, FI_PASSWORD, DOODOO_ADMIN_EMAIL, DOODOO_ADMIN_PASSWORD |
| `doodoo/package.json` | Add `playwright` dependency |
| `doodoo/src/app.module.ts` | Import FashionIndexModule |
| `doodoo-fam/src/app/pages/invoice/comparison/comparison.ts` | Add `activeMode` signal + FI signals + FI comparison method |
| `doodoo-fam/src/app/pages/invoice/comparison/comparison.html` | Add mode switcher tab + FI input view + FI results view |
| `doodoo-fam/src/app/pages/invoice/comparison/comparison.scss` | Styles for mode switcher, FI input, FI results table |

---

## Task 1: Install Playwright and add credentials to .env

**Goal:** Playwright is installed in the `doodoo/` project and credentials are available via environment variables so the scraper can read them at runtime.

**Files:**
- Modify: `doodoo/package.json`
- Modify: `doodoo/.env`

**Acceptance Criteria:**
- [ ] `npx playwright --version` runs without error from `doodoo/`
- [ ] Chromium browser binary is installed
- [ ] `doodoo/.env` contains all four credential keys
- [ ] Credentials are never hardcoded in TypeScript source files

**Verify:** From `doodoo/`: `npx playwright --version` → prints a version string like `Version 1.x.x`

**Steps:**

- [ ] **Step 1: Install Playwright**

Run from `doodoo/`:
```bash
npm install playwright
npx playwright install chromium
```

- [ ] **Step 2: Add credentials to .env**

Open `doodoo/.env` and append (do NOT overwrite existing vars):
```
FI_EMAIL=doodoolive777@gmail.com
FI_PASSWORD=Doodoo520
DOODOO_ADMIN_EMAIL=jiaenkoh45@gmail.com
DOODOO_ADMIN_PASSWORD=01110609869
```

- [ ] **Step 3: Verify**

```bash
cd doodoo && npx playwright --version
```
Expected: `Version 1.x.x` (no errors)

- [ ] **Step 4: Commit**

```bash
git add doodoo/package.json doodoo/package-lock.json doodoo/.env
git commit -m "feat: install playwright and add FI + doodoo admin credentials to env"
```

---

## Task 2: DB migration — FI comparison tables

**Goal:** Three new PostgreSQL tables exist that can store Fashion Index comparison sessions, per-order pairs, and per-item results.

**Files:**
- Create: `doodoo/migrations/004-fi-tables.sql`

**Acceptance Criteria:**
- [ ] Running the SQL against the database succeeds without errors
- [ ] `fi_sessions`, `fi_order_pairs`, `fi_item_comparisons` tables exist
- [ ] Foreign key constraints are in place between the three tables

**Verify:** `psql $DATABASE_URL -c "\dt fi_*"` → lists three tables

**Steps:**

- [ ] **Step 1: Create the migration file**

Create `doodoo/migrations/004-fi-tables.sql`:
```sql
CREATE TABLE IF NOT EXISTS fi_sessions (
  id             SERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_pairs    INT NOT NULL DEFAULT 0,
  mismatch_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fi_order_pairs (
  id              SERIAL PRIMARY KEY,
  session_id      INT NOT NULL REFERENCES fi_sessions(id) ON DELETE CASCADE,
  fi_order_id     VARCHAR(100) NOT NULL,
  fi_row_index    INT NOT NULL,
  doodoo_order_id VARCHAR(50),
  status          VARCHAR(30) NOT NULL
    CHECK (status IN ('compared', 'unlinked', 'doodoo_not_found'))
);

CREATE TABLE IF NOT EXISTS fi_item_comparisons (
  id            SERIAL PRIMARY KEY,
  pair_id       INT NOT NULL REFERENCES fi_order_pairs(id) ON DELETE CASCADE,
  product_code  VARCHAR(50)  NOT NULL,
  product_name  TEXT         NOT NULL,
  fi_qty        NUMERIC      NOT NULL DEFAULT 0,
  doodoo_qty    NUMERIC      NOT NULL DEFAULT 0,
  status        VARCHAR(20)  NOT NULL
    CHECK (status IN ('matched', 'qty_mismatch', 'fi_only', 'doodoo_only'))
);
```

- [ ] **Step 2: Run the migration**

```bash
psql $DATABASE_URL -f doodoo/migrations/004-fi-tables.sql
```

- [ ] **Step 3: Verify tables exist**

```bash
psql $DATABASE_URL -c "\dt fi_*"
```
Expected: three rows — `fi_item_comparisons`, `fi_order_pairs`, `fi_sessions`

- [ ] **Step 4: Commit**

```bash
git add doodoo/migrations/004-fi-tables.sql
git commit -m "feat: add fi_sessions, fi_order_pairs, fi_item_comparisons tables"
```

---

## Task 3: Shared types — fi.types.ts

**Goal:** A single types file defines every interface used by the FI module so later tasks can import from one place without circular dependencies.

**Files:**
- Create: `doodoo/src/fashion-index/fi.types.ts`

**Acceptance Criteria:**
- [ ] File compiles without TypeScript errors (`tsc --noEmit` passes)
- [ ] All interfaces referenced in Tasks 4–10 are defined here

**Verify:** From `doodoo/`: `npx tsc --noEmit` → no errors related to `fi.types.ts`

**Steps:**

- [ ] **Step 1: Create the types file**

Create `doodoo/src/fashion-index/fi.types.ts`:
```typescript
export interface FiScrapedItem {
  productCode: string;
  productName: string;
  qty: number;
  price: number;
}

export interface FiOrderRow {
  fiOrderId: string;
  rowIndex: number;
  items: FiScrapedItem[];
  pdfBuffer: Buffer;
}

export interface DoodooOrderItem {
  productCode: string;
  productName: string;
  qty: number;
  price: number;
}

export type FiItemStatus = 'matched' | 'qty_mismatch' | 'fi_only' | 'doodoo_only';
export type FiPairStatus = 'compared' | 'unlinked' | 'doodoo_not_found';

export interface FiItemComparison {
  productCode: string;
  productName: string;
  fiQty: number;
  doodooQty: number;
  status: FiItemStatus;
}

export interface FiOrderPairResult {
  fiOrderId: string;
  rowIndex: number;
  doodooOrderId: string | null;
  pairStatus: FiPairStatus;
  items: FiItemComparison[];
}

export interface FiComparisonResult {
  pairs: FiOrderPairResult[];
  totalPairs: number;
  mismatchCount: number;
}

export type FiJobStatus = 'running' | 'done' | 'error';

export interface FiJob {
  status: FiJobStatus;
  message: string;
  result?: FiComparisonResult;
  error?: string;
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd doodoo && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add doodoo/src/fashion-index/fi.types.ts
git commit -m "feat: add shared FI module types"
```

---

## Task 4: PDF parser — fi-pdf-parser.ts

**Goal:** A pure function that takes a PDF buffer and returns the doodoo520 order ID extracted from the `Content:#XXXXXX` pattern in the airway bill content block, or `null` if not found.

**Files:**
- Create: `doodoo/src/fashion-index/fi-pdf-parser.ts`
- Test: `doodoo/src/fashion-index/fi-pdf-parser.spec.ts`

**Acceptance Criteria:**
- [ ] Returns the numeric string after `Content:#` (e.g. `"000412"`) when present
- [ ] Returns `null` when pattern is absent
- [ ] Works even when there is whitespace between `Content:` and `#`
- [ ] Unit tests pass: `npm test -- --testPathPattern=fi-pdf-parser`

**Verify:** `cd doodoo && npm test -- --testPathPattern=fi-pdf-parser` → all tests PASS

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `doodoo/src/fashion-index/fi-pdf-parser.spec.ts`:
```typescript
import { extractOrderIdFromPdf } from './fi-pdf-parser';
import pdfParse from 'pdf-parse';

jest.mock('pdf-parse');
const mockPdfParse = pdfParse as jest.MockedFunction<typeof pdfParse>;

describe('extractOrderIdFromPdf', () => {
  it('extracts order ID from Content:#XXXXXX pattern', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: 'Shipping Info\nContent:#000412\nAddress: KL' } as any);
    const result = await extractOrderIdFromPdf(Buffer.from('fake-pdf'));
    expect(result).toBe('000412');
  });

  it('returns null when pattern is absent', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: 'Shipping Info\nNo order here' } as any);
    const result = await extractOrderIdFromPdf(Buffer.from('fake-pdf'));
    expect(result).toBeNull();
  });

  it('handles whitespace between Content: and #', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: 'Content: #000999' } as any);
    const result = await extractOrderIdFromPdf(Buffer.from('fake-pdf'));
    expect(result).toBe('000999');
  });

  it('extracts only digits after #', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: 'Content:#001234 extra text' } as any);
    const result = await extractOrderIdFromPdf(Buffer.from('fake-pdf'));
    expect(result).toBe('001234');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd doodoo && npm test -- --testPathPattern=fi-pdf-parser
```
Expected: FAIL — `Cannot find module './fi-pdf-parser'`

- [ ] **Step 3: Write the implementation**

Create `doodoo/src/fashion-index/fi-pdf-parser.ts`:
```typescript
import pdfParse from 'pdf-parse';

export async function extractOrderIdFromPdf(buffer: Buffer): Promise<string | null> {
  const { text } = await pdfParse(buffer);
  const match = text.match(/Content:\s*#(\d+)/i);
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd doodoo && npm test -- --testPathPattern=fi-pdf-parser
```
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add doodoo/src/fashion-index/fi-pdf-parser.ts doodoo/src/fashion-index/fi-pdf-parser.spec.ts
git commit -m "feat: add FI PDF parser to extract doodoo520 order ID"
```

---

## Task 5: Comparison logic — fi-comparison.service.ts

**Goal:** A pure service that takes an array of `FiScrapedItem[]` (from FI) and an array of `DoodooOrderItem[]` (from doodoo admin) and returns `FiItemComparison[]` with each item's status.

**Files:**
- Create: `doodoo/src/fashion-index/fi-comparison.service.ts`
- Test: `doodoo/src/fashion-index/fi-comparison.service.spec.ts`

**Acceptance Criteria:**
- [ ] Items with matching `productCode` and equal `qty` → status `matched`
- [ ] Items with matching `productCode` but different `qty` → status `qty_mismatch`
- [ ] Items in FI only (no matching code in doodoo) → status `fi_only`
- [ ] Items in doodoo only (no matching code in FI) → status `doodoo_only`
- [ ] All unit tests pass: `npm test -- --testPathPattern=fi-comparison`

**Verify:** `cd doodoo && npm test -- --testPathPattern=fi-comparison` → all tests PASS

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `doodoo/src/fashion-index/fi-comparison.service.spec.ts`:
```typescript
import { FiComparisonService } from './fi-comparison.service';
import { FiScrapedItem, DoodooOrderItem } from './fi.types';

describe('FiComparisonService.compare', () => {
  const svc = new FiComparisonService();

  const fi = (code: string, qty: number): FiScrapedItem =>
    ({ productCode: code, productName: `Name ${code}`, qty, price: 10 });

  const doodoo = (code: string, qty: number): DoodooOrderItem =>
    ({ productCode: code, productName: `Name ${code}`, qty, price: 10 });

  it('marks identical code+qty as matched', () => {
    const result = svc.compare([fi('RM-001', 100)], [doodoo('RM-001', 100)]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('matched');
    expect(result[0].fiQty).toBe(100);
    expect(result[0].doodooQty).toBe(100);
  });

  it('marks same code different qty as qty_mismatch', () => {
    const result = svc.compare([fi('RM-001', 100)], [doodoo('RM-001', 80)]);
    expect(result[0].status).toBe('qty_mismatch');
    expect(result[0].fiQty).toBe(100);
    expect(result[0].doodooQty).toBe(80);
  });

  it('marks FI-only items as fi_only with doodooQty 0', () => {
    const result = svc.compare([fi('RM-002', 50)], []);
    expect(result[0].status).toBe('fi_only');
    expect(result[0].doodooQty).toBe(0);
  });

  it('marks doodoo-only items as doodoo_only with fiQty 0', () => {
    const result = svc.compare([], [doodoo('FG-003', 20)]);
    expect(result[0].status).toBe('doodoo_only');
    expect(result[0].fiQty).toBe(0);
  });

  it('handles mixed results correctly', () => {
    const result = svc.compare(
      [fi('RM-001', 100), fi('RM-002', 50)],
      [doodoo('RM-001', 100), doodoo('FG-003', 20)],
    );
    const byCode = Object.fromEntries(result.map(r => [r.productCode, r]));
    expect(byCode['RM-001'].status).toBe('matched');
    expect(byCode['RM-002'].status).toBe('fi_only');
    expect(byCode['FG-003'].status).toBe('doodoo_only');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd doodoo && npm test -- --testPathPattern=fi-comparison
```
Expected: FAIL — `Cannot find module './fi-comparison.service'`

- [ ] **Step 3: Write the implementation**

Create `doodoo/src/fashion-index/fi-comparison.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { DoodooOrderItem, FiItemComparison, FiScrapedItem } from './fi.types';

@Injectable()
export class FiComparisonService {
  compare(fiItems: FiScrapedItem[], doodooItems: DoodooOrderItem[]): FiItemComparison[] {
    const results: FiItemComparison[] = [];
    const doodooMap = new Map(doodooItems.map(i => [i.productCode, i]));
    const usedCodes = new Set<string>();

    for (const fi of fiItems) {
      const doodoo = doodooMap.get(fi.productCode);
      usedCodes.add(fi.productCode);
      if (!doodoo) {
        results.push({
          productCode: fi.productCode,
          productName: fi.productName,
          fiQty: fi.qty,
          doodooQty: 0,
          status: 'fi_only',
        });
      } else {
        results.push({
          productCode: fi.productCode,
          productName: fi.productName,
          fiQty: fi.qty,
          doodooQty: doodoo.qty,
          status: fi.qty === doodoo.qty ? 'matched' : 'qty_mismatch',
        });
      }
    }

    for (const d of doodooItems) {
      if (!usedCodes.has(d.productCode)) {
        results.push({
          productCode: d.productCode,
          productName: d.productName,
          fiQty: 0,
          doodooQty: d.qty,
          status: 'doodoo_only',
        });
      }
    }

    return results;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd doodoo && npm test -- --testPathPattern=fi-comparison
```
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add doodoo/src/fashion-index/fi-comparison.service.ts doodoo/src/fashion-index/fi-comparison.service.spec.ts
git commit -m "feat: add FI comparison logic service"
```

---

## Task 6: Playwright scraper — Fashion Index session

**Goal:** `FashionIndexScraper.scrapeOrderRows(fiOrderId)` logs into Fashion Index, searches for the given order ID, iterates over all result rows, scrapes item details, and downloads each row's PDF buffer — all within a single authenticated browser context.

**Files:**
- Create: `doodoo/src/fashion-index/fashion-index.scraper.ts`
- Test: `doodoo/src/fashion-index/fashion-index.scraper.spec.ts` (FI session only)

**Acceptance Criteria:**
- [ ] Returns an array of `FiOrderRow` — one entry per result row
- [ ] Each row contains `items[]` with `productCode`, `productName`, `qty`, `price`
- [ ] Each row contains a non-empty `pdfBuffer`
- [ ] If login fails, throws an error with message `"Fashion Index login failed"`
- [ ] Unit tests (mocked Playwright) pass: `npm test -- --testPathPattern=fashion-index.scraper`

**Verify:** `cd doodoo && npm test -- --testPathPattern=fashion-index.scraper` → all tests PASS

**Steps:**

- [ ] **Step 1: Write the failing tests (FI session)**

Create `doodoo/src/fashion-index/fashion-index.scraper.spec.ts`:
```typescript
import { FashionIndexScraper } from './fashion-index.scraper';

jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import { chromium } from 'playwright';

describe('FashionIndexScraper.scrapeOrderRows', () => {
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
      locator: jest.fn(),
      $: jest.fn(),
      $$: jest.fn(),
      $eval: jest.fn(),
      $$eval: jest.fn(),
      waitForSelector: jest.fn(),
      content: jest.fn(),
    };
    mockContext = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn(),
    };
    mockBrowser = {
      newContext: jest.fn().mockResolvedValue(mockContext),
      close: jest.fn(),
    };
    (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
    scraper = new FashionIndexScraper();
  });

  it('throws when login fails (Log Out button not found)', async () => {
    mockPage.waitForSelector.mockRejectedValueOnce(new Error('timeout'));
    await expect(scraper.scrapeOrderRows('FI-123')).rejects.toThrow('Fashion Index login failed');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd doodoo && npm test -- --testPathPattern=fashion-index.scraper
```
Expected: FAIL — `Cannot find module './fashion-index.scraper'`

- [ ] **Step 3: Write the scraper skeleton with FI session**

Create `doodoo/src/fashion-index/fashion-index.scraper.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { chromium, BrowserContext, Page } from 'playwright';
import { DoodooOrderItem, FiOrderRow, FiScrapedItem } from './fi.types';

// ── Selectors — update here if site markup changes ───────────────────────────
const FI_URL        = 'https://b2b.fashionindex.com.my';
const DOODOO_URL    = 'https://www.doodoo520.com/admin';
const FI_ORDERS_NAV = 'nav a:nth-child(2)';
const FI_ORDER_ROW  = '.border.rounded.order-row';
const DOODOO_NAV_ORDERS = '#sidebar ul li:nth-child(8) a';
const DOODOO_ORDER_INPUT = '#main-content input[name="order_id"]';
const DOODOO_ORDER_SUBMIT = '#main-content form button[type="submit"]';
const DOODOO_DETAIL_LINK = '#main-content > div:nth-child(3) > div:nth-child(2) > div:nth-child(8) a';
const DOODOO_ITEM_ROWS   = 'tr[id^="row-"]';

@Injectable()
export class FashionIndexScraper {
  private readonly logger = new Logger(FashionIndexScraper.name);

  async scrapeOrderRows(fiOrderId: string): Promise<FiOrderRow[]> {
    const browser = await chromium.launch({ headless: process.env['PLAYWRIGHT_HEADFUL'] !== 'true' });
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await this.loginFashionIndex(page);
      return await this.fetchOrderRows(page, ctx, fiOrderId);
    } finally {
      await ctx.close();
      await browser.close();
    }
  }

  private async loginFashionIndex(page: Page): Promise<void> {
    await page.goto(`${FI_URL}/login`);
    await page.waitForLoadState('networkidle');
    await page.fill('input[name="email"]', process.env['FI_EMAIL'] ?? '');
    await page.fill('input[name="password"]', process.env['FI_PASSWORD'] ?? '');
    await page.click('button[type="submit"]');
    try {
      await page.waitForSelector('button:has-text("Log Out")', { timeout: 10_000 });
    } catch {
      throw new Error('Fashion Index login failed');
    }
  }

  private async fetchOrderRows(
    page: Page,
    ctx: BrowserContext,
    fiOrderId: string,
  ): Promise<FiOrderRow[]> {
    const ordersHref = await page.$eval(FI_ORDERS_NAV, (el: HTMLAnchorElement) => el.href);
    await page.goto(ordersHref);
    await page.waitForLoadState('networkidle');

    // Submit search form with the FI order ID
    await page.fill('input[name="order_id"]', fiOrderId);
    await page.click('form button[type="submit"]');
    await page.waitForLoadState('networkidle');

    const rowLinks = await page.$$eval(
      `${FI_ORDER_ROW} a[href]`,
      (anchors: HTMLAnchorElement[]) => [...new Set(anchors.map(a => a.href))],
    );

    const rows: FiOrderRow[] = [];
    for (let i = 0; i < rowLinks.length; i++) {
      await page.goto(rowLinks[i]);
      await page.waitForLoadState('networkidle');

      const items = await this.scrapeItemsFromPage(page);
      const pdfUrl = await page.$eval(
        'div a[href$=".pdf"], div a[href*="/pdf"]',
        (a: HTMLAnchorElement) => a.href,
      ).catch(() => null);

      let pdfBuffer = Buffer.alloc(0);
      if (pdfUrl) {
        const pdfPage = await ctx.newPage();
        const response = await pdfPage.goto(pdfUrl);
        if (response) pdfBuffer = Buffer.from(await response.body());
        await pdfPage.close();
      } else {
        this.logger.warn(`No PDF found for FI order ${fiOrderId} row ${i}`);
      }

      rows.push({ fiOrderId, rowIndex: i, items, pdfBuffer });
    }

    return rows;
  }

  private async scrapeItemsFromPage(page: Page): Promise<FiScrapedItem[]> {
    return page.$$eval(
      'div.divide-y > div.flex',
      (rows: Element[]) =>
        rows.map(row => {
          const texts = Array.from(row.querySelectorAll('*'))
            .map(el => el.textContent?.trim())
            .filter((t): t is string => !!t && t.length > 0)
            .map(t => t.replace(/\s+/g, ' '));
          return {
            productCode: texts[1] ?? '',
            productName: texts[0] ?? '',
            qty:   parseFloat(texts[5] ?? '0') || 0,
            price: parseFloat(texts[3] ?? '0') || 0,
          };
        }).filter(item => item.productCode.length > 0),
    );
  }

  async scrapeDoodooOrder(doodooOrderId: string): Promise<DoodooOrderItem[]> {
    // Implemented in Task 7
    throw new Error('Not yet implemented');
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd doodoo && npm test -- --testPathPattern=fashion-index.scraper
```
Expected: 1 test PASS

- [ ] **Step 5: Commit**

```bash
git add doodoo/src/fashion-index/fashion-index.scraper.ts doodoo/src/fashion-index/fashion-index.scraper.spec.ts
git commit -m "feat: add Playwright scraper for Fashion Index session"
```

---

## Task 7: Playwright scraper — Doodoo520 admin session

**Goal:** `FashionIndexScraper.scrapeDoodooOrder(doodooOrderId)` opens a separate browser context, logs into `doodoo520.com/admin`, navigates to the orders section, searches by order ID, follows the detail link, and returns scraped product rows as `DoodooOrderItem[]`.

**Files:**
- Modify: `doodoo/src/fashion-index/fashion-index.scraper.ts` (replace `scrapeDoodooOrder` stub)
- Modify: `doodoo/src/fashion-index/fashion-index.scraper.spec.ts` (add doodoo tests)

**Acceptance Criteria:**
- [ ] `scrapeDoodooOrder` returns `DoodooOrderItem[]` with `productCode`, `productName`, `qty`, `price`
- [ ] Returns empty array (not throws) when order ID is not found on the page
- [ ] If login fails, throws `"Doodoo520 login failed"`
- [ ] Tests pass: `npm test -- --testPathPattern=fashion-index.scraper`

**Verify:** `cd doodoo && npm test -- --testPathPattern=fashion-index.scraper` → all tests PASS

**Steps:**

- [ ] **Step 1: Add doodoo tests to the spec file**

Append to `doodoo/src/fashion-index/fashion-index.scraper.spec.ts`:
```typescript
describe('FashionIndexScraper.scrapeDoodooOrder', () => {
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
      waitForSelector: jest.fn(),
      $eval: jest.fn(),
      $$eval: jest.fn(),
      $: jest.fn(),
    };
    mockContext = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn(),
    };
    mockBrowser = {
      newContext: jest.fn().mockResolvedValue(mockContext),
      close: jest.fn(),
    };
    (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
    scraper = new FashionIndexScraper();
  });

  it('throws when doodoo login fails', async () => {
    mockPage.waitForSelector.mockRejectedValueOnce(new Error('timeout'));
    await expect(scraper.scrapeDoodooOrder('000412')).rejects.toThrow('Doodoo520 login failed');
  });

  it('returns empty array when detail link not found', async () => {
    mockPage.waitForSelector.mockResolvedValue(undefined);
    mockPage.$eval
      .mockResolvedValueOnce('https://doodoo520.com/admin/orders') // nav link
      .mockResolvedValueOnce(null);                                // detail link — not found
    mockPage.$.mockResolvedValueOnce(null); // detail link anchor
    mockPage.$$eval.mockResolvedValueOnce([]); // no rows
    const result = await scraper.scrapeDoodooOrder('000412');
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
cd doodoo && npm test -- --testPathPattern=fashion-index.scraper
```
Expected: new doodoo tests FAIL (stub throws "Not yet implemented")

- [ ] **Step 3: Replace scrapeDoodooOrder stub with implementation**

In `doodoo/src/fashion-index/fashion-index.scraper.ts`, replace the `scrapeDoodooOrder` method:
```typescript
async scrapeDoodooOrder(doodooOrderId: string): Promise<DoodooOrderItem[]> {
  const browser = await chromium.launch({ headless: process.env['PLAYWRIGHT_HEADFUL'] !== 'true' });
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await this.loginDoodoo(page);

    // Navigate to orders section via sidebar
    const ordersHref = await page.$eval(DOODOO_NAV_ORDERS, (el: HTMLAnchorElement) => el.href);
    await page.goto(ordersHref);
    await page.waitForLoadState('networkidle');

    // Search for the order
    await page.fill(DOODOO_ORDER_INPUT, doodooOrderId);
    await page.click(DOODOO_ORDER_SUBMIT);
    await page.waitForLoadState('networkidle');

    // Follow the detail link
    const detailAnchor = await page.$(DOODOO_DETAIL_LINK);
    if (!detailAnchor) {
      this.logger.warn(`Doodoo order ${doodooOrderId} not found — no detail link`);
      return [];
    }
    const detailHref = await detailAnchor.getAttribute('href');
    if (!detailHref) return [];

    await page.goto(detailHref.startsWith('http') ? detailHref : `${DOODOO_URL}${detailHref}`);
    await page.waitForLoadState('networkidle');

    return await this.scrapeDoodooItemRows(page);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

private async loginDoodoo(page: Page): Promise<void> {
  await page.goto(`${DOODOO_URL}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[name="username"], input[name="email"]', process.env['DOODOO_ADMIN_EMAIL'] ?? '');
  await page.fill('input[name="password"]', process.env['DOODOO_ADMIN_PASSWORD'] ?? '');
  await page.click('button[type="submit"]');
  try {
    await page.waitForSelector('.nav-text', { timeout: 10_000 });
  } catch {
    throw new Error('Doodoo520 login failed');
  }
}

private async scrapeDoodooItemRows(page: Page): Promise<DoodooOrderItem[]> {
  return page.$$eval(DOODOO_ITEM_ROWS, (rows: Element[]) =>
    rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td'))
        .map(td => td.textContent?.trim().replace(/\s+/g, ' ') ?? '');
      return {
        productCode: cells[1] ?? '',
        productName: cells[0] ?? '',
        qty:   parseFloat(cells[3] ?? '0') || 0,
        price: parseFloat(cells[2] ?? '0') || 0,
      };
    }).filter(item => item.productCode.length > 0),
  );
}
```

- [ ] **Step 4: Run all scraper tests**

```bash
cd doodoo && npm test -- --testPathPattern=fashion-index.scraper
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add doodoo/src/fashion-index/fashion-index.scraper.ts doodoo/src/fashion-index/fashion-index.scraper.spec.ts
git commit -m "feat: add doodoo520 admin session to Playwright scraper"
```

---

## Task 8: FashionIndexService — orchestration + job tracking

**Goal:** `FashionIndexService` runs the full pipeline (scrape FI → parse PDFs → scrape doodoo → compare) as a background job, tracked by an in-memory Map. `startJob(fiOrderIds)` returns a `jobId` immediately; `getJob(jobId)` returns current status and result when done.

**Files:**
- Create: `doodoo/src/fashion-index/fashion-index.service.ts`
- Test: `doodoo/src/fashion-index/fashion-index.service.spec.ts`

**Acceptance Criteria:**
- [ ] `startJob` returns a UUID string immediately without waiting for scraping to complete
- [ ] Job progresses through status messages as each stage completes
- [ ] When scraping succeeds, `getJob` returns `status: 'done'` and a `FiComparisonResult`
- [ ] When scraping throws, `getJob` returns `status: 'error'` and the error message
- [ ] FI rows with no PDF content result in `pairStatus: 'unlinked'` (not a thrown error)
- [ ] Unit tests pass: `npm test -- --testPathPattern=fashion-index.service`

**Verify:** `cd doodoo && npm test -- --testPathPattern=fashion-index.service` → all tests PASS

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `doodoo/src/fashion-index/fashion-index.service.spec.ts`:
```typescript
import { FashionIndexService } from './fashion-index.service';
import { FashionIndexScraper } from './fashion-index.scraper';
import { FiComparisonService } from './fi-comparison.service';
import { extractOrderIdFromPdf } from './fi-pdf-parser';
import { DatabaseService } from '../invoice/database.service';

jest.mock('./fashion-index.scraper');
jest.mock('./fi-pdf-parser');
jest.mock('../invoice/database.service');

const mockExtract = extractOrderIdFromPdf as jest.MockedFunction<typeof extractOrderIdFromPdf>;

describe('FashionIndexService', () => {
  let service: FashionIndexService;
  let scraper: jest.Mocked<FashionIndexScraper>;
  let db: jest.Mocked<DatabaseService>;

  beforeEach(() => {
    scraper = new FashionIndexScraper() as jest.Mocked<FashionIndexScraper>;
    db = new DatabaseService() as jest.Mocked<DatabaseService>;
    service = new FashionIndexService(scraper, new FiComparisonService(), db);
  });

  it('startJob returns a UUID string immediately', () => {
    scraper.scrapeOrderRows = jest.fn().mockResolvedValue([]);
    const jobId = service.startJob(['FI-123']);
    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);
  });

  it('job reaches done status after successful pipeline', async () => {
    const pdfBuffer = Buffer.from('fake');
    scraper.scrapeOrderRows = jest.fn().mockResolvedValue([
      { fiOrderId: 'FI-123', rowIndex: 0, items: [{ productCode: 'RM-001', productName: 'Item', qty: 10, price: 5 }], pdfBuffer },
    ]);
    mockExtract.mockResolvedValue('000412');
    scraper.scrapeDoodooOrder = jest.fn().mockResolvedValue([
      { productCode: 'RM-001', productName: 'Item', qty: 10, price: 5 },
    ]);
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1 }] });
    db.connect = jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
      release: jest.fn(),
    });

    const jobId = service.startJob(['FI-123']);
    // Wait for the async pipeline to complete
    await new Promise(r => setTimeout(r, 50));
    const job = service.getJob(jobId);
    expect(job?.status).toBe('done');
    expect(job?.result?.pairs).toHaveLength(1);
    expect(job?.result?.pairs[0].pairStatus).toBe('compared');
  });

  it('job reaches error status when scraper throws', async () => {
    scraper.scrapeOrderRows = jest.fn().mockRejectedValue(new Error('Fashion Index login failed'));

    const jobId = service.startJob(['FI-123']);
    await new Promise(r => setTimeout(r, 50));
    const job = service.getJob(jobId);
    expect(job?.status).toBe('error');
    expect(job?.error).toContain('Fashion Index login failed');
  });

  it('marks row as unlinked when PDF buffer is empty', async () => {
    scraper.scrapeOrderRows = jest.fn().mockResolvedValue([
      { fiOrderId: 'FI-123', rowIndex: 0, items: [], pdfBuffer: Buffer.alloc(0) },
    ]);
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1 }] });
    db.connect = jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
      release: jest.fn(),
    });

    const jobId = service.startJob(['FI-123']);
    await new Promise(r => setTimeout(r, 50));
    const job = service.getJob(jobId);
    expect(job?.status).toBe('done');
    expect(job?.result?.pairs[0].pairStatus).toBe('unlinked');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd doodoo && npm test -- --testPathPattern=fashion-index.service
```
Expected: FAIL — `Cannot find module './fashion-index.service'`

- [ ] **Step 3: Write the implementation**

Create `doodoo/src/fashion-index/fashion-index.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { extractOrderIdFromPdf } from './fi-pdf-parser';
import { FashionIndexScraper } from './fashion-index.scraper';
import { FiComparisonService } from './fi-comparison.service';
import { DatabaseService } from '../invoice/database.service';
import {
  FiComparisonResult,
  FiJob,
  FiOrderPairResult,
} from './fi.types';

@Injectable()
export class FashionIndexService {
  private readonly logger = new Logger(FashionIndexService.name);
  private readonly jobs = new Map<string, FiJob>();

  constructor(
    private readonly scraper: FashionIndexScraper,
    private readonly comparison: FiComparisonService,
    private readonly db: DatabaseService,
  ) {}

  startJob(fiOrderIds: string[]): string {
    const jobId = randomUUID();
    const job: FiJob = { status: 'running', message: 'Starting…' };
    this.jobs.set(jobId, job);
    this.runPipeline(jobId, fiOrderIds).catch(() => {});
    return jobId;
  }

  getJob(jobId: string): FiJob | undefined {
    return this.jobs.get(jobId);
  }

  private update(jobId: string, patch: Partial<FiJob>): void {
    const job = this.jobs.get(jobId);
    if (job) Object.assign(job, patch);
  }

  private async runPipeline(jobId: string, fiOrderIds: string[]): Promise<void> {
    try {
      const pairs: FiOrderPairResult[] = [];

      for (const fiOrderId of fiOrderIds) {
        this.update(jobId, { message: `Scraping FI order ${fiOrderId}…` });
        const rows = await this.scraper.scrapeOrderRows(fiOrderId);

        for (const row of rows) {
          if (!row.pdfBuffer || row.pdfBuffer.length === 0) {
            this.logger.warn(`Empty PDF for FI ${fiOrderId} row ${row.rowIndex}`);
            pairs.push({
              fiOrderId,
              rowIndex: row.rowIndex,
              doodooOrderId: null,
              pairStatus: 'unlinked',
              items: [],
            });
            continue;
          }

          this.update(jobId, { message: `Parsing PDF for FI ${fiOrderId} row ${row.rowIndex}…` });
          const doodooOrderId = await extractOrderIdFromPdf(row.pdfBuffer);

          if (!doodooOrderId) {
            this.logger.warn(`No order ID in PDF for FI ${fiOrderId} row ${row.rowIndex}`);
            pairs.push({
              fiOrderId,
              rowIndex: row.rowIndex,
              doodooOrderId: null,
              pairStatus: 'unlinked',
              items: [],
            });
            continue;
          }

          this.update(jobId, { message: `Scraping doodoo520 order #${doodooOrderId}…` });
          const doodooItems = await this.scraper.scrapeDoodooOrder(doodooOrderId);

          if (!doodooItems.length) {
            pairs.push({
              fiOrderId,
              rowIndex: row.rowIndex,
              doodooOrderId,
              pairStatus: 'doodoo_not_found',
              items: [],
            });
            continue;
          }

          const items = this.comparison.compare(row.items, doodooItems);
          pairs.push({
            fiOrderId,
            rowIndex: row.rowIndex,
            doodooOrderId,
            pairStatus: 'compared',
            items,
          });
        }
      }

      const mismatchCount = pairs.filter(
        p => p.items.some(i => i.status !== 'matched'),
      ).length;

      const result: FiComparisonResult = {
        pairs,
        totalPairs: pairs.length,
        mismatchCount,
      };

      this.update(jobId, { message: 'Saving results…' });
      await this.persistResult(result);
      this.update(jobId, { status: 'done', message: 'Done', result });
    } catch (err: any) {
      this.logger.error(`FI job ${jobId} failed: ${err.message}`);
      this.update(jobId, { status: 'error', message: err.message, error: err.message });
    }
  }

  private async persistResult(result: FiComparisonResult): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: [{ id: sessionId }] } = await client.query(
        `INSERT INTO fi_sessions (total_pairs, mismatch_count) VALUES ($1, $2) RETURNING id`,
        [result.totalPairs, result.mismatchCount],
      );
      for (const pair of result.pairs) {
        const { rows: [{ id: pairId }] } = await client.query(
          `INSERT INTO fi_order_pairs (session_id, fi_order_id, fi_row_index, doodoo_order_id, status)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [sessionId, pair.fiOrderId, pair.rowIndex, pair.doodooOrderId, pair.pairStatus],
        );
        for (const item of pair.items) {
          await client.query(
            `INSERT INTO fi_item_comparisons (pair_id, product_code, product_name, fi_qty, doodoo_qty, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [pairId, item.productCode, item.productName, item.fiQty, item.doodooQty, item.status],
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      (client as any).release();
    }
  }

  async getHistory(): Promise<any[]> {
    const { rows } = await this.db.query(
      `SELECT id, created_at, total_pairs, mismatch_count
       FROM fi_sessions ORDER BY created_at DESC LIMIT 20`,
    );
    return rows;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd doodoo && npm test -- --testPathPattern=fashion-index.service
```
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add doodoo/src/fashion-index/fashion-index.service.ts doodoo/src/fashion-index/fashion-index.service.spec.ts
git commit -m "feat: add FashionIndexService with job tracking and DB persistence"
```

---

## Task 9: Controller + Module — wire up HTTP endpoints

**Goal:** `FashionIndexController` exposes three endpoints under `/api/fashion-index`. `FashionIndexModule` bundles all providers. AppModule imports it.

**Files:**
- Create: `doodoo/src/fashion-index/fashion-index.controller.ts`
- Create: `doodoo/src/fashion-index/fashion-index.module.ts`
- Modify: `doodoo/src/app.module.ts`

**Acceptance Criteria:**
- [ ] `POST /api/fashion-index/compare` with body `{ "orderIds": ["FI-123"] }` returns `{ "jobId": "<uuid>" }` (HTTP 201)
- [ ] `GET /api/fashion-index/jobs/:jobId` for a valid jobId returns `{ "status": "running"|"done"|"error", "message": "..." }`
- [ ] `GET /api/fashion-index/jobs/nonexistent` returns HTTP 404
- [ ] `GET /api/fashion-index/history` returns an array
- [ ] All endpoints return HTTP 401 when called without a JWT cookie
- [ ] NestJS controller tests pass: `npm test -- --testPathPattern=fashion-index.controller`

**Verify:** `cd doodoo && npm test -- --testPathPattern=fashion-index.controller` → all tests PASS

**Steps:**

- [ ] **Step 1: Write the controller tests**

Create `doodoo/src/fashion-index/fashion-index.controller.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { FashionIndexController } from './fashion-index.controller';
import { FashionIndexService } from './fashion-index.service';
import { NotFoundException } from '@nestjs/common';

const mockService = {
  startJob: jest.fn().mockReturnValue('test-job-id'),
  getJob:   jest.fn(),
  getHistory: jest.fn().mockResolvedValue([]),
};

describe('FashionIndexController', () => {
  let controller: FashionIndexController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FashionIndexController],
      providers: [{ provide: FashionIndexService, useValue: mockService }],
    }).compile();
    controller = module.get(FashionIndexController);
  });

  it('POST /compare returns jobId', () => {
    const result = controller.startComparison({ orderIds: ['FI-123'] });
    expect(result).toEqual({ jobId: 'test-job-id' });
    expect(mockService.startJob).toHaveBeenCalledWith(['FI-123']);
  });

  it('GET /jobs/:id returns job when found', () => {
    const fakeJob = { status: 'running', message: 'Scraping…' };
    mockService.getJob.mockReturnValueOnce(fakeJob);
    const result = controller.getJob('test-job-id');
    expect(result).toEqual(fakeJob);
  });

  it('GET /jobs/:id throws 404 when not found', () => {
    mockService.getJob.mockReturnValueOnce(undefined);
    expect(() => controller.getJob('bad-id')).toThrow(NotFoundException);
  });

  it('GET /history returns array', async () => {
    const result = await controller.getHistory();
    expect(Array.isArray(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd doodoo && npm test -- --testPathPattern=fashion-index.controller
```
Expected: FAIL — `Cannot find module './fashion-index.controller'`

- [ ] **Step 3: Create the controller**

Create `doodoo/src/fashion-index/fashion-index.controller.ts`:
```typescript
import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { FashionIndexService } from './fashion-index.service';

@Controller('fashion-index')
export class FashionIndexController {
  constructor(private readonly svc: FashionIndexService) {}

  @Post('compare')
  startComparison(@Body() body: { orderIds: string[] }): { jobId: string } {
    const jobId = this.svc.startJob(body.orderIds);
    return { jobId };
  }

  @Get('jobs/:jobId')
  getJob(@Param('jobId') jobId: string) {
    const job = this.svc.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    return job;
  }

  @Get('history')
  async getHistory() {
    return this.svc.getHistory();
  }
}
```

- [ ] **Step 4: Create the module**

Create `doodoo/src/fashion-index/fashion-index.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { FashionIndexController } from './fashion-index.controller';
import { FashionIndexService } from './fashion-index.service';
import { FashionIndexScraper } from './fashion-index.scraper';
import { FiComparisonService } from './fi-comparison.service';

@Module({
  controllers: [FashionIndexController],
  providers: [FashionIndexService, FashionIndexScraper, FiComparisonService],
})
export class FashionIndexModule {}
```

- [ ] **Step 5: Import into AppModule**

Edit `doodoo/src/app.module.ts` — add `FashionIndexModule` to imports:
```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InvoiceModule } from './invoice/invoice.module';
import { FsModule } from './fs/fs.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { UsersModule } from './users/users.module';
import { FashionIndexModule } from './fashion-index/fashion-index.module';

@Module({
  imports: [DatabaseModule, AuthModule, UsersModule, InvoiceModule, FsModule, FashionIndexModule],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Run controller tests**

```bash
cd doodoo && npm test -- --testPathPattern=fashion-index.controller
```
Expected: all 4 tests PASS

- [ ] **Step 7: Smoke-test the running server**

```bash
cd doodoo && npm run start:dev
```
In a separate terminal (with a valid JWT cookie):
```bash
curl -X POST http://localhost:3000/api/fashion-index/compare \
  -H "Content-Type: application/json" \
  -b "access_token=<your_token>" \
  -d '{"orderIds":["TEST-001"]}'
```
Expected: `{"jobId":"<uuid>"}` (HTTP 201)

- [ ] **Step 8: Commit**

```bash
git add doodoo/src/fashion-index/fashion-index.controller.ts \
        doodoo/src/fashion-index/fashion-index.controller.spec.ts \
        doodoo/src/fashion-index/fashion-index.module.ts \
        doodoo/src/app.module.ts
git commit -m "feat: add FashionIndexController, Module and wire into AppModule"
```

---

## Task 10: Angular FI service

**Goal:** `FiService` in Angular encapsulates the two HTTP calls (`startComparison` and `pollJob`) so the component only subscribes to observables without handling HTTP directly.

**Files:**
- Create: `doodoo-fam/src/app/pages/invoice/comparison/fi.service.ts`

**Acceptance Criteria:**
- [ ] `startComparison(orderIds)` returns `Observable<{ jobId: string }>`
- [ ] `pollJob(jobId)` returns `Observable<FiJob>` that emits every 3 seconds until status is `done` or `error`
- [ ] Uses `withCredentials: true` on all requests (consistent with the rest of the app)
- [ ] TypeScript compiles without errors

**Verify:** `cd doodoo-fam && npx tsc --noEmit` → no errors

**Steps:**

- [ ] **Step 1: Create the service**

Create `doodoo-fam/src/app/pages/invoice/comparison/fi.service.ts`:
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer, switchMap, takeWhile, shareReplay } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface FiItemComparison {
  productCode: string;
  productName: string;
  fiQty: number;
  doodooQty: number;
  status: 'matched' | 'qty_mismatch' | 'fi_only' | 'doodoo_only';
}

export interface FiOrderPairResult {
  fiOrderId: string;
  rowIndex: number;
  doodooOrderId: string | null;
  pairStatus: 'compared' | 'unlinked' | 'doodoo_not_found';
  items: FiItemComparison[];
}

export interface FiComparisonResult {
  pairs: FiOrderPairResult[];
  totalPairs: number;
  mismatchCount: number;
}

export interface FiJob {
  status: 'running' | 'done' | 'error';
  message: string;
  result?: FiComparisonResult;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class FiService {
  private http = inject(HttpClient);
  private base = `${environment.apiBase}/api/fashion-index`;

  startComparison(orderIds: string[]): Observable<{ jobId: string }> {
    return this.http.post<{ jobId: string }>(
      `${this.base}/compare`,
      { orderIds },
      { withCredentials: true },
    );
  }

  pollJob(jobId: string): Observable<FiJob> {
    return timer(0, 3_000).pipe(
      switchMap(() =>
        this.http.get<FiJob>(`${this.base}/jobs/${jobId}`, { withCredentials: true }),
      ),
      takeWhile(job => job.status === 'running', true),
      shareReplay(1),
    );
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd doodoo-fam && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add doodoo-fam/src/app/pages/invoice/comparison/fi.service.ts
git commit -m "feat: add Angular FiService with startComparison and pollJob"
```

---

## Task 11: Frontend — mode switcher + FI input view

**Goal:** The comparison page gains a mode tab bar (PDF Upload | Fashion Index). When Fashion Index is active, users see a textarea to enter FI order IDs and a Compare button that starts the job and shows a live progress message.

**Files:**
- Modify: `doodoo-fam/src/app/pages/invoice/comparison/comparison.ts`
- Modify: `doodoo-fam/src/app/pages/invoice/comparison/comparison.html`
- Modify: `doodoo-fam/src/app/pages/invoice/comparison/comparison.scss`

**Acceptance Criteria:**
- [ ] Two tabs render at the top: "PDF Upload" and "Fashion Index"
- [ ] Clicking a tab switches the view without losing state in the other mode
- [ ] "Fashion Index" view has a textarea + "Start Comparison" button
- [ ] Button is disabled when textarea is empty or a job is running
- [ ] While running, a spinner + current `job.message` is shown
- [ ] On error, an error banner with `job.error` is shown

**Verify:** Run `cd doodoo-fam && npx tsc --noEmit` → no errors, then manually verify tab switching in the browser.

**Steps:**

- [ ] **Step 1: Add FI signals and logic to the component**

Open `doodoo-fam/src/app/pages/invoice/comparison/comparison.ts`.

Add these imports at the top:
```typescript
import { FiService, FiJob } from './fi.service';
import { Subscription } from 'rxjs';
```

Add `FiService` to the inject block and add new signals after the existing ones:
```typescript
// ── Mode ──────────────────────────────────────────────────────────────────────
activeMode = signal<'pdf' | 'fi'>('pdf');

// ── FI state ──────────────────────────────────────────────────────────────────
fiOrderIdsInput = signal('');
fiJob           = signal<FiJob | null>(null);
fiJobRunning    = computed(() => this.fiJob()?.status === 'running');
fiResult        = computed(() => this.fiJob()?.status === 'done' ? this.fiJob()!.result : null);

private fiSub: Subscription | null = null;
private fiSvc = inject(FiService);
```

Add the `startFiComparison` method before the existing `openPicker` method:
```typescript
startFiComparison(): void {
  const raw = this.fiOrderIdsInput();
  const orderIds = raw
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (orderIds.length === 0) return;

  this.fiJob.set({ status: 'running', message: 'Starting…' });
  this.fiSub?.unsubscribe();

  this.fiSvc.startComparison(orderIds).subscribe({
    next: ({ jobId }) => {
      this.fiSub = this.fiSvc.pollJob(jobId).subscribe({
        next:  job   => this.fiJob.set(job),
        error: ()    => this.fiJob.set({ status: 'error', message: 'Connection error', error: 'Failed to poll job status' }),
      });
    },
    error: () => {
      this.fiJob.set({ status: 'error', message: 'Failed to start', error: 'Could not reach server' });
    },
  });
}
```

Also add `FiService` to the imports array of `@Component`:
```typescript
imports: [CommonModule, DecimalPipe, FiService],
```
Wait — `FiService` is `providedIn: 'root'` so it doesn't need to be listed in `imports`. Just inject it. No change to `imports` array needed.

- [ ] **Step 2: Add mode switcher and FI input view to the template**

Open `doodoo-fam/src/app/pages/invoice/comparison/comparison.html`.

Wrap the entire existing content in `@if (activeMode() === 'pdf') { ... }` and add the mode tabs at the very top:

Replace the opening `<div class="comparison-container">` line with:
```html
<div class="comparison-container">

  <!-- ── MODE TABS ─────────────────────────────────────────────────── -->
  <div class="mode-tabs">
    <button class="mode-tab" [class.mode-tab--active]="activeMode() === 'pdf'"
      (click)="activeMode.set('pdf')">
      <span class="material-symbols-outlined">upload_file</span> PDF Upload
    </button>
    <button class="mode-tab" [class.mode-tab--active]="activeMode() === 'fi'"
      (click)="activeMode.set('fi')">
      <span class="material-symbols-outlined">travel_explore</span> Fashion Index
    </button>
  </div>

  <!-- ── PDF MODE ───────────────────────────────────────────────────── -->
  @if (activeMode() === 'pdf') {
```

And close the PDF mode block just before the file picker modal:
```html
  } <!-- /pdf mode -->

  <!-- ── FASHION INDEX MODE ─────────────────────────────────────────── -->
  @if (activeMode() === 'fi') {
  <div class="fi-view">
    <h2 class="page-title">Fashion Index Comparison</h2>

    @if (!fiResult()) {
    <div class="fi-input-section">
      <label class="fi-label" for="fi-order-ids">
        FI Order IDs <span class="fi-label__hint">(one per line or comma-separated)</span>
      </label>
      <textarea
        id="fi-order-ids"
        class="fi-textarea"
        rows="5"
        placeholder="FI-12345&#10;FI-12346"
        [value]="fiOrderIdsInput()"
        (input)="fiOrderIdsInput.set($any($event.target).value)">
      </textarea>

      <div class="compare-action">
        <button class="btn-compare"
          [disabled]="fiJobRunning() || fiOrderIdsInput().trim().length === 0"
          (click)="startFiComparison()">
          @if (fiJobRunning()) {
            <span class="material-symbols-outlined spin">sync</span> {{ fiJob()?.message }}
          } @else {
            Start Comparison
          }
        </button>
      </div>

      @if (fiJob()?.status === 'error') {
        <div class="error-banner">
          <span class="material-symbols-outlined">warning</span> {{ fiJob()?.error }}
        </div>
      }
    </div>
    }

    <!-- FI results rendered in Task 12 -->
    @if (fiResult()) {
      <div class="fi-results-placeholder">
        <p>Results ready — Task 12 renders them here.</p>
        <button class="btn-compare" (click)="fiJob.set(null)">Start a new comparison</button>
      </div>
    }
  </div>
  } <!-- /fi mode -->
```

The file picker modal stays outside both mode blocks (it's shared). Move it after the closing FI mode block, still inside `.comparison-container`.

- [ ] **Step 3: Add mode tab + FI input styles**

Open `doodoo-fam/src/app/pages/invoice/comparison/comparison.scss` and append:
```scss
// ── Mode tabs ──────────────────────────────────────────────────────────────
.mode-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  border-bottom: 2px solid var(--border);
  padding-bottom: 0;
}

.mode-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;

  &:hover { color: var(--text); }

  &--active {
    color: var(--brand);
    border-bottom-color: var(--brand);
  }
}

// ── FI input ───────────────────────────────────────────────────────────────
.fi-view { padding: 0 4px; }

.fi-input-section { max-width: 600px; }

.fi-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;

  &__hint {
    font-weight: 400;
    color: var(--text-muted);
  }
}

.fi-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-family: 'Inconsolata', monospace;
  font-size: 14px;
  color: var(--text);
  background: var(--surface);
  resize: vertical;
  margin-bottom: 16px;

  &:focus {
    outline: none;
    border-color: var(--brand);
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd doodoo-fam && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add doodoo-fam/src/app/pages/invoice/comparison/comparison.ts \
        doodoo-fam/src/app/pages/invoice/comparison/comparison.html \
        doodoo-fam/src/app/pages/invoice/comparison/comparison.scss
git commit -m "feat: add mode switcher and Fashion Index input view to comparison page"
```

---

## Task 12: Frontend — FI results view

**Goal:** When a FI comparison job completes, the results are displayed grouped by doodoo520 order ID. Each group shows a table of product codes with FI qty, doodoo qty, and a status badge. Unlinked and not-found rows appear as amber warning banners.

**Files:**
- Modify: `doodoo-fam/src/app/pages/invoice/comparison/comparison.html`
- Modify: `doodoo-fam/src/app/pages/invoice/comparison/comparison.scss`

**Acceptance Criteria:**
- [ ] Results are grouped by `doodooOrderId`, each group in a card
- [ ] Each row shows: product code, product name, FI qty, doodoo qty, status badge
- [ ] Status badges: green "✓ Match" for matched, red "✗ Qty" for qty_mismatch, amber "FI Only" / "Admin Only" for one-sided items
- [ ] `unlinked` and `doodoo_not_found` pairs render as amber warning banners (no table)
- [ ] A summary line shows total matched / mismatched counts
- [ ] "Start a new comparison" button resets `fiJob` to null
- [ ] TypeScript compiles without errors

**Verify:** `cd doodoo-fam && npx tsc --noEmit` → no errors, then visually verify results with `loadSampleFiResult()` helper.

**Steps:**

- [ ] **Step 1: Add a sample FI result loader to the component**

In `comparison.ts`, add after `loadSampleResult()`:
```typescript
loadSampleFiResult(): void {
  this.fiJob.set({
    status: 'done',
    message: 'Done',
    result: {
      totalPairs: 2,
      mismatchCount: 1,
      pairs: [
        {
          fiOrderId: 'FI-12345', rowIndex: 0,
          doodooOrderId: '000412', pairStatus: 'compared',
          items: [
            { productCode: 'RM-001', productName: 'Raw Material A', fiQty: 100, doodooQty: 100, status: 'matched' },
            { productCode: 'RM-002', productName: 'Raw Material B', fiQty: 200, doodooQty: 150, status: 'qty_mismatch' },
            { productCode: 'FG-003', productName: 'Finished Goods C', fiQty: 50, doodooQty: 0,  status: 'fi_only' },
          ],
        },
        {
          fiOrderId: 'FI-12345', rowIndex: 1,
          doodooOrderId: null, pairStatus: 'unlinked',
          items: [],
        },
      ],
    },
  });
}
```

Add computed helpers:
```typescript
fiMatchCount    = computed(() => this.fiResult()?.pairs.reduce((n, p) => n + p.items.filter(i => i.status === 'matched').length, 0) ?? 0);
fiMismatchCount = computed(() => this.fiResult()?.pairs.reduce((n, p) => n + p.items.filter(i => i.status !== 'matched').length, 0) ?? 0);
```

- [ ] **Step 2: Replace the FI results placeholder in the template**

In `comparison.html`, replace:
```html
    <!-- FI results rendered in Task 12 -->
    @if (fiResult()) {
      <div class="fi-results-placeholder">
        <p>Results ready — Task 12 renders them here.</p>
        <button class="btn-compare" (click)="fiJob.set(null)">Start a new comparison</button>
      </div>
    }
```

With:
```html
    @if (fiResult()) {
    <div class="fi-results">

      <div class="results-header">
        <h3 class="page-title">Results</h3>
        <div class="results-badges">
          <span class="badge badge--ok">{{ fiMatchCount() }} matched</span>
          @if (fiMismatchCount() > 0) {
            <span class="badge badge--fail">{{ fiMismatchCount() }} mismatched</span>
          }
        </div>
      </div>

      @for (pair of fiResult()!.pairs; track pair.fiOrderId + pair.rowIndex) {

        @if (pair.pairStatus === 'unlinked') {
          <div class="fi-warning-banner">
            <span class="material-symbols-outlined">warning</span>
            FI order {{ pair.fiOrderId }} row {{ pair.rowIndex + 1 }}: no doodoo520 order ID found in PDF.
          </div>
        } @else if (pair.pairStatus === 'doodoo_not_found') {
          <div class="fi-warning-banner">
            <span class="material-symbols-outlined">warning</span>
            FI order {{ pair.fiOrderId }} row {{ pair.rowIndex + 1 }}: doodoo520 order #{{ pair.doodooOrderId }} not found.
          </div>
        } @else {
          <div class="fi-pair-card">
            <div class="fi-pair-card__header">
              <span class="fi-pair-card__title">
                FI {{ pair.fiOrderId }} → Doodoo #{{ pair.doodooOrderId }}
              </span>
              <span class="badge" [class.badge--ok]="pair.items.every(i => i.status === 'matched')"
                                  [class.badge--fail]="pair.items.some(i => i.status !== 'matched')">
                {{ pair.items.filter(i => i.status === 'matched').length }}/{{ pair.items.length }} matched
              </span>
            </div>

            <div class="totals-table">
              <div class="totals-table__head">
                <span>Code</span>
                <span>Description</span>
                <span class="num">FI Qty</span>
                <span class="num">Admin Qty</span>
                <span>Status</span>
              </div>
              @for (item of pair.items; track item.productCode) {
              <div class="totals-row" [class.totals-row--mismatch]="item.status !== 'matched'">
                <span class="totals-row__code">{{ item.productCode }}</span>
                <span class="totals-row__desc">{{ item.productName }}</span>
                <span class="totals-row__qty num">{{ item.fiQty > 0 ? item.fiQty : '—' }}</span>
                <span class="totals-row__qty num">{{ item.doodooQty > 0 ? item.doodooQty : '—' }}</span>
                <span class="fi-status-badge fi-status-badge--{{ item.status }}">
                  @if (item.status === 'matched')      { ✓ Match }
                  @else if (item.status === 'qty_mismatch') { ✗ Qty }
                  @else if (item.status === 'fi_only')  { FI Only }
                  @else                                  { Admin Only }
                </span>
              </div>
              }
            </div>
          </div>
        }
      }

      <div class="results-actions">
        <button class="btn-compare" (click)="fiJob.set(null); fiOrderIdsInput.set('')">
          Start a new comparison
        </button>
        <button class="btn-sample" (click)="loadSampleFiResult()">View sample</button>
      </div>
    </div>
    }
```

- [ ] **Step 3: Add FI results styles**

Append to `comparison.scss`:
```scss
// ── FI results ─────────────────────────────────────────────────────────────
.fi-results { margin-top: 8px; }

.fi-warning-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 8px;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  color: #92400e;
  font-size: 13px;
  margin-bottom: 12px;

  .material-symbols-outlined { font-size: 18px; color: #d97706; }
}

.fi-pair-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    font-family: 'Inconsolata', monospace;
  }

  .totals-table {
    padding: 0;
    .totals-table__head,
    .totals-row {
      grid-template-columns: 90px 1fr 80px 80px 90px;
    }
  }
}

.fi-status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;

  &--matched     { background: #dcfce7; color: #166534; }
  &--qty_mismatch { background: #fee2e2; color: #991b1b; }
  &--fi_only     { background: #fef9c3; color: #854d0e; }
  &--doodoo_only { background: #fef9c3; color: #854d0e; }
}
```

- [ ] **Step 4: Verify compilation**

```bash
cd doodoo-fam && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Test sample result in browser**

Run the frontend (`nx serve doodoo-fam`), navigate to `/comparisons`, switch to the Fashion Index tab, click "View sample". Verify all pair cards, warning banners, and badges render correctly.

- [ ] **Step 6: Commit**

```bash
git add doodoo-fam/src/app/pages/invoice/comparison/comparison.ts \
        doodoo-fam/src/app/pages/invoice/comparison/comparison.html \
        doodoo-fam/src/app/pages/invoice/comparison/comparison.scss
git commit -m "feat: add Fashion Index results view with per-pair cards and status badges"
```

---

## Self-Review

### Spec coverage

| Design requirement | Task covering it |
|---|---|
| Playwright scraper — FI login + order rows + PDF download | Task 6 |
| Playwright scraper — doodoo520 login + order items | Task 7 |
| PDF parser extracting `Content:#XXXXXX` | Task 4 |
| Comparison logic: matched / qty_mismatch / fi_only / doodoo_only | Task 5 |
| Job tracking (in-memory, UUID, status messages) | Task 8 |
| DB persistence (fi_sessions, fi_order_pairs, fi_item_comparisons) | Tasks 2 + 8 |
| Unlinked rows (no PDF order ID) | Task 8 + Task 12 |
| doodoo_not_found rows | Task 8 + Task 12 |
| Credentials in .env, not source | Task 1 |
| POST /api/fashion-index/compare → jobId | Task 9 |
| GET /api/fashion-index/jobs/:id polling | Task 9 |
| GET /api/fashion-index/history | Task 9 |
| Angular FiService (startComparison + pollJob) | Task 10 |
| Mode switcher (PDF Upload / Fashion Index) tabs | Task 11 |
| FI order ID textarea + Start Comparison button | Task 11 |
| Progress message display while running | Task 11 |
| FI results grouped by doodoo order ID | Task 12 |
| Status badges + warning banners | Task 12 |

All requirements covered. No gaps found.

### Placeholder scan

No TBDs, no "implement later", no vague steps. All code blocks are complete.

### Type consistency

- `FiOrderRow`, `FiScrapedItem`, `DoodooOrderItem`, `FiItemComparison`, `FiOrderPairResult`, `FiComparisonResult`, `FiJob`, `FiJobStatus` defined in `fi.types.ts` (Task 3) and imported consistently in Tasks 4–12.
- `FiItemStatus` values `'matched' | 'qty_mismatch' | 'fi_only' | 'doodoo_only'` used consistently in Tasks 5, 8, 10, 12.
- `FiPairStatus` values `'compared' | 'unlinked' | 'doodoo_not_found'` consistent in Tasks 8 and 12.
- `FiService` in Angular mirrors `FiJob`, `FiComparisonResult`, `FiOrderPairResult`, `FiItemComparison` — defined inline in `fi.service.ts` to avoid cross-project imports (Angular and NestJS are separate npm projects).

### One known implementation note

The doodoo520 detail page selector `DOODOO_DETAIL_LINK = '#main-content > div:nth-child(3) > div:nth-child(2) > div:nth-child(8) a'` is positional and will need adjustment during live testing if the page structure differs. It is defined as a constant at the top of the scraper file for easy updating.
