import { FiComparisonService } from './fi-comparison.service';
import { FiScrapedItem, DoodooOrderItem } from './fi.types';

describe('FiComparisonService.compare', () => {
  const svc = new FiComparisonService();

  const fi = (code: string, qty: number): FiScrapedItem =>
    ({ productCode: code, productName: `Name ${code}`, qty, price: 10 });

  const doodoo = (code: string, qty: number): DoodooOrderItem =>
    ({ productCode: code, productName: `Name ${code}`, qty, price: 10 });

  it('marks identical code+qty as matched', () => {
    const result = svc.compare([fi('RM-001', 100)], [doodoo('RM-001', 100)]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('matched');
    expect(result[0].fiQty).toBe(100);
    expect(result[0].doodooQty).toBe(100);
  });

  it('marks same code different qty as qty_mismatch', () => {
    const result = svc.compare([fi('RM-001', 100)], [doodoo('RM-001', 80)]);
    expect(result[0].status).toBe('qty_mismatch');
    expect(result[0].fiQty).toBe(100);
    expect(result[0].doodooQty).toBe(80);
  });

  it('marks FI-only items as fi_only with doodooQty 0', () => {
    const result = svc.compare([fi('RM-002', 50)], []);
    expect(result[0].status).toBe('fi_only');
    expect(result[0].doodooQty).toBe(0);
  });

  it('marks doodoo-only items as doodoo_only with fiQty 0', () => {
    const result = svc.compare([], [doodoo('FG-003', 20)]);
    expect(result[0].status).toBe('doodoo_only');
    expect(result[0].fiQty).toBe(0);
  });

  it('handles mixed results correctly', () => {
    const result = svc.compare(
      [fi('RM-001', 100), fi('RM-002', 50)],
      [doodoo('RM-001', 100), doodoo('FG-003', 20)],
    );
    const byCode = Object.fromEntries(result.map(r => [r.productCode, r]));
    expect(byCode['RM-001'].status).toBe('matched');
    expect(byCode['RM-002'].status).toBe('fi_only');
    expect(byCode['FG-003'].status).toBe('doodoo_only');
  });
});
