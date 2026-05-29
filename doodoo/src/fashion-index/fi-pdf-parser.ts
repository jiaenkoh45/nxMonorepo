import pdfParse from 'pdf-parse';

export async function extractOrderIdFromPdf(
  buffer: Buffer,
): Promise<string | null> {
  const data = await pdfParse(buffer);
  const text = data.text as string;
  const match = text.match(/Content:\s*#(\d+)/i);
  return match ? match[1] : null;
}
