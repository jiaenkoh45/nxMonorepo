export interface FiScrapedItem {
  productCode: string;
  productName: string;
  qty: number;
  price: number;
  rawTexts?: string[];
}

export interface FiOrderRow {
  fiOrderId: string;
  rowIndex: number;
  orderNumber: string;
  items: FiScrapedItem[];
  pdfBuffer: Buffer;
}

export interface DoodooOrderItem {
  productCode: string;
  productName: string;
  qty: number;
  price: number;
  rawCells?: string[];
}

export type FiItemStatus =
  | 'matched'
  | 'qty_mismatch'
  | 'fi_only'
  | 'doodoo_only';
export type FiPairStatus = 'compared' | 'unlinked' | 'doodoo_not_found';

export interface FiItemComparison {
  productCode: string;
  productName: string;
  fiQty: number;
  doodooQty: number;
  status: FiItemStatus;
}

export interface FiOrderPairResult {
  fiOrderId: string;
  orderNumber: string;
  rowIndex: number;
  doodooOrderId: string | null;
  pairStatus: FiPairStatus;
  items: FiItemComparison[];
}

export interface FiComparisonResult {
  pairs: FiOrderPairResult[];
  totalPairs: number;
  mismatchCount: number;
}

export type FiJobStatus = 'running' | 'done' | 'error';

export interface FiJob {
  status: FiJobStatus;
  message: string;
  result?: FiComparisonResult;
  error?: string;
}
