import { Test, TestingModule } from '@nestjs/testing';
import { FashionIndexController } from './fashion-index.controller';
import { FashionIndexService } from './fashion-index.service';
import { NotFoundException } from '@nestjs/common';

const mockService = {
  startJob: jest.fn().mockReturnValue('test-job-id'),
  getJob:   jest.fn(),
  getHistory: jest.fn().mockResolvedValue([]),
};

describe('FashionIndexController', () => {
  let controller: FashionIndexController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FashionIndexController],
      providers: [{ provide: FashionIndexService, useValue: mockService }],
    }).compile();
    controller = module.get(FashionIndexController);
  });

  it('POST /compare returns jobId', () => {
    const result = controller.startComparison({ orderIds: ['FI-123'] });
    expect(result).toEqual({ jobId: 'test-job-id' });
    expect(mockService.startJob).toHaveBeenCalledWith(['FI-123']);
  });

  it('GET /jobs/:id returns job when found', () => {
    const fakeJob = { status: 'running', message: 'Scraping…' };
    mockService.getJob.mockReturnValueOnce(fakeJob);
    const result = controller.getJob('test-job-id');
    expect(result).toEqual(fakeJob);
  });

  it('GET /jobs/:id throws 404 when not found', () => {
    mockService.getJob.mockReturnValueOnce(undefined);
    expect(() => controller.getJob('bad-id')).toThrow(NotFoundException);
  });

  it('GET /history returns array', async () => {
    const result = await controller.getHistory();
    expect(Array.isArray(result)).toBe(true);
  });
});
