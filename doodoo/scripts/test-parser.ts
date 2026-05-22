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
  .then(result => {
    console.log(JSON.stringify(result, null, 2));
    console.log(`\n--- Summary ---`);
    console.log(`Type: ${result.type}`);
    console.log(`Customer: ${result.customerName}`);
    console.log(`Date: ${result.date}`);
    console.log(`Items (${result.items.length}):`);
    for (const item of result.items) {
      console.log(`  ${item.code.padEnd(12)} qty=${item.qty}  ${item.description}`);
    }
  })
  .catch(err => {
    console.error('Parse error:', err.message);
    process.exit(1);
  });
