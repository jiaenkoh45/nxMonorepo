import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { InvoiceParserService } from './invoice-parser.service';
import { DatabaseService } from './database.service';

interface MulterFile {
  buffer: Buffer;
  originalname: string;
}

@Controller('invoice')
export class InvoiceController {
  constructor(
    private readonly parser: InvoiceParserService,
    private readonly db: DatabaseService,
  ) {}

  @Post('compare')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'client',   maxCount: 50 },
      { name: 'supplier', maxCount: 50 },
    ]),
  )
  async compare(
    @UploadedFiles() files: { client?: MulterFile[]; supplier?: MulterFile[] },
  ) {
    const clientFiles   = files?.client   ?? [];
    const supplierFiles = files?.supplier ?? [];

    if (!clientFiles.length || !supplierFiles.length) {
      throw new BadRequestException('At least one client and one supplier file are required.');
    }

    // Multer decodes filenames as latin1 by default; convert back to utf8 so
    // CJK filenames like "订单 #000868.pdf" don't end up as "è®¢å #000868.pdf".
    const decodeName = (n: string) => Buffer.from(n, 'latin1').toString('utf8');

    const [clientParsed, supplierParsed] = await Promise.all([
      Promise.all(clientFiles.map(f => this.parser.parseMarkerFile(f.buffer, decodeName(f.originalname)))),
      Promise.all(supplierFiles.map(f => this.parser.parseMarkerFile(f.buffer, decodeName(f.originalname)))),
    ]);

    const comparison = this.parser.compareGroups(clientParsed, supplierParsed);

    const sessionId = await this.db.persistComparison(clientParsed, supplierParsed, comparison);

    return {
      success: true,
      sessionId,
      comparison,
      parsed: {
        client:   clientParsed.map(({ jpegBase64: _j, ...rest }) => rest),
        supplier: supplierParsed.map(({ jpegBase64: _j, ...rest }) => rest),
      },
    };
  }

  @Get('history')
  async history() {
    try {
      const { rows } = await this.db.query(
        `SELECT id, created_at, mismatch_count, total_codes,
                client_file_count, supplier_file_count
         FROM invoice_comparison_sessions
         ORDER BY created_at DESC
         LIMIT 50`,
      );
      return { success: true, sessions: rows };
    } catch (err: unknown) {
      throw new InternalServerErrorException((err as Error).message);
    }
  }

  @Get('history/:id')
  async historyById(@Param('id') idParam: string) {
    const id = parseInt(idParam, 10);

    try {
      const { rows: [session] } = await this.db.query(
        `SELECT * FROM invoice_comparison_sessions WHERE id = $1`, [id],
      );
      if (!session) throw new NotFoundException('Session not found');

      const { rows: items } = await this.db.query(
        `SELECT * FROM invoice_comparison_items WHERE session_id = $1 ORDER BY code`, [id],
      );

      return { success: true, session, items };
    } catch (err: unknown) {
      if (err instanceof NotFoundException) throw err;
      throw new InternalServerErrorException((err as Error).message);
    }
  }
}
