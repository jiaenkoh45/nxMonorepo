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
