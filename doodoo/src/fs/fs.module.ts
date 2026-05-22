import { Module } from '@nestjs/common';
import { FsController } from './fs.controller';
import { FsService } from './fs.service';
import { FsStorageService } from './fs-storage.service';

@Module({
  controllers: [FsController],
  providers: [FsService, FsStorageService],
})
export class FsModule {}
