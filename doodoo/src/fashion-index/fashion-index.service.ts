import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { extractOrderIdFromPdf } from './fi-pdf-parser';
import { FashionIndexScraper } from './fashion-index.scraper';
import { FiComparisonService } from './fi-comparison.service';
import { DatabaseService } from '../invoice/database.service';
import {
  DoodooOrderItem,
  FiComparisonResult,
  FiItemComparison,
  FiJob,
  FiOrderPairResult,
  FiScrapedItem,
} from './fi.types';

interface DiagPair {
  fiOrderId: string;
  rowIndex: number;
  doodooOrderId: string | null;
  pairStatus: string;
  fiItems: FiScrapedItem[];
  doodooItems: DoodooOrderItem[];
  comparisonItems: FiItemComparison[];
}

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

  private async runPipeline(
    jobId: string,
    fiOrderIds: string[],
  ): Promise<void> {
    try {
      // Phase 1: Scrape all FI rows in one browser session
      this.update(jobId, { message: 'Scraping FashionIndex orders…' });
      const allFiRows = await this.scraper.scrapeAllOrderRows(fiOrderIds);

      // Phase 2: Extract doodoo order IDs from PDFs (no browser)
      this.update(jobId, { message: 'Extracting Doodoo order IDs from PDFs…' });
      type RowMeta = {
        fiOrderId: string;
        rowIndex: number;
        fiItems: FiScrapedItem[];
        doodooOrderId: string | null;
      };
      const rowMetas: RowMeta[] = [];
      for (const row of allFiRows) {
        if (!row.pdfBuffer || row.pdfBuffer.length === 0) {
          this.logger.warn(
            `Empty PDF for FI ${row.fiOrderId} row ${row.rowIndex}`,
          );
          rowMetas.push({
            fiOrderId: row.fiOrderId,
            rowIndex: row.rowIndex,
            fiItems: row.items,
            doodooOrderId: null,
          });
          continue;
        }
        const doodooOrderId = await extractOrderIdFromPdf(row.pdfBuffer);
        if (!doodooOrderId) {
          this.logger.warn(
            `No order ID in PDF for FI ${row.fiOrderId} row ${row.rowIndex}`,
          );
        }
        rowMetas.push({
          fiOrderId: row.fiOrderId,
          rowIndex: row.rowIndex,
          fiItems: row.items,
          doodooOrderId: doodooOrderId ?? null,
        });
      }

      // Phase 3: Scrape all doodoo orders in one browser session
      const uniqueDoodooIds = [
        ...new Set(
          rowMetas
            .map((r) => r.doodooOrderId)
            .filter((id): id is string => id !== null),
        ),
      ];
      this.update(jobId, {
        message: `Scraping ${uniqueDoodooIds.length} Doodoo520 order(s)…`,
      });
      const doodooItemsMap =
        await this.scraper.scrapeAllDoodooOrders(uniqueDoodooIds);

      // Phase 4: Join, compare, build result
      const pairs: FiOrderPairResult[] = [];
      const diagPairs: DiagPair[] = [];

      for (const meta of rowMetas) {
        if (!meta.doodooOrderId) {
          pairs.push({
            fiOrderId: meta.fiOrderId,
            rowIndex: meta.rowIndex,
            doodooOrderId: null,
            pairStatus: 'unlinked',
            items: [],
          });
          diagPairs.push({
            fiOrderId: meta.fiOrderId,
            rowIndex: meta.rowIndex,
            doodooOrderId: null,
            pairStatus: 'unlinked',
            fiItems: meta.fiItems,
            doodooItems: [],
            comparisonItems: [],
          });
          continue;
        }

        const doodooItems = doodooItemsMap.get(meta.doodooOrderId) ?? [];

        if (doodooItems.length === 0) {
          pairs.push({
            fiOrderId: meta.fiOrderId,
            rowIndex: meta.rowIndex,
            doodooOrderId: meta.doodooOrderId,
            pairStatus: 'doodoo_not_found',
            items: [],
          });
          diagPairs.push({
            fiOrderId: meta.fiOrderId,
            rowIndex: meta.rowIndex,
            doodooOrderId: meta.doodooOrderId,
            pairStatus: 'doodoo_not_found',
            fiItems: meta.fiItems,
            doodooItems: [],
            comparisonItems: [],
          });
          continue;
        }

        const items = this.comparison.compare(meta.fiItems, doodooItems);
        pairs.push({
          fiOrderId: meta.fiOrderId,
          rowIndex: meta.rowIndex,
          doodooOrderId: meta.doodooOrderId,
          pairStatus: 'compared',
          items,
        });
        diagPairs.push({
          fiOrderId: meta.fiOrderId,
          rowIndex: meta.rowIndex,
          doodooOrderId: meta.doodooOrderId,
          pairStatus: 'compared',
          fiItems: meta.fiItems,
          doodooItems,
          comparisonItems: items,
        });
      }

      const mismatchCount = pairs.filter((p) =>
        p.items.some((i) => i.status !== 'matched'),
      ).length;
      const result: FiComparisonResult = {
        pairs,
        totalPairs: pairs.length,
        mismatchCount,
      };

      this.writeDiagnosticMd(diagPairs);
      this.update(jobId, { message: 'Saving results…' });
      await this.persistResult(result);
      this.update(jobId, { status: 'done', message: 'Done', result });
    } catch (err: any) {
      this.logger.error(`FI job ${jobId} failed: ${err.message}`);
      this.update(jobId, {
        status: 'error',
        message: err.message,
        error: err.message,
      });
    }
  }

  private writeDiagnosticMd(diagPairs: DiagPair[]): void {
    const ts = new Date().toISOString();
    const lines: string[] = [`# FashionIndex Diagnostic — ${ts}`, ''];

    for (let p = 0; p < diagPairs.length; p++) {
      const d = diagPairs[p];
      lines.push(
        `---`,
        '',
        `## Pair ${p + 1}: FI \`${d.fiOrderId}\` row ${d.rowIndex}` +
          ` → Doodoo \`${d.doodooOrderId ?? 'none'}\` (${d.pairStatus})`,
        '',
      );

      lines.push(`### FI Scraped Items`, '');
      if (d.fiItems.length === 0) {
        lines.push('_No items scraped._', '');
      } else {
        lines.push(
          '| # | productCode | productName | qty | price |',
          '|---|---|---|---|---|',
        );
        d.fiItems.forEach((item, i) => {
          lines.push(
            `| ${i + 1} | \`${item.productCode}\` | ${item.productName} |` +
              ` **${item.qty}** | ${item.price} |`,
          );
        });
        lines.push('');

        d.fiItems.forEach((item, i) => {
          lines.push(`**FI row ${i + 1} — raw texts[]:**`, '```');
          (item.rawTexts ?? []).forEach((t, idx) => {
            lines.push(`[${idx}] ${t}`);
          });
          lines.push('```', '');
        });
      }

      lines.push(`### Doodoo Scraped Items`, '');
      if (d.doodooItems.length === 0) {
        lines.push('_No items scraped._', '');
      } else {
        lines.push(
          '| # | productCode | productName | qty | price |',
          '|---|---|---|---|---|',
        );
        d.doodooItems.forEach((item, i) => {
          lines.push(
            `| ${i + 1} | \`${item.productCode}\` | ${item.productName} |` +
              ` **${item.qty}** | ${item.price} |`,
          );
        });
        lines.push('');

        d.doodooItems.forEach((item, i) => {
          lines.push(`**Doodoo row ${i + 1} — raw cells[]:**`, '```');
          (item.rawCells ?? []).forEach((c, idx) => {
            lines.push(`[${idx}] ${c}`);
          });
          lines.push('```', '');
        });
      }

      lines.push(`### Comparison Result`, '');
      if (d.comparisonItems.length === 0) {
        lines.push('_No comparison items._', '');
      } else {
        lines.push(
          '| productCode | productName | fiQty | doodooQty | status |',
          '|---|---|---|---|---|',
        );
        d.comparisonItems.forEach((item) => {
          lines.push(
            `| \`${item.productCode}\` | ${item.productName} |` +
              ` ${item.fiQty} | ${item.doodooQty} | ${item.status} |`,
          );
        });
        lines.push('');
      }
    }

    const outPath = join(__dirname, '..', '..', '..', 'fi-diagnostic.md');
    try {
      writeFileSync(outPath, lines.join('\n'), 'utf-8');
      this.logger.log(`Diagnostic written → ${outPath}`);
    } catch (err: any) {
      this.logger.warn(`Could not write diagnostic MD: ${err.message}`);
    }
  }

  private async persistResult(result: FiComparisonResult): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const {
        rows: [{ id: sessionId }],
      } = await client.query(
        `INSERT INTO fi_sessions (total_pairs, mismatch_count) VALUES ($1, $2) RETURNING id`,
        [result.totalPairs, result.mismatchCount],
      );
      for (const pair of result.pairs) {
        this.logger.debug(
          `pair insert: fi_order_id=${pair.fiOrderId}(${pair.fiOrderId?.length}) doodoo_order_id=${pair.doodooOrderId}(${pair.doodooOrderId?.length}) status=${pair.pairStatus}(${pair.pairStatus?.length})`,
        );
        const {
          rows: [{ id: pairId }],
        } = await client.query(
          `INSERT INTO fi_order_pairs (session_id, fi_order_id, fi_row_index, doodoo_order_id, status)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            sessionId,
            pair.fiOrderId,
            pair.rowIndex,
            pair.doodooOrderId,
            pair.pairStatus,
          ],
        );
        for (const item of pair.items) {
          this.logger.debug(
            `item insert: product_code=${item.productCode}(${item.productCode?.length}) product_name=${item.productName}(${item.productName?.length}) status=${item.status}(${item.status?.length})`,
          );
          await client.query(
            `INSERT INTO fi_item_comparisons (pair_id, product_code, product_name, fi_qty, doodoo_qty, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              pairId,
              item.productCode,
              item.productName,
              item.fiQty,
              item.doodooQty,
              item.status,
            ],
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
