// doodoo/scripts/dump-pdf-text.ts
/* One-off: dump real pdf-parse output so we can see page boundaries and the
   exact (possibly whitespace-smashed) line layout. Not imported by the app. */
import { readFileSync } from 'fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: ts-node scripts/dump-pdf-text.ts <file.pdf>');
    process.exit(1);
  }
  const data = await pdfParse(readFileSync(path));
  console.log('===== numpages:', data.numpages, '=====');
  console.log('===== RAW TEXT =====');
  console.log(data.text);
  console.log('===== LINES (JSON) =====');
  console.log(JSON.stringify(data.text.split('\n'), null, 1));
  const pages = data.text.split(/\n{2,}/).filter((s: string) => s.trim());
  console.log('===== PAGE-SPLIT CHUNK COUNT:', pages.length, '=====');
}
main().catch((e) => { console.error(e); process.exit(1); });
