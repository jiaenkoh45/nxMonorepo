# Multi-Order Invoice Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the invoice parser read every order in a multi-page PDF (one order per page) for both the client and creditor/supplier sections, instead of only the first order on page 1.

**Architecture:** `pdf-parse` concatenates page text with a `\n\n` separator. We split the raw extracted text into per-order segments on that page boundary, then run the existing per-order parse logic on each segment and return an array of `ParsedInvoice`. The controller flat-maps the arrays; the DB keys per-order rows uniquely. Separately, the header-field regexes (name / bill / date) are made template-agnostic so the new `收货人` / `BILL #` / `DATE <time> <date>` layout is read correctly (without this, per-order filename labels collide).

**Tech Stack:** NestJS (root `doodoo/`), TypeScript 5.7, Jest + ts-jest, `pdf-parse` 1.1.

**Working directory for all paths:** `c:\Users\jiaen\Documents\doo-account` (the active backend is the root `doodoo/`, NOT `NxMonorepo/doodoo/` which does not exist on disk).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `doodoo/src/invoice/invoice-parser.service.ts` | PDF → `ParsedInvoice[]`; per-order splitting; header-field + item parsing | Modify |
| `doodoo/src/invoice/invoice-parser.service.spec.ts` | Unit tests for splitting, field regexes, multi-order parsing | Create |
| `doodoo/src/invoice/invoice.controller.ts` | HTTP endpoint; flatten per-file order arrays | Modify |
| `doodoo/src/invoice/database.service.ts` | Persist; per-order-unique file keying | Modify |
| `doodoo/scripts/dump-pdf-text.ts` | One-off diagnostic: dump real `pdf-parse` output | Create (Task 0) |

**Design note — why page-split, not header-split:** every order begins with the title "LIVE ORDER" which `pdf-parse` may emit twice per page (small header + large heading), so splitting on the title over-splits. The `\n\n` page separator is emitted exactly once between pages and never inside a page's body, making it the reliable boundary. A merge-guard folds any header-less fragment back into the previous order to defend against stray intra-page blank lines.

---

## Task 0: Characterization — capture real `pdf-parse` output (evidence gate)

**Goal:** Before changing any regex, capture exactly what `pdf-parse` emits for the failing multi-order file and the working single-order file, so the split boundary and item-row format are chosen from evidence, not assumption.

**Files:**
- Create: `doodoo/scripts/dump-pdf-text.ts`

**Acceptance Criteria:**
- [ ] Running the script on the 7-order file prints the full extracted text and a `JSON.stringify` of `text.split('\n')` (so smashed/empty lines are visible).
- [ ] Output confirms the page separator is a blank line (`\n\n`) between the 7 orders.
- [ ] The exact line form of an item row in the new template is recorded (e.g. is it `1BS18` smashed, or `1 BS18` spaced; is the trailing numeric `29.90129.90` smashed).

**Verify:** `cd doodoo && npx ts-node scripts/dump-pdf-text.ts "<path-to>/7单.pdf"` → prints text + line array; eyeball the 7 page boundaries.

**Steps:**

- [ ] **Step 1: Write the diagnostic script**

```ts
// doodoo/scripts/dump-pdf-text.ts
/* One-off: dump real pdf-parse output so we can see page boundaries and the
   exact (possibly whitespace-smashed) line layout. Not imported by the app. */
import { readFileSync } from 'fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: ts-node scripts/dump-pdf-text.ts <file.pdf>');
    process.exit(1);
  }
  const data = await pdfParse(readFileSync(path));
  console.log('===== numpages:', data.numpages, '=====');
  console.log('===== RAW TEXT =====');
  console.log(data.text);
  console.log('===== LINES (JSON) =====');
  console.log(JSON.stringify(data.text.split('\n'), null, 1));
  const pages = data.text.split(/\n{2,}/).filter((s: string) => s.trim());
  console.log('===== PAGE-SPLIT CHUNK COUNT:', pages.length, '=====');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run on both files and record findings**

Run:
```bash
cd doodoo
npx ts-node scripts/dump-pdf-text.ts "/c/Users/jiaen/Documents/doo-account/7单.pdf"
npx ts-node scripts/dump-pdf-text.ts "/c/Users/jiaen/Documents/doo-account/订单 (Goh Kah Huat)#000391.pdf"
```
Expected: 7单.pdf reports `numpages: 7` and `PAGE-SPLIT CHUNK COUNT: 7`. Goh file reports `numpages: 1`, chunk count `1`.

Record in the commit message: (a) whether item rows are smashed (`1BS18` / `29.90129.90`) or spaced, and (b) the literal customer/bill/date line forms. These confirm the regexes in Tasks 1–3.

- [ ] **Step 3: Commit**

```bash
git add doodoo/scripts/dump-pdf-text.ts
git commit -m "chore(invoice): add pdf-parse text dump script for diagnosis"
```

> If Step 2 shows the page-split chunk count is NOT 7 (e.g. pdf-parse merged pages, or split inside a page), STOP and report — the split boundary in Task 1 must be adjusted to the real separator before continuing.

---

## Task 1: `splitIntoOrders()` page-splitter

**Goal:** Add a private helper that splits one file's raw extracted text into per-order text segments on the page boundary, with a merge-guard for stray blank lines.

**Files:**
- Modify: `doodoo/src/invoice/invoice-parser.service.ts` (add helper near the other private helpers, ~line 474)
- Test: `doodoo/src/invoice/invoice-parser.service.spec.ts` (create)

**Acceptance Criteria:**
- [ ] A 3-order text joined by `\n\n` splits into exactly 3 segments.
- [ ] A header-less trailing fragment (no `LIVE ORDER` / `INVOICE`) is merged into the previous segment, not returned as its own order.
- [ ] Leading empty chunk (pdf-parse prefixes page 1 with `\n\n`) is dropped.

**Verify:** `cd doodoo && npx jest invoice-parser.service.spec --silent` → splitter tests PASS.

**Steps:**

- [ ] **Step 1: Write the failing tests**

```ts
// doodoo/src/invoice/invoice-parser.service.spec.ts
import { InvoiceParserService } from './invoice-parser.service';

