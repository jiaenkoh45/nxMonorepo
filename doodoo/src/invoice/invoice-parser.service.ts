import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvoiceItem {
  code: string;
  description: string;
  qty: number;
  unitPrice?: number;
  subtotal?: number;
  discount?: string;
  isGift: boolean;
}

export interface ParsedInvoice {
  type: 'client' | 'supplier';
  filename: string;
  customerName: string;
  orderNo?: string;
  invoiceNo?: string;
  date: string;
  items: InvoiceItem[];
  jpegBase64: string | null;
}

export interface ItemComparison {
  code: string;
  description: string;
  clientQty: number;
  supplierQty: number;
  clientSubtotal: number;
  supplierSubtotal: number;
  match: boolean;
  clientFiles: Array<{
    filename: string;
    qty: number;
    customerName: string;
    unitPrice?: number;
    subtotal?: number;
  }>;
  supplierFiles: Array<{
    filename: string;
    qty: number;
    customerName: string;
    unitPrice?: number;
    subtotal?: number;
    discount?: string;
  }>;
}

// ─── Item code whitelist ──────────────────────────────────────────────────────

const PRODUCT_CODE_RE = /^[A-Z]{1,3}\d{1,4}(?:-\d+)*$/;
const SKIP_CODES = new Set(['ATTN', 'PACKAGE', 'FEE', 'NOTE', 'REMARK']);

