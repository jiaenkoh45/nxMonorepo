import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceParserService } from './invoice-parser.service';

@Module({
  controllers: [InvoiceController],
  providers: [InvoiceParserService],
})
export class InvoiceModule {}
