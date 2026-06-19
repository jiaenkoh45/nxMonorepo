import { InvoiceParserService } from './invoice-parser.service';
import pdfParse from 'pdf-parse';
jest.mock('pdf-parse');
const mockPdfParse = pdfParse as jest.MockedFunction<typeof pdfParse>;

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

describe('InvoiceParserService header fields (both templates)', () => {
  const svc = new InvoiceParserService();

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

describe('InvoiceParserService.parseMarkerFile (multi-order)', () => {
  const svc = new InvoiceParserService();

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

describe('InvoiceParserService supplier invoice (real smashed forms)', () => {
  const svc = new InvoiceParserService();

  // Mirrors the actual pdf-parse output of a real supplier invoice
  // (IV-26060031): the invoice number is smashed against "INVOICE" with no
  // separator, and item #4 (YZ2) has a blank Discount column, so its row has
  // no trailing "%" segment.
  const SUPPLIER_TEXT =
    'IV-26060031INVOICE\n' +
    'SUMACO TRADE SDN BHD\n' +
    'Date \nC.O.D.\n16/06/2026\n' +
    'NoDescriptionQtyItem CodeDiscountPrice/Unit\nAmount\n' +
    'Attn :\n' +
    '45.00\n党参 100克\n1.00UNIT31.50130%BZ25\n' +
    '23.00\nYZ2【药妆代购】玻璃酸钠滴眼液 OSM 10ml\n1.00UNIT23.004YZ2\n' +
    'ATTN :  Tan Sioh Kieow\n8\n' +
    'Total (RM)102.53';

  it('extracts the invoice number when smashed against the INVOICE title', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: SUPPLIER_TEXT } as any);
    const [inv] = await svc.parseMarkerFile(Buffer.from('x'), 'iv.pdf');
    expect(inv.invoiceNo).toBe('IV-26060031');
  });

  it('parses an item row that has no discount column', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: SUPPLIER_TEXT } as any);
    const [inv] = await svc.parseMarkerFile(Buffer.from('x'), 'iv.pdf');
    const yz2 = inv.items.find((i) => i.code === 'YZ2');
    expect(yz2).toEqual(
      expect.objectContaining({ qty: 1, unitPrice: 23, subtotal: 23 }),
    );
    expect(yz2?.discount).toBeUndefined();
  });

  it('still parses a discounted row correctly (regression)', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: SUPPLIER_TEXT } as any);
    const [inv] = await svc.parseMarkerFile(Buffer.from('x'), 'iv.pdf');
    const bz25 = inv.items.find((i) => i.code === 'BZ25');
    expect(bz25).toEqual(
      expect.objectContaining({ qty: 1, unitPrice: 45, subtotal: 31.5, discount: '30%' }),
    );
  });
});
