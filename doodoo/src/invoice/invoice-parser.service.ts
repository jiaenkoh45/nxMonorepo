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
  ): Promise<ParsedInvoice> {
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

    const isClient = /LIVE\s+ORDER|名字\s*[：:]/i.test(textContent);
    const isSupplier =
      /INVOICE/i.test(textContent) && /UNIT/i.test(textContent);

    if (isClient) {
      return this.parseClientInvoice(textContent, filename, jpegBase64);
    } else if (isSupplier) {
      return this.parseSupplierInvoice(textContent, filename, jpegBase64);
    } else {
      const fallback = this.parseSupplierInvoice(
        textContent,
        filename,
        jpegBase64,
      );
      if (fallback.items.length > 0) return fallback;
      throw new Error(`Cannot determine invoice type for: ${filename}`);
    }
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

    const nameMatch = text.match(/名字\s*[：:]\s*(.+)/);
    const customerName = nameMatch
      ? nameMatch[1].trim()
      : this.extractFallbackName(text);

    const billMatch = text.match(/BILL\s*[：:]\s*#?(\S+)/i);
    const orderNo = billMatch ? billMatch[1] : '';

    const dateMatch = text.match(/DATE\s*[：:]\s*(\S+)/i);
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

  // Each item in the client invoice begins with a line that smashes
  // sequence number and product code together — e.g. "1H73", "3ZH26", "4MC11".
  private parseClientItemLines(lines: string[]): InvoiceItem[] {
    const itemStartRe = /^(\d+)([A-Z]{1,3}\d{1,4}(?:-\d+)*)$/;
    type Group = { seqNo: number; code: string; lines: string[] };
    const groups: Group[] = [];
    let current: Group | null = null;

    for (const line of lines) {
      const m = line.match(itemStartRe);
      if (m && isProductCode(m[2])) {
        if (current) groups.push(current);
        current = { seqNo: parseInt(m[1]), code: m[2], lines: [] };
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) groups.push(current);

    return groups
      .map((g) => this.resolveClientItem(g))
      .filter((x): x is InvoiceItem => x !== null);
  }

  // Resolve qty / subtotal / unit price from the smashed-together numeric lines.
  // The trailing line of an item is one of:
  //   (B) "{unit}{qty}{subtotal}"  e.g. "27.00127.00"  (no separate price line preceded)
  //   (A) "{qty}{subtotal}"        e.g. "374.70"        (price line(s) preceded)
  private resolveClientItem(g: {
    code: string;
    lines: string[];
  }): InvoiceItem | null {
    const { code, lines } = g;
    const isGift = lines.some((l) => l.includes('赠品'));

    // Stricter (B) tried first; numeric-only lines preserve order.
    const unitQtySubRe = /^(\d+\.\d{2})(\d+?)(\d+\.\d{2})$/;
    const qtySubRe = /^(\d+?)(\d+\.\d{2})$/;

    let qty = 0;
    let unitPrice: number | undefined;
    let subtotal: number | undefined;

    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!/^[\d.]+$/.test(l)) continue;

      const mB = l.match(unitQtySubRe);
      if (mB) {
        unitPrice = parseFloat(mB[1]);
        qty = parseInt(mB[2]);
        subtotal = parseFloat(mB[3]);
        break;
      }
      const mA = l.match(qtySubRe);
      if (mA) {
        qty = parseInt(mA[1]);
        subtotal = parseFloat(mA[2]);
        // The most-recent preceding numeric-only line is the discounted unit price.
        for (let j = i - 1; j >= 0; j--) {
          if (/^\d+\.\d{2}$/.test(lines[j])) {
            unitPrice = parseFloat(lines[j]);
            break;
          }
        }
        break;
      }
    }

    return {
      code,
      description: this.cleanClientDescription(lines, code),
      qty,
      unitPrice,
      subtotal,
      isGift,
    };
  }

  // Descriptions may wrap across multiple lines in the PDF. Collect consecutive
  // text lines, strip any trailing promotion/gift suffix, and join (no separator —
  // these are wrap continuations, not separate words).
  private cleanClientDescription(lines: string[], _code: string): string {
    const codeBuyRe = /\s*[A-Z]{1,3}\d{1,4}(?:-\d+)*\s+买.+$/;
    const buyOnlyRe = /\s*买\s*\d.+$/;
    const giftSuffixRe = /\s*赠品\s*\(?[^)]*\)?\s*$/i;

    const parts: string[] = [];
    for (const l of lines) {
      if (/^[\d.]+$/.test(l)) break; // pure numeric → end of desc
      if (l === '赠品' || /^赠品\s*\(/.test(l)) break; // gift label alone
      if (/^[A-Z]{1,3}\d{1,4}(?:-\d+)*\s+买/.test(l)) break; // pure promotion line
      if (/^买\s*\d/.test(l)) break;
      if (!/[一-龥]/.test(l)) continue; // require Chinese chars

      const cleaned = l
        .replace(codeBuyRe, '')
        .replace(buyOnlyRe, '')
        .replace(giftSuffixRe, '')
        .trim();
      if (cleaned) parts.push(cleaned);

      // A stripped suffix means this was the final line of the description.
      if (cleaned !== l.trim()) break;
    }

    return parts.join('').trim();
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
      text.match(/名字[ \t]*[：:][ \t]*([^\n\r]+)/);
    return m ? m[1].trim() : 'Unknown';
  }
}
