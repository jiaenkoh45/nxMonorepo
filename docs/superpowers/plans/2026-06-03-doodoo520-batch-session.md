# Doodoo520 Batch Session Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-login-per-order scraping on both FashionIndex and Doodoo520 with a two-phase pipeline that uses a single browser session per site.

**Architecture:** Phase 1 collects all FashionIndex rows (PDFs + items) in one browser session. Phase 2 extracts all Doodoo order IDs from those PDFs synchronously. Phase 3 scrapes all Doodoo orders in a single browser session by navigating back to the orders list between lookups. Phase 4 joins, compares, and persists — identical to the current flow.

**Tech Stack:** NestJS, Playwright (chromium), TypeScript

---

## File Map

| File | Change |
|---|---|
| `doodoo/src/fashion-index/fashion-index.scraper.ts` | Replace `scrapeOrderRows` with `scrapeAllOrderRows`; replace `scrapeDoodooOrder` with `scrapeAllDoodooOrders`; keep all private helpers unchanged |
| `doodoo/src/fashion-index/fashion-index.service.ts` | Restructure `runPipeline` into four phases; remove per-order browser lifecycle |

---

### Task 1: Batch FashionIndex scraper — one session for all FI order IDs

**Goal:** Replace `scrapeOrderRows(fiOrderId)` with `scrapeAllOrderRows(fiOrderIds[])` so the browser is launched once, logged in once, and all FI order IDs are fetched in the same session.

**Files:**
- Modify: `doodoo/src/fashion-index/fashion-index.scraper.ts`

**Acceptance Criteria:**
- [ ] `scrapeAllOrderRows` is a public method on `FashionIndexScraper`
- [ ] `scrapeOrderRows` (singular) is removed
- [ ] Browser is launched and closed exactly once per call to `scrapeAllOrderRows`
- [ ] All private helpers (`loginFashionIndex`, `fetchOrderRows`, `scrapeItemsFromPage`) are unchanged

**Verify:** `cd doodoo && npx tsc --noEmit` → zero errors

**Steps:**

- [ ] **Step 1: Remove `scrapeOrderRows` and add `scrapeAllOrderRows`**

In [doodoo/src/fashion-index/fashion-index.scraper.ts](doodoo/src/fashion-index/fashion-index.scraper.ts), replace the entire `scrapeOrderRows` method (lines 21–34) with:

```typescript
async scrapeAllOrderRows(fiOrderIds: string[]): Promise<FiOrderRow[]> {
  const browser = await chromium.launch({
    headless: process.env['PLAYWRIGHT_HEADFUL'] !== 'true',
  });
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await this.loginFashionIndex(page);
    const rows: FiOrderRow[] = [];
    for (const fiOrderId of fiOrderIds) {
      const orderRows = await this.fetchOrderRows(page, fiOrderId);
      rows.push(...orderRows);
    }
    return rows;
  } finally {
    await ctx.close();
    await browser.close();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd doodoo && npx tsc --noEmit
```

Expected: no output (zero errors). If the service still references `scrapeOrderRows`, it will error here — that is expected and will be fixed in Task 3.

- [ ] **Step 3: Commit**

```bash
git add doodoo/src/fashion-index/fashion-index.scraper.ts
git commit -m "refactor(fi-scraper): batch FashionIndex scraping into one browser session"
```

---

### Task 2: Batch Doodoo520 scraper — one session for all doodoo order IDs

**Goal:** Replace `scrapeDoodooOrder(doodooOrderId)` with `scrapeAllDoodooOrders(orderIds[])` so one browser session logs in once and loops through all order IDs, navigating back to the orders list page between each lookup.

**Files:**
- Modify: `doodoo/src/fashion-index/fashion-index.scraper.ts`

**Acceptance Criteria:**
- [ ] `scrapeAllDoodooOrders` is a public method on `FashionIndexScraper` returning `Promise<Map<string, DoodooOrderItem[]>>`
- [ ] `scrapeDoodooOrder` (singular) is removed
- [ ] Browser is launched and closed exactly once per call to `scrapeAllDoodooOrders`
- [ ] An empty input array returns an empty Map without launching a browser
- [ ] For each order ID: search → navigate to detail → scrape → navigate back to orders list
- [ ] An order ID with no detail link gets `[]` in the map and the loop continues

**Verify:** `cd doodoo && npx tsc --noEmit` → zero errors

**Steps:**

- [ ] **Step 1: Remove `scrapeDoodooOrder` and add `scrapeAllDoodooOrders`**

In [doodoo/src/fashion-index/fashion-index.scraper.ts](doodoo/src/fashion-index/fashion-index.scraper.ts), replace the entire `scrapeDoodooOrder` method (lines 141–183) with:

