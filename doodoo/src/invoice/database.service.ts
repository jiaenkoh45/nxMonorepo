import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { ParsedInvoice, ItemComparison } from './invoice-parser.service';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  onModuleInit() {
    if (process.env.DATABASE_URL) {
      const url = new URL(process.env.DATABASE_URL);
      url.searchParams.delete('sslmode');
      this.pool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
    } else {
      this.pool = new Pool({
        host:     process.env.PG_HOST     || 'localhost',
        port:     parseInt(process.env.PG_PORT || '5432'),
        database: process.env.PG_DATABASE || 'doodoo',
        user:     process.env.PG_USER     || 'doodoo_app',
        password: process.env.PG_PASSWORD || '',
        ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
      });
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query(sql: string, params?: unknown[]) {
    return this.pool.query(sql, params);
  }

  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async persistComparison(
    clientParsed: ParsedInvoice[],
    supplierParsed: ParsedInvoice[],
    comparison: ItemComparison[],
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const mismatchCount = comparison.filter(r => !r.match).length;
      const totalCodes    = comparison.length;

      const { rows: [{ id: sessionId }] } = await client.query(
        `INSERT INTO invoice_comparison_sessions
           (mismatch_count, total_codes, client_file_count, supplier_file_count)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [mismatchCount, totalCodes, clientParsed.length, supplierParsed.length],
      );

      const insertFileStmt = `
        INSERT INTO invoice_files
          (session_id, role, filename, customer_name, order_no, date, invoice_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;

      const fileIdMap: Record<string, number> = {};

      for (const inv of clientParsed) {
        const { rows: [{ id }] } = await client.query(insertFileStmt, [
          sessionId, 'client', inv.filename, inv.customerName,
          inv.orderNo ?? inv.invoiceNo ?? null,
          inv.date || null,
          inv.type,
        ]);
        fileIdMap[`client:${inv.filename}`] = id;
      }
      for (const inv of supplierParsed) {
        const { rows: [{ id }] } = await client.query(insertFileStmt, [
          sessionId, 'supplier', inv.filename, inv.customerName,
          inv.orderNo ?? inv.invoiceNo ?? null,
          inv.date || null,
          inv.type,
        ]);
        fileIdMap[`supplier:${inv.filename}`] = id;
      }

      for (const item of comparison) {
        await client.query(
          `INSERT INTO invoice_comparison_items
             (session_id, item_code, description, client_qty, supplier_qty, is_match)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sessionId, item.code, item.description, item.clientQty, item.supplierQty, item.match],
        );
      }

      const insertLineItems = async (
        invoices: ParsedInvoice[],
        role: 'client' | 'supplier',
      ) => {
        for (const inv of invoices) {
          const fileId = fileIdMap[`${role}:${inv.filename}`];
          for (const item of inv.items) {
            await client.query(
              `INSERT INTO invoice_line_items
                 (file_id, item_code, description, qty, unit_price, subtotal, is_gift)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [fileId, item.code, item.description, item.qty,
               item.unitPrice ?? null, item.subtotal ?? null, item.isGift ?? false],
            );
          }
        }
      };
      await insertLineItems(clientParsed, 'client');
      await insertLineItems(supplierParsed, 'supplier');

      await client.query('COMMIT');
      return sessionId as number;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
