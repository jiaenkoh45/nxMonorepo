import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { FashionIndexService } from './fashion-index.service';

@Controller('fashion-index')
export class FashionIndexController {
  constructor(private readonly svc: FashionIndexService) {}

  @Post('compare')
  startComparison(@Body() body: { orderIds: string[] }): { jobId: string } {
    const jobId = this.svc.startJob(body.orderIds);
    return { jobId };
  }

  @Get('jobs/:jobId')
  getJob(@Param('jobId') jobId: string) {
    const job = this.svc.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    return job;
  }

  @Get('history')
  async getHistory() {
    return this.svc.getHistory();
  }
}
