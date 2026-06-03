import { FashionIndexScraper } from './fashion-index.scraper';

jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import { chromium } from 'playwright';

describe('FashionIndexScraper.scrapeAllOrderRows', () => {
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
    await expect(scraper.scrapeAllOrderRows(['FI-123'])).rejects.toThrow('Fashion Index login failed');
  });
});

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
    mockPage.$eval.mockResolvedValueOnce('https://doodoo520.com/admin/orders');
    mockPage.$.mockResolvedValueOnce(null);
    mockPage.$$eval.mockResolvedValueOnce([]);
    const result = await scraper.scrapeDoodooOrder('000412');
    expect(result).toEqual([]);
  });
});
