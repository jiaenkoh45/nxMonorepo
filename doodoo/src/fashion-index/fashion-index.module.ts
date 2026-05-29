import { Module } from '@nestjs/common';
import { FashionIndexController } from './fashion-index.controller';
import { FashionIndexService } from './fashion-index.service';
import { FashionIndexScraper } from './fashion-index.scraper';
import { FiComparisonService } from './fi-comparison.service';

@Module({
  controllers: [FashionIndexController],
  providers: [FashionIndexService, FashionIndexScraper, FiComparisonService],
})
export class FashionIndexModule {}
