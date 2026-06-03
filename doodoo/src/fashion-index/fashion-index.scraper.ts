import { Injectable, Logger } from '@nestjs/common';
import { chromium, Page } from 'playwright';
import { DoodooOrderItem, FiOrderRow, FiScrapedItem } from './fi.types';

// ── Selectors — update here if site markup changes ───────────────────────────
const FI_URL = 'https://b2b.fashionindex.com.my';
const DOODOO_URL = 'https://www.doodoo520.com/admin';
const DOODOO_ORIGIN = 'https://www.doodoo520.com';
const FI_ORDERS_NAV = 'nav a:nth-of-type(2)';
const FI_ORDER_ROW = '.border.rounded.order-row';
const DOODOO_NAV_ORDERS = '#sidebar ul li:nth-child(8) a';
const DOODOO_ORDER_INPUT = 'input[name="search"]';
const DOODOO_ORDER_SUBMIT = 'button.search-btn';
const DOODOO_DETAIL_LINK = 'a.btn-action.btn-outline[title="查看明细/修改"]';
const DOODOO_ITEM_ROWS = 'tr[id^="row-"]';

@Injectable()
export class FashionIndexScraper {
  private readonly logger = new Logger(FashionIndexScraper.name);

  async scrapeAllOrderRows(fiOrderIds: string[]): Promise<FiOrderRow[]> {
    if (fiOrderIds.length === 0) return [];
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

  private async loginFashionIndex(page: Page): Promise<void> {
    await page.goto(`${FI_URL}/login`);
    await page.waitForLoadState('networkidle');
    await page.fill('input[name="email"]', process.env['FI_EMAIL'] ?? '');
    await page.fill('input[name="password"]', process.env['FI_PASSWORD'] ?? '');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle', { timeout: 5_000 });
    if (!(await page.$('button:has-text("Log Out")'))) {
      throw new Error('Fashion Index login failed');
    }
  }

  private async fetchOrderRows(
    page: Page,
    fiOrderId: string,
  ): Promise<FiOrderRow[]> {
    const ordersHref = await page.$eval(
      FI_ORDERS_NAV,
      (el: HTMLAnchorElement) => el.href,
    );
    await page.goto(ordersHref);
    await page.waitForLoadState('networkidle');

    await page.fill('input[name="order_id"]', fiOrderId);
    await page.click('button:has-text("Search")');
    await page.waitForLoadState('networkidle');

    const rowLinks = await page.$$eval(
      `${FI_ORDER_ROW} a[href]`,
      (anchors: HTMLAnchorElement[]) => [
        ...new Set(anchors.map((a) => a.href)),
      ],
    );

    const rows: FiOrderRow[] = [];
    for (let i = 0; i < rowLinks.length; i++) {
      await page.goto(rowLinks[i]);
      await page.waitForLoadState('networkidle');

      const items = await this.scrapeItemsFromPage(page);
      const pdfUrl = await page
        .$eval('a:has-text("Airwaybill")', (a: HTMLAnchorElement) => a.href)
        .catch(() => null);

      let pdfBuffer = Buffer.alloc(0);
      if (pdfUrl) {
        const response = await page.request.get(pdfUrl);
        const body = Buffer.from(await response.body());
        if (body.subarray(0, 4).toString('ascii') === '%PDF') {
          pdfBuffer = body;
        } else {
          this.logger.warn(
            `Airwaybill URL returned non-PDF (status ${response.status()}, starts with: ${body.subarray(0, 50).toString('utf8').replace(/\n/g, ' ')}) for FI order ${fiOrderId} row ${i}`,
          );
        }
      } else {
        this.logger.warn(
          `No Airwaybill link found for FI order ${fiOrderId} row ${i}`,
        );
      }

      rows.push({ fiOrderId, rowIndex: i, items, pdfBuffer });
    }

    return rows;
  }

  private async scrapeItemsFromPage(page: Page): Promise<FiScrapedItem[]> {
    return page.$$eval('div.divide-y > div.flex', (rows: Element[]) =>
      rows
        .map((row) => {
          // Product code: gray span inside the name block
          const codeEl = row.querySelector('span.text-xs.text-gray-600');
          const productCode = codeEl?.textContent?.trim() ?? '';

          // Product name: bare text nodes in the same div as the code span
          const nameContainer = codeEl?.parentElement;
          let productName = '';
          if (nameContainer) {
            productName = Array.from(nameContainer.childNodes)
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => n.textContent?.trim() ?? '')
              .filter((t) => t.length > 0)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
          }

          // Price [0], Qty [1], Subtotal [2] — in DOM order
          const valueDivs = Array.from(
            row.querySelectorAll('.text-center.py-1'),
          );
          const rawPrice =
            valueDivs[0]?.textContent?.trim().replace(/[^\d.]/g, '') ?? '0';
          const price = parseFloat(rawPrice) || 0;
          const qty = parseFloat(valueDivs[1]?.textContent?.trim() ?? '0') || 0;

          const rawTexts = valueDivs.map((d) => d.textContent?.trim() ?? '');

          return { productCode, productName, qty, price, rawTexts };
        })
        .filter((item) => item.productCode.length > 0),
    );
  }

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

  private async loginDoodoo(page: Page): Promise<void> {
    await page.goto(`${DOODOO_URL}/login`);
    await page.waitForLoadState('networkidle');
    await page.fill('#username', process.env['DOODOO_ADMIN_EMAIL'] ?? '');
    await page.fill('#password', process.env['DOODOO_ADMIN_PASSWORD'] ?? '');
    await page.click('button[type="submit"]');
    try {
      await page.waitForSelector('.nav-text', { timeout: 10_000 });
    } catch {
      throw new Error('Doodoo520 login failed');
    }
  }

  private async scrapeDoodooItemRows(page: Page): Promise<DoodooOrderItem[]> {
    return page.$$eval(DOODOO_ITEM_ROWS, (rows: Element[]) =>
      rows
        .map((row) => {
          const productName =
            row
              .querySelector('.product-name')
              ?.textContent?.trim()
              .replace(/\s+/g, ' ') ?? '';

          const rawMeta =
            row
              .querySelector('.product-meta')
              ?.textContent?.trim()
              .replace(/\s+/g, ' ') ?? '';
          const productCode = rawMeta.split('|')[0].trim().replace(/-\d+$/, '');

          const qtyInput = row.querySelector('input.qty-input');
          const qty = parseFloat(qtyInput?.getAttribute('value') ?? '0') || 0;
          const price =
            parseFloat(qtyInput?.getAttribute('data-price') ?? '0') || 0;

          const rawCells = [
            productName,
            productCode,
            String(price),
            String(qty),
          ];

          return { productCode, productName, qty, price, rawCells };
        })
        .filter((item) => item.productCode.length > 0),
    );
  }
}