```typescript
async scrapeAllDoodooOrders(
  orderIds: string[],
): Promise<Map<string, DoodooOrderItem[]>> {
  const result = new Map<string, DoodooOrderItem[]>();
  if (orderIds.length === 0) return result;

  const browser = await chromium.launch({
    headless: process.env['PLAYWRIGHT_HEADFUL'] !== 'true',
  });
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await this.loginDoodoo(page);

    const ordersHref = await page.$eval(
      DOODOO_NAV_ORDERS,
      (el: HTMLAnchorElement) => el.href,
    );
    await page.goto(ordersHref);
    await page.waitForLoadState('networkidle');

    for (const orderId of orderIds) {
      await page.fill(DOODOO_ORDER_INPUT, orderId);
      await page.click(DOODOO_ORDER_SUBMIT);
      await page.waitForLoadState('networkidle');

      const detailAnchor = await page.$(DOODOO_DETAIL_LINK);
      if (!detailAnchor) {
        this.logger.warn(
          `Doodoo order ${orderId} not found — no detail link`,
        );
        result.set(orderId, []);
        await page.goto(ordersHref);
        await page.waitForLoadState('networkidle');
        continue;
      }

      const detailHref = await detailAnchor.getAttribute('href');
      if (!detailHref) {
        result.set(orderId, []);
        await page.goto(ordersHref);
        await page.waitForLoadState('networkidle');
        continue;
      }

      await page.goto(
        detailHref.startsWith('http')
          ? detailHref
          : `${DOODOO_ORIGIN}${detailHref}`,
      );
      await page.waitForLoadState('networkidle');

      const items = await this.scrapeDoodooItemRows(page);
      result.set(orderId, items);

      await page.goto(ordersHref);
      await page.waitForLoadState('networkidle');
    }

    return result;
  } finally {
    await ctx.close();
    await browser.close();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd doodoo && npx tsc --noEmit
```

Expected: no output. If the service still references `scrapeDoodooOrder`, it will error here — fixed in Task 3.

- [ ] **Step 3: Commit**

```bash
git add doodoo/src/fashion-index/fashion-index.scraper.ts
git commit -m "refactor(fi-scraper): batch Doodoo520 scraping into one browser session"
```

---

### Task 3: Restructure pipeline into two phases

**Goal:** Rewrite `runPipeline` in `FashionIndexService` to call `scrapeAllOrderRows` then `scrapeAllDoodooOrders` — one browser session per site — and join the results for comparison.

**Files:**
- Modify: `doodoo/src/fashion-index/fashion-index.service.ts`

**Acceptance Criteria:**
- [ ] `runPipeline` no longer calls `scrapeOrderRows` or `scrapeDoodooOrder`
- [ ] All FI rows are collected before any Doodoo scraping begins
- [ ] PDF extraction loop runs synchronously between Phase 1 and Phase 3
- [ ] Duplicate doodoo order IDs across FI rows are deduplicated before Phase 3
- [ ] Pairs with null `doodooOrderId` still get `pairStatus: 'unlinked'`
- [ ] Pairs whose doodoo order returns an empty items array still get `pairStatus: 'doodoo_not_found'`
- [ ] `cd doodoo && npx tsc --noEmit` → zero errors

**Verify:** `cd doodoo && npx tsc --noEmit` → zero errors; then trigger a real pipeline run and confirm `doodoo/fi-diagnostic.md` is written with all pairs.

**Steps:**

- [ ] **Step 1: Replace `runPipeline` in the service**

In [doodoo/src/fashion-index/fashion-index.service.ts](doodoo/src/fashion-index/fashion-index.service.ts), replace the entire `runPipeline` method (lines 56–188) with:

