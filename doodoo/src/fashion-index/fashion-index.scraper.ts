import { Injectable, Logger } from '@nestjs/common';
import { chromium, BrowserContext, Page } from 'playwright';
import { DoodooOrderItem, FiOrderRow, FiScrapedItem } from './fi.types';

// ── Selectors — update here if site markup changes ───────────────────────────
const FI_URL = 'https://b2b.fashionindex.com.my';
const DOODOO_URL = 'https://www.doodoo520.com/admin';
const FI_ORDERS_NAV = 'nav a:nth-child(2)';
const FI_ORDER_ROW = '.border.rounded.order-row';
const DOODOO_NAV_ORDERS = '#sidebar ul li:nth-child(8) a';
const DOODOO_ORDER_INPUT = '#main-content input[name="order_id"]';
const DOODOO_ORDER_SUBMIT = '#main-content form button[type="submit"]';
const DOODOO_DETAIL_LINK =
  '#main-content > div:nth-child(3) > div:nth-child(2) > div:nth-child(8) a';
const DOODOO_ITEM_ROWS = 'tr[id^="row-"]';

@Injectable()
export class FashionIndexScraper {
  private readonly logger = new Logger(FashionIndexScraper.name);

  async scrapeOrderRows(fiOrderId: string): Promise<FiOrderRow[]> {
    const browser = await chromium.launch({
      headless: process.env['PLAYWRIGHT_HEADFUL'] !== 'true',
    });
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
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    if (!(await page.$('button:has-text("Log Out")'))) {
      throw new Error('Fashion Index login failed');
    }
  }

  private async fetchOrderRows(
    page: Page,
    ctx: BrowserContext,
    fiOrderId: string,
  ): Promise<FiOrderRow[]> {
    const ordersHref = await page.$eval(
      FI_ORDERS_NAV,
      (el: HTMLAnchorElement) => el.href,
    );
    await page.goto(ordersHref);
    await page.waitForLoadState('networkidle');

    await page.fill('input[name="order_id"]', fiOrderId);
    await page.click('form button[type="submit"]');
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
        .$eval(
          'div a[href$=".pdf"], div a[href*="/pdf"]',
          (a: HTMLAnchorElement) => a.href,
        )
        .catch(() => null);

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
    return page.$$eval('div.divide-y > div.flex', (rows: Element[]) =>
      rows
        .map((row) => {
          const texts = Array.from(row.querySelectorAll('*'))
            .map((el) => el.textContent?.trim())
            .filter((t): t is string => !!t && t.length > 0)
            .map((t) => t.replace(/\s+/g, ' '));
          return {
            productCode: texts[1] ?? '',
            productName: texts[0] ?? '',
            qty: parseFloat(texts[5] ?? '0') || 0,
            price: parseFloat(texts[3] ?? '0') || 0,
          };
        })
        .filter((item) => item.productCode.length > 0),
    );
  }

  async scrapeDoodooOrder(doodooOrderId: string): Promise<DoodooOrderItem[]> {
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

      await page.fill(DOODOO_ORDER_INPUT, doodooOrderId);
      await page.click(DOODOO_ORDER_SUBMIT);
      await page.waitForLoadState('networkidle');

      const detailAnchor = await page.$(DOODOO_DETAIL_LINK);
      if (!detailAnchor) {
        this.logger.warn(
          `Doodoo order ${doodooOrderId} not found — no detail link`,
        );
        return [];
      }
      const detailHref = await detailAnchor.getAttribute('href');
      if (!detailHref) return [];

      await page.goto(
        detailHref.startsWith('http')
          ? detailHref
          : `${DOODOO_URL}${detailHref}`,
      );
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
    await page.fill(
      'input[name="username"], input[name="email"]',
      process.env['DOODOO_ADMIN_EMAIL'] ?? '',
    );
    await page.fill(
      'input[name="password"]',
      process.env['DOODOO_ADMIN_PASSWORD'] ?? '',
    );
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
          const cells = Array.from(row.querySelectorAll('td')).map(
            (td) => td.textContent?.trim().replace(/\s+/g, ' ') ?? '',
          );
          return {
            productCode: cells[1] ?? '',
            productName: cells[0] ?? '',
            qty: parseFloat(cells[3] ?? '0') || 0,
            price: parseFloat(cells[2] ?? '0') || 0,
          };
        })
        .filter((item) => item.productCode.length > 0),
    );
  }
}
