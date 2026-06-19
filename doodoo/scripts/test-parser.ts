import * as fs from 'fs';
import * as path from 'path';
import 'reflect-metadata';
import { InvoiceParserService } from '../src/invoice/invoice-parser.service';

const svc = new InvoiceParserService();

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx ts-node scripts/test-parser.ts <path-to-pdf>');
  process.exit(1);
}

const resolved = path.resolve(file);
const buffer = fs.readFileSync(resolved);

svc.parseMarkerFile(buffer, path.basename(resolved))
  .then(orders => {
    console.log(JSON.stringify(orders, null, 2));
    // parseMarkerFile now returns one ParsedInvoice per order (multi-page PDFs
    // yield multiple); iterate and summarise each.
    console.log(`\n--- Summary (${orders.length} order(s)) ---`);
    for (const result of orders) {
      console.log(`\nType: ${result.type}`);
      console.log(`Customer: ${result.customerName}`);
      console.log(`Date: ${result.date}`);
      console.log(`Items (${result.items.length}):`);
      for (const item of result.items) {
        console.log(`  ${item.code.padEnd(12)} qty=${item.qty}  ${item.description}`);
      }
    }
  })
  .catch(err => {
    console.error('Parse error:', err.message);
    process.exit(1);
  });
