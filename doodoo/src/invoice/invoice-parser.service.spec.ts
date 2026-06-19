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