// Reach the private helper without `any` noise in each test.
type WithSplit = { splitIntoOrders(text: string): string[] };

describe('InvoiceParserService.splitIntoOrders', () => {
  const svc = new InvoiceParserService() as unknown as InvoiceParserService & WithSplit;

  it('splits a multi-order text on the page boundary', () => {
    const text =
      '\n\nLIVE ORDER\nBILL #001\nitem A\n\n' +
      'LIVE ORDER\nBILL #002\nitem B\n\n' +
      'LIVE ORDER\nBILL #003\nitem C';
    const parts = svc.splitIntoOrders(text);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('#001');
    expect(parts[2]).toContain('#003');
  });

  it('merges a header-less fragment into the previous order', () => {
    const text =
      'LIVE ORDER\nBILL #001\nitem A\n\n' +
      'stray continuation line with no header';
    const parts = svc.splitIntoOrders(text);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain('stray continuation');
  });

  it('handles a single order (returns one segment)', () => {
    const parts = svc.splitIntoOrders('\n\nLIVE ORDER\nBILL #001\nitem A');
    expect(parts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd doodoo && npx jest invoice-parser.service.spec --silent`
Expected: FAIL — `svc.splitIntoOrders is not a function`.

- [ ] **Step 3: Implement the helper**

Add inside the `InvoiceParserService` class, in the "Shared helpers" section (after `extractFallbackName`, before the closing brace ~line 481):

```ts
  // Each order is its own PDF page; pdf-parse separates pages with a blank line
  // ("\n\n"). Split on that boundary, then fold any header-less fragment back
  // into the previous order so a stray intra-page blank line can't create a
  // phantom order. Works for both templates (client "LIVE ORDER", supplier
  // "INVOICE") because it keys on the page break, not the per-template title.
  private splitIntoOrders(text: string): string[] {
    const hasHeader = (s: string) => /LIVE\s+ORDER|INVOICE/i.test(s);
    const chunks = text
      .split(/\n{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);

    const orders: string[] = [];
    for (const chunk of chunks) {
      if (orders.length > 0 && !hasHeader(chunk)) {
        orders[orders.length - 1] += '\n' + chunk; // continuation of prev order
      } else {
        orders.push(chunk);
      }
    }
    return orders;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd doodoo && npx jest invoice-parser.service.spec --silent`
Expected: PASS (3 splitter tests).

- [ ] **Step 5: Commit**

```bash
git add doodoo/src/invoice/invoice-parser.service.ts doodoo/src/invoice/invoice-parser.service.spec.ts
git commit -m "feat(invoice): add per-order page splitter"
```

---

## Task 2: Template-agnostic header-field regexes

**Goal:** Read `customerName`, `orderNo`, and `date` from BOTH templates — `名字:` / `BILL:` / `DATE:` (old) and `收货人：` / `BILL #` / `DATE <time> <date>` (new). Without this, every new-template order gets `customerName="Unknown"` and empty `orderNo`, which breaks per-order filename labels.

**Files:**
- Modify: `doodoo/src/invoice/invoice-parser.service.ts:239-248` (the name/bill/date matches in `parseClientInvoice`)
- Test: `doodoo/src/invoice/invoice-parser.service.spec.ts` (append)

**Acceptance Criteria:**
- [ ] `收货人： Jackie Loh 电话： 0127668992` → name `Jackie Loh` (phone excluded).
- [ ] `名字: Goh Kah Huat` → name `Goh Kah Huat` (regression).
- [ ] `BILL #001952` → `001952`; `BILL: #000391` → `000391`.
- [ ] `DATE 02:53:01 16-06-2026` → `16-06-2026`; `DATE: 2026-04-22` → `2026-04-22`.

**Verify:** `cd doodoo && npx jest invoice-parser.service.spec --silent` → field tests PASS.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `doodoo/src/invoice/invoice-parser.service.spec.ts`:

```ts
import pdfParse from 'pdf-parse';
jest.mock('pdf-parse');
const mockPdfParse = pdfParse as jest.MockedFunction<typeof pdfParse>;

describe('InvoiceParserService header fields (both templates)', () => {
  const svc = new InvoiceParserService();

  // Real pdf-parse line forms (captured in Task 0): DATE/BILL label on their
  // own line with the value on the NEXT line; bill number duplicated; the
  // 收货人 name+phone smashed onto one line with full-width colons; item rows
  // fully smashed onto one line: {seq}{code}{name}{unit}{qty}{subtotal}.
  const NEW_ORDER =
    'LIVE ORDER| 已付款\n' +
    'DATE\n02:53:01 16-06-2026\n' +
    'BILL\n#001952\n#001952\n' +
    '收货人：Jackie Loh电话：0127668992\n' +
    '地址：18, Jalan Hujan Abu 3, OUG, 58200 KL Kuala Lumpur\n' +
    '序号代码照片产品名称 (Product)单价 (RM)数量 (Qty)小计 (RM)\n' +
    '1BS18黄瓜籽粉 500克29.90129.90\n' +
    '2HM1Holistic Medicinal 苹果醋 946ml49.00149.00\n' +
    '备注 / REMARKS:\n总额 (Subtotal): 78.90\n总单数 (Total Qty): 2';

  // Old template (Goh, working): labelled fields with ASCII colons, ISO date,
  // multi-line item rows (seq+code line, name line, numeric line).
  const OLD_ORDER =
    'LIVE ORDER\nDATE: 2026-04-22\nBILL: #000391\n' +
    '名字: Goh Kah Huat\n电话: 01158559081\n' +
    '序号代码照片产品名称 (Product)单价 (RM)数量 (Qty)小计 (RM)\n' +
    '1YN137\n100%纯葛根粉 500克\n54.00154.00\n' +
    '2BS100\n九蒸九制黄精 250克\n79.00179.00\n' +
    '备注 / REMARKS:\n总额 (Subtotal): 133.00';

  it('reads name/bill/date from the new 收货人 template', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: NEW_ORDER } as any);
    const [inv] = await svc.parseMarkerFile(Buffer.from('x'), 'new.pdf');
    expect(inv.customerName).toBe('Jackie Loh');
    expect(inv.orderNo).toBe('001952');
    expect(inv.date).toBe('16-06-2026');
  });

  it('still reads the old 名字 template (regression)', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: OLD_ORDER } as any);
    const [inv] = await svc.parseMarkerFile(Buffer.from('x'), 'old.pdf');
    expect(inv.customerName).toBe('Goh Kah Huat');
    expect(inv.orderNo).toBe('000391');
    expect(inv.date).toBe('2026-04-22');
  });
});
```

> Note: these tests call `parseMarkerFile` and index `[0]` — they depend on Task 3's array return type. Implement Task 2's regex changes now; the tests go green only after Task 3. Run Task 2's assertions standalone by temporarily checking `parseClientInvoice` if you want a red/green within this task, otherwise treat Task 2+3 as one red→green pair and commit Task 2's regex change first.

- [ ] **Step 2: Replace the three field matches**

In `parseClientInvoice` ([invoice-parser.service.ts:239-248](doodoo/src/invoice/invoice-parser.service.ts#L239-L248)) replace:

```ts
    const nameMatch = text.match(/名字\s*[：:]\s*(.+)/);
    const customerName = nameMatch
      ? nameMatch[1].trim()
      : this.extractFallbackName(text);

    const billMatch = text.match(/BILL\s*[：:]\s*#?(\S+)/i);
    const orderNo = billMatch ? billMatch[1] : '';

    const dateMatch = text.match(/DATE\s*[：:]\s*(\S+)/i);
    const date = dateMatch ? dateMatch[1] : '';
```

with:

```ts
    // Name: old template "名字: NAME"; new template "收货人： NAME 电话： ..."
    // (stop before the trailing phone field or an opening bracket).
    const nameMatch =
      text.match(/名字\s*[：:]\s*([^\n\r]+)/) ||
      text.match(/收货人\s*[：:]\s*([^\n\r（(]+?)(?:\s*电话|\s*[（(]|\s*$)/m);
    const customerName = nameMatch
      ? nameMatch[1].trim()
      : this.extractFallbackName(text);

    // Bill: "BILL: #000391" or "BILL #001952" (colon optional, # optional).
    const billMatch = text.match(/BILL\s*[：:]?\s*#?\s*(\d+)/i);
    const orderNo = billMatch ? billMatch[1] : '';

    // Date: capture the calendar date in either ISO (2026-04-22) or
    // dd-mm-yyyy (16-06-2026) form — the new template prefixes a clock time.
    const dateMatch =
      text.match(/\b(\d{4}-\d{2}-\d{2})\b/) ||
      text.match(/\b(\d{2}-\d{2}-\d{4})\b/);
    const date = dateMatch ? dateMatch[1] : '';
```

Also extend `extractFallbackName` ([invoice-parser.service.ts:476-481](doodoo/src/invoice/invoice-parser.service.ts#L476-L481)) to know the new label:

```ts
  private extractFallbackName(text: string): string {
    const m =
      text.match(/ATTN[ \t]*[：:][ \t]*([^\n\r]+)/i) ||
      text.match(/名字[ \t]*[：:][ \t]*([^\n\r]+)/) ||
      text.match(/收货人[ \t]*[：:][ \t]*([^\n\r（(电]+)/);
    return m ? m[1].trim() : 'Unknown';
  }
```

- [ ] **Step 3: Commit (with Task 3, or now if verified via parseClientInvoice)**

```bash
git add doodoo/src/invoice/invoice-parser.service.ts doodoo/src/invoice/invoice-parser.service.spec.ts
git commit -m "feat(invoice): read name/bill/date from both invoice templates"
```

---

## Task 3: `parseMarkerFile` returns `ParsedInvoice[]`

**Goal:** Split each uploaded file into per-order segments, type-detect and parse each segment, label each order's `filename` uniquely, and return the array. This is the core multi-order change and covers both client and supplier (each segment is routed to its own parser exactly as today).

**Files:**
- Modify: `doodoo/src/invoice/invoice-parser.service.ts:67-107` (`parseMarkerFile` signature + body)
- Test: `doodoo/src/invoice/invoice-parser.service.spec.ts` (append)

**Acceptance Criteria:**
- [ ] `parseMarkerFile` returns `Promise<ParsedInvoice[]>`.
- [ ] A 2-order client text yields 2 `ParsedInvoice`, each with its own `customerName` and items (correct `qty`).
- [ ] Each returned order's `filename` is unique: base name + order id (e.g. `7单.pdf #001952`).
- [ ] Orders that parse to zero items are dropped; a file that yields zero orders still throws the existing "could not be read" / "cannot determine type" errors.
- [ ] A single-order file still returns a 1-element array (Goh regression).

**Verify:** `cd doodoo && npx jest invoice-parser.service.spec --silent` → all parser tests PASS.

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `doodoo/src/invoice/invoice-parser.service.spec.ts`:

```ts
describe('InvoiceParserService.parseMarkerFile (multi-order)', () => {
  const svc = new InvoiceParserService();

  // Two orders separated by the blank-line page boundary, using the REAL
  // smashed single-line item form {seq}{code}{name}{unit}{qty}{subtotal}.
  // Order 2 includes a qty=2 row (H85 18.00 x2 = 36.00 -> "18.00236.00") to
  // prove quantities are read from the smashed trailing numbers, not defaulted.
  const TWO_ORDERS =
    'LIVE ORDER| 已付款\nDATE\n02:53:01 16-06-2026\nBILL\n#001952\n#001952\n' +
    '收货人：Jackie Loh电话：0127668992\n' +
    '序号代码照片产品名称 (Product)单价 (RM)数量 (Qty)小计 (RM)\n' +
    '1BS18黄瓜籽粉 500克29.90129.90\n' +
    '2HM1Holistic Medicinal 苹果醋 946ml49.00149.00\n' +
    '备注 / REMARKS:\n总额 (Subtotal): 78.90\n总单数 (Total Qty): 2' +
    '\n\n' +
    'LIVE ORDER| 已付款\nDATE\n02:52:09 16-06-2026\nBILL\n#001949\n#001949\n' +
    '收货人：Tan Sioh Kieow电话：0167225324\n' +
    '序号代码照片产品名称 (Product)单价 (RM)数量 (Qty)小计 (RM)\n' +
    '1H85无核红枣 500克18.00236.00\n' +
    '2BZ23黄芪 100克12.00112.00\n' +
    '备注 / REMARKS:\n总额 (Subtotal): 48.00\n总单数 (Total Qty): 3';

  it('returns one ParsedInvoice per order with correct names and qty', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: TWO_ORDERS } as any);
    const orders = await svc.parseMarkerFile(Buffer.from('x'), '7单.pdf');

    expect(orders).toHaveLength(2);
    expect(orders.map((o) => o.customerName)).toEqual(['Jackie Loh', 'Tan Sioh Kieow']);
    expect(orders[0].filename).toBe('7单.pdf #001952');
    expect(orders[1].filename).toBe('7单.pdf #001949');

    const bs18 = orders[0].items.find((i) => i.code === 'BS18');
    expect(bs18?.qty).toBe(1);
    expect(bs18?.subtotal).toBe(29.9);
    const h85 = orders[1].items.find((i) => i.code === 'H85');
    expect(h85?.qty).toBe(2);
    expect(h85?.subtotal).toBe(36);
  });
});

describe('InvoiceParserService client item rows (real smashed forms)', () => {
  const svc = new InvoiceParserService();

  // Helper: wrap raw item lines in a minimal client order and parse it.
  const parseItems = async (itemLines: string) => {
    const text =
      'LIVE ORDER| 已付款\n收货人：Test User电话：0123456789\n' +
      '序号代码照片产品名称 (Product)单价 (RM)数量 (Qty)小计 (RM)\n' +
      itemLines + '\n' +
      '备注 / REMARKS:\n总额 (Subtotal): 0.00';
    mockPdfParse.mockResolvedValueOnce({ text } as any);
    const [inv] = await svc.parseMarkerFile(Buffer.from('x'), 'f.pdf');
    return inv.items;
  };

  it('parses a single-line smashed row', async () => {
    const items = await parseItems('1BS18黄瓜籽粉 500克29.90129.90');
    expect(items).toContainEqual(
      expect.objectContaining({ code: 'BS18', qty: 1, unitPrice: 29.9, subtotal: 29.9 }),
    );
  });

  it('parses a multi-qty row (18.00 x2 = 36.00)', async () => {
    const items = await parseItems('3H85无核红枣 500克18.00236.00');
    expect(items).toContainEqual(
      expect.objectContaining({ code: 'H85', qty: 2, subtotal: 36 }),
    );
  });

  it('parses a multi-line wrapped row (name + promo across lines)', async () => {
    const items = await parseItems(
      '1BS0112\n有机灵芝孢子粉 100克\nBS0112 买 1 送 同款1 (买 1 送 同款 x1)\n99.00199.00',
    );
    expect(items).toContainEqual(
      expect.objectContaining({ code: 'BS0112', qty: 1, subtotal: 99 }),
    );
  });

  it('parses a special-price row (struck 49.00, sale 29.00, qty1)', async () => {
    const items = await parseItems('5YZ2玻璃酸钠滴眼液 OSM 10ml 特价49.0029.00129.00');
    expect(items).toContainEqual(
      expect.objectContaining({ code: 'YZ2', qty: 1, unitPrice: 29, subtotal: 29 }),
    );
  });

  it('marks a gift row (subtotal 0.00) and keeps qty', async () => {
    const items = await parseItems('2BS0112有机灵芝孢子粉 100克 特价 赠品99.0010.00');
    const gift = items.find((i) => i.code === 'BS0112');
    expect(gift?.qty).toBe(1);
    expect(gift?.subtotal).toBe(0);
    expect(gift?.isGift).toBe(true);
  });

  it('drops non-product discount rows (code "-")', async () => {
    const items = await parseItems('4-折扣劵 RM3.88-3.881-3.88');
    expect(items.find((i) => i.code === '-')).toBeUndefined();
  });

  it('parses the old multi-line template row (Goh regression)', async () => {
    const items = await parseItems('1YN137\n100%纯葛根粉 500克\n54.00154.00');
    expect(items).toContainEqual(
      expect.objectContaining({ code: 'YN137', qty: 1, subtotal: 54 }),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd doodoo && npx jest invoice-parser.service.spec --silent`
Expected: FAIL — `parseMarkerFile` returns a single object (`.toHaveLength` fails / not iterable); the smashed single-line rows are not parsed by the current `parseClientItemLines` (which requires `^{seq}{code}$` alone on a line).

- [ ] **Step 3: Rewrite `parseMarkerFile`**

Replace the whole method body ([invoice-parser.service.ts:67-107](doodoo/src/invoice/invoice-parser.service.ts#L67-L107)) with:

```ts
  async parseMarkerFile(
    buffer: Buffer,
    filename: string,
  ): Promise<ParsedInvoice[]> {
    let textContent: string;
    const jpegBase64: string | null = null;

    try {
      const data = await pdfParse(buffer);
      textContent = data.text as string;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `"${filename}" could not be read as a PDF (${msg}). Make sure the file is a valid PDF with a text layer.`,
      );
    }

    if (!textContent?.trim()) {
      throw new Error(
        `No text content found in "${filename}". The PDF may be a scanned image — text-layer extraction requires a digitally-generated PDF.`,
      );
    }

    const segments = this.splitIntoOrders(textContent);
    const orders: ParsedInvoice[] = [];

    for (const segment of segments) {
      const parsed = this.parseSegment(segment, filename, jpegBase64);
      if (parsed && parsed.items.length > 0) orders.push(parsed);
    }

    if (orders.length === 0) {
      throw new Error(
        `No orders could be read from "${filename}". Check the invoice template/format.`,
      );
    }

    // Multiple orders share one source filename; give each a unique, readable
    // label so the comparison UI and the DB file rows can tell them apart.
    if (orders.length > 1) {
      for (let i = 0; i < orders.length; i++) {
        const id = orders[i].orderNo || orders[i].invoiceNo || String(i + 1);
        orders[i].filename = `${filename} #${id}`;
      }
    }

    return orders;
  }

  // Detect the template for a single order segment and route to its parser.
  private parseSegment(
    text: string,
    filename: string,
    jpegBase64: string | null,
  ): ParsedInvoice | null {
    const isClient = /LIVE\s+ORDER|名字\s*[：:]|收货人\s*[：:]/i.test(text);
    const isSupplier = /INVOICE/i.test(text) && /UNIT/i.test(text);

    if (isClient) {
      return this.parseClientInvoice(text, filename, jpegBase64);
    } else if (isSupplier) {
      return this.parseSupplierInvoice(text, filename, jpegBase64);
    }
    // Unknown segment: try supplier as a last resort; caller drops empty results.
    const fallback = this.parseSupplierInvoice(text, filename, jpegBase64);
    return fallback.items.length > 0 ? fallback : null;
  }
```

> The old single-order `isClient`/`isSupplier`/fallback block is now inside `parseSegment`. `parseClientInvoice` keeps its header→`备注` slice (now operating on one order's text). The supplier parser is unchanged. The CLIENT item parser MUST be rewritten (Step 4) because the new template smashes whole rows onto one line.

- [ ] **Step 4: Rewrite the client item parser for smashed single-line rows**

**Why:** Task 0 captured the real layout. The new template emits each row as ONE smashed line — `1BS18黄瓜籽粉 500克29.90129.90` — but the current `parseClientItemLines` requires the seq+code alone on a line (`/^(\d+)(code)$/`), so it silently drops every single-line row. This is the actual "can't read anything" bug. The fix groups rows by item-start, joins each group, and extracts the trailing smashed `{unit}{qty}{subtotal}` with one regex that provably handles every real case (single-line, multi-line wrap, special price `49.0029.00129.00`, gift `99.0010.00`, multi-qty `18.00236.00`) AND the old Goh multi-line form.

Replace `parseClientItemLines`, `resolveClientItem`, and `cleanClientDescription` ([invoice-parser.service.ts:282-387](doodoo/src/invoice/invoice-parser.service.ts#L282-L387)) with:

```ts
  // An item begins with "{seq}{code}" smashed together at the start of a line,
  // where code is a product code (BS18, BS0112, YN137...) OR "-" for
  // discount/gift pseudo-rows. The rest of the row — name, prices, qty,
  // subtotal — may be on the same line or wrapped across the next lines, up to
  // the next item-start line.
  private static readonly CLIENT_ITEM_START =
    /^(\d+)((?:[A-Z]{1,3}\d{1,4}(?:-\d+)*)|-)(.*)$/;

  private parseClientItemLines(lines: string[]): InvoiceItem[] {
    type Group = { code: string; rest: string[] };
    const groups: Group[] = [];
    let current: Group | null = null;

    for (const line of lines) {
      const m = line.match(InvoiceParserService.CLIENT_ITEM_START);
      if (m) {
        if (current) groups.push(current);
        // m[3] is whatever followed "{seq}{code}" on the same line (often the
        // whole smashed remainder); keep it as the first chunk of this item.
        current = { code: m[2], rest: m[3] ? [m[3]] : [] };
      } else if (current) {
        current.rest.push(line);
      }
    }
    if (current) groups.push(current);

    return groups
      .map((g) => this.resolveClientItem(g.code, g.rest))
      .filter((x): x is InvoiceItem => x !== null);
  }

  // Join the item's chunks and pull the trailing "{unit}{qty}{subtotal}" run.
  // Examples (joined tail -> unit/qty/subtotal):
  //   "...29.90129.90"        -> 29.90 / 1 / 29.90
  //   "...18.00236.00"        -> 18.00 / 2 / 36.00   (multi-qty)
  //   "...49.0029.00129.00"   -> 29.00 / 1 / 29.00   (struck 49.00 left behind)
  //   "...99.0010.00"         -> 99.00 / 1 / 0.00    (gift)
  private resolveClientItem(code: string, rest: string[]): InvoiceItem | null {
    if (!isProductCode(code)) return null; // skip "-", coupons, free gifts

    const joined = rest.join('');
    const isGift = /赠品/.test(joined);

    // unit (decimal) + qty (integer) + subtotal (decimal), anchored at the end.
    // qty is LAZY (\d+?): qty and subtotal are smashed together (e.g. "1"+"29.90"
    // = "129.90"); a greedy qty would steal the subtotal's leading digit (->12 /
    // 9.90). Lazy qty yields the correct 1 / 29.90 for the qty 1-9 range that
    // covers all real rows. (qty >= 10 is inherently ambiguous in this smashed
    // format and does not occur in the data.)
    const tail = joined.match(/(\d+\.\d{2})(\d+?)(\d+\.\d{2})\s*$/);
    let qty = 0;
    let unitPrice: number | undefined;
    let subtotal: number | undefined;
    let descEnd = joined.length;

    if (tail) {
      unitPrice = parseFloat(tail[1]);
      qty = parseInt(tail[2], 10);
      subtotal = parseFloat(tail[3]);
      descEnd = tail.index ?? joined.length;
    }

    return {
      code,
      description: this.cleanClientDescription(joined.slice(0, descEnd)),
      qty,
      unitPrice,
      subtotal,
      isGift,
    };
  }

  // Best-effort human-readable name: take the text before the trailing numbers,
  // drop any leading struck unit price, promo tags, and bracketed annotations.
  private cleanClientDescription(head: string): string {
    return head
      .replace(/^\d+\.\d{2}/, '')                 // a leading struck unit price
      .replace(/[A-Z]{1,3}\d{1,4}(?:-\d+)*\s*买.*$/, '') // "BS0112 买 1 送..."
      .replace(/买\s*\d.*$/, '')                  // "买 4 = RM 99..."
      .replace(/特价|赠品/g, '')                   // promo / gift tags
      .replace(/[（(【][^）)】]*[）)】]/g, '')       // bracketed annotations
      .replace(/\s+/g, ' ')
      .trim();
  }
```

> The static `CLIENT_ITEM_START` is a class field — place it with the other private members. `isProductCode` and the `InvoiceItem` type are already in this file. The `cleanClientDescription` signature changes from `(lines, code)` to `(head)`; no other caller exists.

- [ ] **Step 5: Run to verify pass**

Run: `cd doodoo && npx jest invoice-parser.service.spec --silent`
Expected: PASS — splitter, field, multi-order, and all 7 client-item-row tests green.

- [ ] **Step 6: Commit**

```bash
git add doodoo/src/invoice/invoice-parser.service.ts doodoo/src/invoice/invoice-parser.service.spec.ts
git commit -m "feat(invoice): parse every order in a multi-page PDF, incl. smashed single-line rows"
```

---

## Task 4: Controller flattens per-file order arrays

**Goal:** `parseMarkerFile` now returns `ParsedInvoice[]` per file. The controller must flatten all files' arrays before comparing and persisting.

**Files:**
- Modify: `doodoo/src/invoice/invoice.controller.ts:49-54`

**Acceptance Criteria:**
- [ ] `clientParsed` / `supplierParsed` are flat `ParsedInvoice[]` (not `ParsedInvoice[][]`).
- [ ] `npm run build` in `doodoo/` compiles with no type errors.

**Verify:** `cd doodoo && npm run build` → exits 0.

**Steps:**

- [ ] **Step 1: Flatten the parse results**

Replace ([invoice.controller.ts:49-52](doodoo/src/invoice/invoice.controller.ts#L49-L52)):

```ts
    const [clientParsed, supplierParsed] = await Promise.all([
      Promise.all(clientFiles.map(f => this.parser.parseMarkerFile(f.buffer, decodeName(f.originalname)))),
      Promise.all(supplierFiles.map(f => this.parser.parseMarkerFile(f.buffer, decodeName(f.originalname)))),
    ]);
```

with:

```ts
    const [clientNested, supplierNested] = await Promise.all([
      Promise.all(clientFiles.map(f => this.parser.parseMarkerFile(f.buffer, decodeName(f.originalname)))),
      Promise.all(supplierFiles.map(f => this.parser.parseMarkerFile(f.buffer, decodeName(f.originalname)))),
    ]);
    // Each file can now yield multiple orders (one per page) — flatten to a
    // single list of parsed invoices per side.
    const clientParsed   = clientNested.flat();
    const supplierParsed = supplierNested.flat();
```

- [ ] **Step 2: Build to verify types**

Run: `cd doodoo && npm run build`
Expected: PASS (exit 0). `compareGroups` and `persistComparison` already take `ParsedInvoice[]`, so no further controller change.

- [ ] **Step 3: Commit**

```bash
git add doodoo/src/invoice/invoice.controller.ts
git commit -m "feat(invoice): flatten multi-order parse results in controller"
```

---

## Task 5: Per-order-unique file keying in persistence

**Goal:** `persistComparison` builds `fileIdMap` keyed by `role:filename`. With multiple orders now carrying unique filenames (Task 3 labels them), this works — but harden the line-item loop's role lookup, which uses `Array.includes` on objects, and verify uniqueness so two orders from one file don't collide.

**Files:**
- Modify: `doodoo/src/invoice/database.service.ts:95-107`

**Acceptance Criteria:**
- [ ] Each parsed order maps to its own `invoice_files` row (no key collision) because Task 3 guarantees unique `filename` per order.
- [ ] The line-item role lookup does not rely on `clientParsed.includes(inv)` (ambiguous if a client and supplier order ever share object identity); it iterates the two lists explicitly.
- [ ] `npm run build` compiles.

**Verify:** `cd doodoo && npm run build` → exits 0. (DB insertion is covered end-to-end by Task 6; no live DB is required to build.)

**Steps:**

- [ ] **Step 1: Replace the combined line-item loop**

Replace ([database.service.ts:95-107](doodoo/src/invoice/database.service.ts#L95-L107)):

```ts
      for (const inv of [...clientParsed, ...supplierParsed]) {
        const role = clientParsed.includes(inv) ? 'client' : 'supplier';
        const fileId = fileIdMap[`${role}:${inv.filename}`];
        for (const item of inv.items) {
          await client.query(
            `INSERT INTO invoice_line_items
               (file_id, item_code, description, qty, unit_price, subtotal, is_gift)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [fileId, item.code, item.description, item.qty,
             item.unitPrice ?? null, item.subtotal ?? null, item.isGift ?? false],
          );
        }
      }
```

with:

```ts
      const insertLineItems = async (
        invoices: ParsedInvoice[],
        role: 'client' | 'supplier',
      ) => {
        for (const inv of invoices) {
          const fileId = fileIdMap[`${role}:${inv.filename}`];
          for (const item of inv.items) {
            await client.query(
              `INSERT INTO invoice_line_items
                 (file_id, item_code, description, qty, unit_price, subtotal, is_gift)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [fileId, item.code, item.description, item.qty,
               item.unitPrice ?? null, item.subtotal ?? null, item.isGift ?? false],
            );
          }
        }
      };
      await insertLineItems(clientParsed, 'client');
      await insertLineItems(supplierParsed, 'supplier');
```

- [ ] **Step 2: Build**

Run: `cd doodoo && npm run build`
Expected: PASS (exit 0).

- [ ] **Step 3: Commit**

```bash
git add doodoo/src/invoice/database.service.ts
git commit -m "refactor(invoice): per-order file keying in persistence"
```

---

## Task 6: End-to-end verification with the real files

**Goal:** Prove against the real PDFs that the multi-order file is fully read and the single-order file is unchanged. This is the acceptance gate for the whole feature.

**Files:**
- Use: `doodoo/scripts/dump-pdf-text.ts` is not enough — add a temporary end-to-end check script, then delete it.
- Create (temporary): `doodoo/scripts/check-multi-order.ts`

**Acceptance Criteria:**
- [ ] `7单.pdf` parses to **7** `ParsedInvoice`, customer names = `[Jackie Loh, Kathleen Wong, Leong Sok Ling, Tan Sioh Kieow, Wong Lee Ken, Charmaine Chen, Jessie Ong]`.
- [ ] Order #001920 (Tan Sioh Kieow) shows item `H85` with `qty = 2` (the one row in the batch with qty ≠ 1) — proves quantities are read, not defaulted.
- [ ] `订单 (Goh Kah Huat)#000391.pdf` still parses to **1** order with items `YN137` (qty 1) and `BS100` (qty 1).
- [ ] Full unit suite passes: `npx jest --silent`.

**Verify:** `cd doodoo && npx ts-node scripts/check-multi-order.ts` → prints `OK` with the 7 names and the H85 qty; `npx jest --silent` → all green.

**Steps:**

- [ ] **Step 1: Write the end-to-end check script**

```ts
// doodoo/scripts/check-multi-order.ts  (temporary — delete after verifying)
// Real file locations confirmed in Task 0 (NOT the project root):
//   7单.pdf  -> C:\Users\jiaen\Downloads\7单.pdf
//   Goh file -> C:\Users\jiaen\Documents\AAASumaco-Invoices\订单 (Goh Kah Huat)#000391.pdf
import { readFileSync } from 'fs';
import { InvoiceParserService } from '../src/invoice/invoice-parser.service';

const MULTI = 'C:/Users/jiaen/Downloads/7单.pdf';
const SINGLE = 'C:/Users/jiaen/Documents/AAASumaco-Invoices/订单 (Goh Kah Huat)#000391.pdf';

async function main() {
  const svc = new InvoiceParserService();

  const multi = await svc.parseMarkerFile(readFileSync(MULTI), '7单.pdf');
  console.log('orders:', multi.length);
  console.log('names:', multi.map((o) => o.customerName));
  const tan = multi.find((o) => /Tan Sioh Kieow/i.test(o.customerName));
  const h85 = tan?.items.find((i) => i.code === 'H85');
  console.log('H85 qty (expect 2):', h85?.qty);

  const single = await svc.parseMarkerFile(readFileSync(SINGLE), 'goh.pdf');
  console.log('single orders (expect 1):', single.length,
    single[0].items.map((i) => `${i.code}:${i.qty}`));

  const ok = multi.length === 7 && h85?.qty === 2 && single.length === 1;
  console.log(ok ? 'OK' : 'FAIL');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the real-file check**

Run: `cd doodoo && npx ts-node scripts/check-multi-order.ts`
Expected: `orders: 7`, the 7 names in order, `H85 qty (expect 2): 2`, `single orders (expect 1): 1`, final line `OK`.

(Paths are hardcoded in the script, so the Chinese filename is a JS string and is NOT subject to Git Bash CLI-arg mangling — run the script directly.)

> If any real order's items/qty are still wrong, re-run `scripts/dump-pdf-text.ts` on that file, copy the exact offending line into a new unit test in `invoice-parser.service.spec.ts`, and adjust `resolveClientItem` / `CLIENT_ITEM_START` (Task 3, Step 4) to match. Do NOT guess — the failing real line is the spec.

- [ ] **Step 3: Run the full unit suite**

Run: `cd doodoo && npx jest --silent`
Expected: PASS — all spec files green (new parser specs + existing fashion-index specs untouched).

- [ ] **Step 4: Remove the temporary check script**

```bash
rm doodoo/scripts/check-multi-order.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A doodoo/scripts
git commit -m "test(invoice): verify multi-order parsing end-to-end"
```

---

## Notes for the implementer

- **Supplier/creditor multi-order:** the page-splitter is template-agnostic, so a multi-page supplier PDF is handled by the same `parseMarkerFile` loop — each page routes to `parseSupplierInvoice` via `parseSegment`. If a real multi-order *supplier* sample is available, add a Task-6-style assertion for it; if not, the unit-level coverage of `splitIntoOrders` + the existing supplier item tests are the safety net.
- **No frontend change needed:** `comparison.ts` consumes only `res.comparison` (the aggregated `ItemComparison[]`), whose shape is unchanged. More parsed orders simply feed the existing per-code aggregation; per-order filenames appear in each item's `clientFiles` / `supplierFiles`.
- **`require('pdf-parse')` vs mock:** the service uses `const pdfParse = require('pdf-parse')`. `jest.mock('pdf-parse')` (hoisted) intercepts that require, matching the existing `fi-pdf-parser.spec.ts` pattern.
