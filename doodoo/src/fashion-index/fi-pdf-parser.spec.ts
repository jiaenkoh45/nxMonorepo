import { extractOrderIdFromPdf } from './fi-pdf-parser';
import pdfParse from 'pdf-parse';

jest.mock('pdf-parse');
const mockPdfParse = pdfParse as jest.MockedFunction<typeof pdfParse>;

describe('extractOrderIdFromPdf', () => {
  it('extracts order ID from Content:#XXXXXX pattern', async () => {
    mockPdfParse.mockResolvedValueOnce({
      text: 'Shipping Info\nContent:#000412\nAddress: KL',
    } as any);
    const result = await extractOrderIdFromPdf(Buffer.from('fake-pdf'));
    expect(result).toBe('000412');
  });

  it('returns null when pattern is absent', async () => {
    mockPdfParse.mockResolvedValueOnce({
      text: 'Shipping Info\nNo order here',
    } as any);
    const result = await extractOrderIdFromPdf(Buffer.from('fake-pdf'));
    expect(result).toBeNull();
  });

  it('handles whitespace between Content: and #', async () => {
    mockPdfParse.mockResolvedValueOnce({
      text: 'Content: #000999',
    } as any);
    const result = await extractOrderIdFromPdf(Buffer.from('fake-pdf'));
    expect(result).toBe('000999');
  });

  it('extracts only digits after #', async () => {
    mockPdfParse.mockResolvedValueOnce({
      text: 'Content:#001234 extra text',
    } as any);
    const result = await extractOrderIdFromPdf(Buffer.from('fake-pdf'));
    expect(result).toBe('001234');
  });
});
