import { FashionIndexService } from './fashion-index.service';
import { FashionIndexScraper } from './fashion-index.scraper';
import { FiComparisonService } from './fi-comparison.service';
import { extractOrderIdFromPdf } from './fi-pdf-parser';
import { DatabaseService } from '../invoice/database.service';

jest.mock('./fashion-index.scraper');
jest.mock('./fi-pdf-parser');
jest.mock('../invoice/database.service');

const mockExtract = extractOrderIdFromPdf as jest.MockedFunction<typeof extractOrderIdFromPdf>;

describe('FashionIndexService', () => {
  let service: FashionIndexService;
  let scraper: jest.Mocked<FashionIndexScraper>;
  let db: jest.Mocked<DatabaseService>;

  beforeEach(() => {
    scraper = new FashionIndexScraper() as jest.Mocked<FashionIndexScraper>;
    db = new DatabaseService() as jest.Mocked<DatabaseService>;
    service = new FashionIndexService(scraper, new FiComparisonService(), db);
  });

  it('startJob returns a UUID string immediately', () => {
    scraper.scrapeOrderRows = jest.fn().mockResolvedValue([]);
    const jobId = service.startJob(['FI-123']);
    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);
  });

  it('job reaches done status after successful pipeline', async () => {
    const pdfBuffer = Buffer.from('fake');
    scraper.scrapeOrderRows = jest.fn().mockResolvedValue([
      { fiOrderId: 'FI-123', rowIndex: 0, items: [{ productCode: 'RM-001', productName: 'Item', qty: 10, price: 5 }], pdfBuffer },
    ]);
    mockExtract.mockResolvedValue('000412');
    scraper.scrapeDoodooOrder = jest.fn().mockResolvedValue([
      { productCode: 'RM-001', productName: 'Item', qty: 10, price: 5 },
    ]);
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
      release: jest.fn(),
    };
    db.connect = jest.fn().mockResolvedValue(mockClient);

    const jobId = service.startJob(['FI-123']);
    await new Promise(r => setTimeout(r, 100));
    const job = service.getJob(jobId);
    expect(job?.status).toBe('done');
    expect(job?.result?.pairs).toHaveLength(1);
    expect(job?.result?.pairs[0].pairStatus).toBe('compared');
  });

  it('job reaches error status when scraper throws', async () => {
    scraper.scrapeOrderRows = jest.fn().mockRejectedValue(new Error('Fashion Index login failed'));

    const jobId = service.startJob(['FI-123']);
    await new Promise(r => setTimeout(r, 100));
    const job = service.getJob(jobId);
    expect(job?.status).toBe('error');
    expect(job?.error).toContain('Fashion Index login failed');
  });

  it('marks row as unlinked when PDF buffer is empty', async () => {
    scraper.scrapeOrderRows = jest.fn().mockResolvedValue([
      { fiOrderId: 'FI-123', rowIndex: 0, items: [], pdfBuffer: Buffer.alloc(0) },
    ]);
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
      release: jest.fn(),
    };
    db.connect = jest.fn().mockResolvedValue(mockClient);

    const jobId = service.startJob(['FI-123']);
    await new Promise(r => setTimeout(r, 100));
    const job = service.getJob(jobId);
    expect(job?.status).toBe('done');
    expect(job?.result?.pairs[0].pairStatus).toBe('unlinked');
  });
});
