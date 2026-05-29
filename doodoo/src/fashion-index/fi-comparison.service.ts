import { Injectable } from '@nestjs/common';
import { DoodooOrderItem, FiItemComparison, FiScrapedItem } from './fi.types';

@Injectable()
export class FiComparisonService {
  compare(fiItems: FiScrapedItem[], doodooItems: DoodooOrderItem[]): FiItemComparison[] {
    const results: FiItemComparison[] = [];
    const doodooMap = new Map(doodooItems.map(i => [i.productCode, i]));
    const usedCodes = new Set<string>();

    for (const fi of fiItems) {
      const doodoo = doodooMap.get(fi.productCode);
      usedCodes.add(fi.productCode);
      if (!doodoo) {
        results.push({
          productCode: fi.productCode,
          productName: fi.productName,
          fiQty: fi.qty,
          doodooQty: 0,
          status: 'fi_only',
        });
      } else {
        results.push({
          productCode: fi.productCode,
          productName: fi.productName,
          fiQty: fi.qty,
          doodooQty: doodoo.qty,
          status: fi.qty === doodoo.qty ? 'matched' : 'qty_mismatch',
        });
      }
    }

    for (const d of doodooItems) {
      if (!usedCodes.has(d.productCode)) {
        results.push({
          productCode: d.productCode,
          productName: d.productName,
          fiQty: 0,
          doodooQty: d.qty,
          status: 'doodoo_only',
        });
      }
    }

    return results;
  }
}