```typescript
private async runPipeline(
  jobId: string,
  fiOrderIds: string[],
): Promise<void> {
  try {
    // Phase 1: Scrape all FI rows in one browser session
    this.update(jobId, { message: 'Scraping FashionIndex orders…' });
    const allFiRows = await this.scraper.scrapeAllOrderRows(fiOrderIds);

    // Phase 2: Extract doodoo order IDs from PDFs (no browser)
    this.update(jobId, { message: 'Extracting Doodoo order IDs from PDFs…' });
    type RowMeta = {
      fiOrderId: string;
      rowIndex: number;
      fiItems: FiScrapedItem[];
      doodooOrderId: string | null;
    };
    const rowMetas: RowMeta[] = [];
    for (const row of allFiRows) {
      if (!row.pdfBuffer || row.pdfBuffer.length === 0) {
        this.logger.warn(
          `Empty PDF for FI ${row.fiOrderId} row ${row.rowIndex}`,
        );
        rowMetas.push({
          fiOrderId: row.fiOrderId,
          rowIndex: row.rowIndex,
          fiItems: row.items,
          doodooOrderId: null,
        });
        continue;
      }
      const doodooOrderId = await extractOrderIdFromPdf(row.pdfBuffer);
      if (!doodooOrderId) {
        this.logger.warn(
          `No order ID in PDF for FI ${row.fiOrderId} row ${row.rowIndex}`,
        );
      }
      rowMetas.push({
        fiOrderId: row.fiOrderId,
        rowIndex: row.rowIndex,
        fiItems: row.items,
        doodooOrderId: doodooOrderId ?? null,
      });
    }

    // Phase 3: Scrape all doodoo orders in one browser session
    const uniqueDoodooIds = [
      ...new Set(
        rowMetas
          .map((r) => r.doodooOrderId)
          .filter((id): id is string => id !== null),
      ),
    ];
    this.update(jobId, {
      message: `Scraping ${uniqueDoodooIds.length} Doodoo520 order(s)…`,
    });
    const doodooItemsMap =
      await this.scraper.scrapeAllDoodooOrders(uniqueDoodooIds);

    // Phase 4: Join, compare, build result
    const pairs: FiOrderPairResult[] = [];
    const diagPairs: DiagPair[] = [];

    for (const meta of rowMetas) {
      if (!meta.doodooOrderId) {
        pairs.push({
          fiOrderId: meta.fiOrderId,
          rowIndex: meta.rowIndex,
          doodooOrderId: null,
          pairStatus: 'unlinked',
          items: [],
        });
        diagPairs.push({
          fiOrderId: meta.fiOrderId,
          rowIndex: meta.rowIndex,
          doodooOrderId: null,
          pairStatus: 'unlinked',
          fiItems: meta.fiItems,
          doodooItems: [],
          comparisonItems: [],
        });
        continue;
      }

      const doodooItems = doodooItemsMap.get(meta.doodooOrderId) ?? [];

      if (doodooItems.length === 0) {
        pairs.push({
          fiOrderId: meta.fiOrderId,
          rowIndex: meta.rowIndex,
          doodooOrderId: meta.doodooOrderId,
          pairStatus: 'doodoo_not_found',
          items: [],
        });
        diagPairs.push({
          fiOrderId: meta.fiOrderId,
          rowIndex: meta.rowIndex,
          doodooOrderId: meta.doodooOrderId,
          pairStatus: 'doodoo_not_found',
          fiItems: meta.fiItems,
          doodooItems: [],
          comparisonItems: [],
        });
        continue;
      }

      const items = this.comparison.compare(meta.fiItems, doodooItems);
      pairs.push({
        fiOrderId: meta.fiOrderId,
        rowIndex: meta.rowIndex,
        doodooOrderId: meta.doodooOrderId,
        pairStatus: 'compared',
        items,
      });
      diagPairs.push({
        fiOrderId: meta.fiOrderId,
        rowIndex: meta.rowIndex,
        doodooOrderId: meta.doodooOrderId,
        pairStatus: 'compared',
        fiItems: meta.fiItems,
        doodooItems,
        comparisonItems: items,
      });
    }

    const mismatchCount = pairs.filter((p) =>
      p.items.some((i) => i.status !== 'matched'),
    ).length;
    const result: FiComparisonResult = {
      pairs,
      totalPairs: pairs.length,
      mismatchCount,
    };

    this.writeDiagnosticMd(diagPairs);
    this.update(jobId, { message: 'Saving results…' });
    await this.persistResult(result);
    this.update(jobId, { status: 'done', message: 'Done', result });
  } catch (err: any) {
    this.logger.error(`FI job ${jobId} failed: ${err.message}`);
    this.update(jobId, {
      status: 'error',
      message: err.message,
      error: err.message,
    });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd doodoo && npx tsc --noEmit
```

Expected: zero output (no errors).

- [ ] **Step 3: Start the backend and trigger a real pipeline run to confirm `fi-diagnostic.md` is written**

```bash
# Terminal 1 — start backend
cd doodoo && npm run start:dev

# Terminal 2 — trigger a job via the API (replace ORDER_ID with a real FI order ID)
curl -s -X POST http://localhost:3000/api/fashion-index/jobs \
  -H "Content-Type: application/json" \
  -d '{"fiOrderIds":["ORDER_ID"]}' \
  -b "access_token=<your_jwt>"

# Poll for completion
curl -s http://localhost:3000/api/fashion-index/jobs/<job_id> -b "access_token=<your_jwt>"
```

Expected: job reaches `status: "done"` and `doodoo/fi-diagnostic.md` is updated with at least one pair entry. No `login` log lines appear more than once for each site.

- [ ] **Step 4: Commit**

```bash
git add doodoo/src/fashion-index/fashion-index.service.ts
git commit -m "refactor(fi-service): two-phase pipeline — one browser session per site"
```

---

## Notes

- `fetchOrderRows` re-evaluates the FI nav selector on whatever page it is currently on. This works only if the FI site nav (`nav a:nth-of-type(2)`) is present on order detail pages. If a run fails with "element not found" during the second FI order, add `await page.goto(FI_URL)` before `page.$eval(FI_ORDERS_NAV, ...)` inside `fetchOrderRows`.
- Doodoo detail navigation reuses the current code path (`page.goto(detailHref)`) rather than handling actual new tabs, because Playwright's `getAttribute('href')` bypasses the tab-open behavior. If the site changes to a `target="_blank"` without an `href`, switch to `context.waitForEvent('page')`.