function isProductCode(code: string): boolean {
  if (SKIP_CODES.has(code.toUpperCase())) return false;
  return PRODUCT_CODE_RE.test(code);
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class InvoiceParserService {
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
      // Keep any segment that was recognized as a real order (parseSegment
      // returns null for unrecognized/empty fragments). A recognized order may
      // legitimately contain zero *product* rows (e.g. only a discount coupon),
      // so we do NOT require items.length > 0 here.
      if (parsed) orders.push(parsed);
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

  compareGroups(
    clientGroup: ParsedInvoice[],
    supplierGroup: ParsedInvoice[],
  ): ItemComparison[] {
    type ClientFileEntry = {
      filename: string;
      qty: number;
      customerName: string;
      unitPrice?: number;
      subtotal?: number;
    };
    type SupplierFileEntry = {
      filename: string;
      qty: number;
      customerName: string;
      unitPrice?: number;
      subtotal?: number;
      discount?: string;
    };
    type AggEntry<F> = {
      code: string;
      description: string;
      totalQty: number;
      totalSubtotal: number;
      files: F[];
    };

    const aggregateClient = (invoices: ParsedInvoice[]) => {
      const map = new Map<string, AggEntry<ClientFileEntry>>();
      for (const inv of invoices) {
        for (const item of inv.items) {
          if (!map.has(item.code)) {
            map.set(item.code, {
              code: item.code,
              description: item.description,
              totalQty: 0,
              totalSubtotal: 0,
              files: [],
            });
          }
          const entry = map.get(item.code)!;
          entry.totalQty += item.qty;
          entry.totalSubtotal += item.subtotal ?? 0;
          entry.files.push({
            filename: inv.filename,
            qty: item.qty,
            customerName: inv.customerName,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
          });
        }
      }
      return map;
    };

    const aggregateSupplier = (invoices: ParsedInvoice[]) => {
      const map = new Map<string, AggEntry<SupplierFileEntry>>();
      for (const inv of invoices) {
        for (const item of inv.items) {
          if (!map.has(item.code)) {
            map.set(item.code, {
              code: item.code,
              description: item.description,
              totalQty: 0,
              totalSubtotal: 0,
              files: [],
            });
          }
          const entry = map.get(item.code)!;
          entry.totalQty += item.qty;
          entry.totalSubtotal += item.subtotal ?? 0;
          entry.files.push({
            filename: inv.filename,
            qty: item.qty,
            customerName: inv.customerName,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            discount: item.discount,
          });
        }
      }
      return map;
    };

    const clientMap = aggregateClient(clientGroup);
    const supplierMap = aggregateSupplier(supplierGroup);
    const allCodes = new Set([...clientMap.keys(), ...supplierMap.keys()]);

    const results: ItemComparison[] = [];
    for (const code of allCodes) {
      const c = clientMap.get(code);
      const s = supplierMap.get(code);

      const clientQty = c?.totalQty ?? 0;
      const supplierQty = s?.totalQty ?? 0;
      const clientSubtotal = c?.totalSubtotal ?? 0;
      const supplierSubtotal = s?.totalSubtotal ?? 0;
      const match = clientQty === supplierQty;

      results.push({
        code,
        description: c?.description || s?.description || '',
        clientQty,
        supplierQty,
        clientSubtotal,
        supplierSubtotal,
        match,
        clientFiles: c?.files ?? [],
        supplierFiles: s?.files ?? [],
      });
    }

    return results.sort((a, b) => {
      if (a.match !== b.match) return a.match ? 1 : -1;
      return a.code.localeCompare(b.code);
    });
  }

  // ─── Client invoice parser ──────────────────────────────────────────────────

  private parseClientInvoice(
    text: string,
    filename: string,
    jpegBase64: string | null,
  ): ParsedInvoice {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // Name: old template "名字: NAME"; new template "收货人： NAME 电话： ..."
    // (stop before the trailing phone field or an opening bracket).
    const nameMatch =
      text.match(/名字\s*[：:]\s*([^\n\r]+)/) ||
      text.match(/收货人\s*[：:]\s*([^\n\r（(]+?)(?:\s*电话|\s*[（(]|\s*$)/m);
    const customerName = nameMatch
      ? nameMatch[1].trim()
      : this.extractFallbackName(text);

    // Bill: "BILL: #000391" or "BILL #001952" or "BILL" then "#001952" on the
    // next line (colon optional, # optional; \s* crosses the newline).
    const billMatch = text.match(/BILL\s*[：:]?\s*#?\s*(\d+)/i);
    const orderNo = billMatch ? billMatch[1] : '';

    // Date: capture the calendar date in either ISO (2026-04-22) or
    // dd-mm-yyyy (16-06-2026) form — the new template prefixes a clock time.
    const dateMatch =
      text.match(/\b(\d{4}-\d{2}-\d{2})\b/) ||
      text.match(/\b(\d{2}-\d{2}-\d{4})\b/);
    const date = dateMatch ? dateMatch[1] : '';

    // pdf-parse splits the table header into one line like
    // "序号代码照片产品名称 (Product)单价 (RM)数量 (Qty)小计 (RM)" (no spaces)
    const headerIdx = lines.findIndex(
      (l) =>
        l.includes('序号') && (l.includes('产品名称') || l.includes('数量')),
    );
    const endIdx = lines.findIndex(
      (l, i) =>
        i > headerIdx &&
        (l.includes('备注') || l.includes('总额') || l.includes('Subtotal')),
    );

    const tableLines = lines.slice(
      headerIdx >= 0 ? headerIdx + 1 : 0,
      endIdx > 0 ? endIdx : lines.length,
    );

    const items = this.parseClientItemLines(tableLines);

    return {
      type: 'client',
      filename,
      customerName,
      orderNo,
      date,
      items,
      jpegBase64,
    };
  }

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

  // ─── Supplier invoice parser ────────────────────────────────────────────────

  private parseSupplierInvoice(
    text: string,
    filename: string,
    jpegBase64: string | null,
  ): ParsedInvoice {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const invMatch =
      text.match(/\b(IV-\d+)\b/) ||
      text.match(/INV(?:OICE)?[\s.]*NO\.?\s*[:#]?\s*([A-Z0-9-]{4,})/i);
    const invoiceNo = invMatch ? (invMatch[1] ?? invMatch[0]) : '';

    const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
    const date = dateMatch ? dateMatch[1] : '';

    // Skip the bare "Attn :" header; capture the trailing "ATTN :NAME (phone)" line.
    // Use [ \t]* (not \s*) so the regex doesn't jump across the newline and grab "24.90" from the next line.
    const attnMatches = [...text.matchAll(/ATTN[ \t]*[：:][ \t]*([^\n(]+)/gi)];
    const namedAttn = attnMatches.find((m) => m[1].trim().length > 0);
    const customerName = namedAttn
      ? namedAttn[1].trim()
      : this.extractFallbackName(text);

    const items = this.parseSupplierItemLines(lines);

    return {
      type: 'supplier',
      filename,
      customerName,
      invoiceNo,
      date,
      items,
      jpegBase64,
    };
  }

  // Each item in the supplier invoice ends with a smashed line like
  //   "4.00UNIT69.72130%H73"  →  qty=4.00, amount=69.72, seqNo=1, discount=30%, code=H73
  // The pdf-parse layout for each item is consistent:
  //   line i-2: "{unitPrice}"          e.g. "24.90"
  //   line i-1: "{description}"        e.g. "竹盐陈皮 200克"
  //   line i:   "{qty}UNIT{...}{code}" e.g. "4.00UNIT69.72130%H73"
  private parseSupplierItemLines(lines: string[]): InvoiceItem[] {
    const items: InvoiceItem[] = [];
    const itemRe =
      /^(\d+\.\d{2})UNIT(\d+\.\d{2})(\d+?)(\d{1,3}%)([A-Z]{1,3}\d{1,4}(?:-\d+)*)$/;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(itemRe);
      if (!m) continue;

      const code = m[5];
      if (!isProductCode(code)) continue;

      const descLine = (lines[i - 1] ?? '').trim();
      const priceLine = (lines[i - 2] ?? '').trim();

      const description = descLine
        .replace(new RegExp(`^${code}\\s*`), '')
        .replace(/【[^】]*】/g, '')
        .trim();

      const unitPrice = /^\d+\.\d{2}$/.test(priceLine)
        ? parseFloat(priceLine)
        : 0;

      items.push({
        code,
        description,
        qty: parseFloat(m[1]),
        unitPrice,
        subtotal: parseFloat(m[2]),
        discount: m[4],
        isGift: false,
      });
    }

    return items;
  }

  // ─── Shared helpers ─────────────────────────────────────────────────────────

  private extractFallbackName(text: string): string {
    const m =
      text.match(/ATTN[ \t]*[：:][ \t]*([^\n\r]+)/i) ||
      text.match(/名字[ \t]*[：:][ \t]*([^\n\r]+)/) ||
      text.match(/收货人[ \t]*[：:][ \t]*([^\n\r（(电]+)/);
    return m ? m[1].trim() : 'Unknown';
  }

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
}
