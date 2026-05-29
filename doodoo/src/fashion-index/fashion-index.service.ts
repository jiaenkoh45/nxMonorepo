import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { extractOrderIdFromPdf } from './fi-pdf-parser';
import { FashionIndexScraper } from './fashion-index.scraper';
import { FiComparisonService } from './fi-comparison.service';
import { DatabaseService } from '../invoice/database.service';
import {
  FiComparisonResult,
  FiJob,
  FiOrderPairResult,
} from './fi.types';

@Injectable()
export class FashionIndexService {
  private readonly logger = new Logger(FashionIndexService.name);
  private readonly jobs = new Map<string, FiJob>();

  constructor(
    private readonly scraper: FashionIndexScraper,
    private readonly comparison: FiComparisonService,
    private readonly db: DatabaseService,
  ) {}

  startJob(fiOrderIds: string[]): string {
    const jobId = randomUUID();
    const job: FiJob = { status: 'running', message: 'Starting…' };
    this.jobs.set(jobId, job);
    this.runPipeline(jobId, fiOrderIds).catch(() => {});
    return jobId;
  }

  getJob(jobId: string): FiJob | undefined {
    return this.jobs.get(jobId);
  }

  private update(jobId: string, patch: Partial<FiJob>): void {
    const job = this.jobs.get(jobId);
    if (job) Object.assign(job, patch);
  }

  private async runPipeline(jobId: string, fiOrderIds: string[]): Promise<void> {
    try {
      const pairs: FiOrderPairResult[] = [];

      for (const fiOrderId of fiOrderIds) {
        this.update(jobId, { message: `Scraping FI order ${fiOrderId}…` });
        const rows = await this.scraper.scrapeOrderRows(fiOrderId);

        for (const row of rows) {
          if (!row.pdfBuffer || row.pdfBuffer.length === 0) {
            this.logger.warn(`Empty PDF for FI ${fiOrderId} row ${row.rowIndex}`);
            pairs.push({
              fiOrderId,
              rowIndex: row.rowIndex,
              doodooOrderId: null,
              pairStatus: 'unlinked',
              items: [],
            });
            continue;
          }

          this.update(jobId, { message: `Parsing PDF for FI ${fiOrderId} row ${row.rowIndex}…` });
          const doodooOrderId = await extractOrderIdFromPdf(row.pdfBuffer);

          if (!doodooOrderId) {
            this.logger.warn(`No order ID in PDF for FI ${fiOrderId} row ${row.rowIndex}`);
            pairs.push({
              fiOrderId,
              rowIndex: row.rowIndex,
              doodooOrderId: null,
              pairStatus: 'unlinked',
              items: [],
            });
            continue;
          }

          this.update(jobId, { message: `Scraping doodoo520 order #${doodooOrderId}…` });
          const doodooItems = await this.scraper.scrapeDoodooOrder(doodooOrderId);

          if (!doodooItems.length) {
            pairs.push({
              fiOrderId,
              rowIndex: row.rowIndex,
              doodooOrderId,
              pairStatus: 'doodoo_not_found',
              items: [],
            });
            continue;
          }

          const items = this.comparison.compare(row.items, doodooItems);
          pairs.push({
            fiOrderId,
            rowIndex: row.rowIndex,
            doodooOrderId,
            pairStatus: 'compared',
            items,
          });
        }
      }

      const mismatchCount = pairs.filter(
        p => p.items.some(i => i.status !== 'matched'),
      ).length;

      const result: FiComparisonResult = {
        pairs,
        totalPairs: pairs.length,
        mismatchCount,
      };

      this.update(jobId, { message: 'Saving results…' });
      await this.persistResult(result);
      this.update(jobId, { status: 'done', message: 'Done', result });
    } catch (err: any) {
      this.logger.error(`FI job ${jobId} failed: ${err.message}`);
      this.update(jobId, { status: 'error', message: err.message, error: err.message });
    }
  }

  private async persistResult(result: FiComparisonResult): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: [{ id: sessionId }] } = await client.query(
        `INSERT INTO fi_sessions (total_pairs, mismatch_count) VALUES ($1, $2) RETURNING id`,
        [result.totalPairs, result.mismatchCount],
      );
      for (const pair of result.pairs) {
        const { rows: [{ id: pairId }] } = await client.query(
          `INSERT INTO fi_order_pairs (session_id, fi_order_id, fi_row_index, doodoo_order_id, status)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [sessionId, pair.fiOrderId, pair.rowIndex, pair.doodooOrderId, pair.pairStatus],
        );
        for (const item of pair.items) {
          await client.query(
            `INSERT INTO fi_item_comparisons (pair_id, product_code, product_name, fi_qty, doodoo_qty, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [pairId, item.productCode, item.productName, item.fiQty, item.doodooQty, item.status],
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      (client as any).release();
    }
  }

  async getHistory(): Promise<any[]> {
    const { rows } = await this.db.query(
      `SELECT id, created_at, total_pairs, mismatch_count
       FROM fi_sessions ORDER BY created_at DESC LIMIT 20`,
    );
    return rows;
  }
}
