import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseInterceptors,
  UploadedFile,
  Res,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FsService } from './fs.service';

interface MulterFile {
  buffer: Buffer;
  originalname: string;
}

@Controller('fs')
export class FsController {
  constructor(private readonly fs: FsService) {}

  @Get('children')
  async listChildren(@Query('parentId') parentId?: string) {
    const children = await this.fs.listChildren(parentId ?? null);
    return { children };
  }

  @Get('path/:id')
  async getPath(@Param('id') id: string) {
    const path = await this.fs.getPath(id);
    return { path };
  }

  @Get('node/:id')
  async getNode(@Param('id') id: string) {
    const node = await this.fs.getNode(id);
    if (!node) throw new NotFoundException();
    return { node };
  }

  @Post('creditors')
  async createCreditor(
    @Body('name') name: string,
    @Body('phone') phone?: string,
    @Body('email') email?: string,
    @Body('description') description?: string,
  ) {
    if (!name?.trim()) throw new BadRequestException('Name required');
    const node = await this.fs.createCreditor(name.trim(), {
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      description: description?.trim() || null,
    });
    return { node };
  }

  @Patch('creditors/:id')
  async updateCreditor(
    @Param('id') id: string,
    @Body('phone') phone?: string,
    @Body('email') email?: string,
    @Body('description') description?: string,
  ) {
    const node = await this.fs.updateCreditor(id, {
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      description: description?.trim() || null,
    });
    return { node };
  }

  @Post('folders')
  async createFolder(
    @Body('parentId') parentId: string,
    @Body('name') name: string,
  ) {
    if (!parentId) throw new BadRequestException('parentId required');
    if (!name?.trim()) throw new BadRequestException('Name required');
    const node = await this.fs.createFolder(parentId, name.trim());
    return { node };
  }

  @Post('files')
  @UseInterceptors(FileInterceptor('file'))
  async createFile(
    @Body('parentId') parentId: string,
    @UploadedFile() file: MulterFile,
  ) {
    if (!parentId) throw new BadRequestException('parentId required');
    if (!file) throw new BadRequestException('No file uploaded');
    const node = await this.fs.createFile(parentId, file);
    return { node };
  }

  @Patch('nodes/:id')
  async rename(@Param('id') id: string, @Body('name') name: string) {
    if (!name?.trim()) throw new BadRequestException('Name required');
    const node = await this.fs.renameNode(id, name.trim());
    return { node };
  }

  @Delete('nodes/:id')
  async deleteNode(@Param('id') id: string) {
    await this.fs.deleteNode(id);
    return { success: true };
  }

  // Accept an optional trailing filename so the browser tab/title shows it
  // (e.g. /files/<id>/raw/订单 #000868.pdf instead of just "/raw").
  // The :filename param is ignored server-side; only :id is used.
  @Get(['files/:id/raw', 'files/:id/raw/:filename'])
  async downloadFile(@Param('id') id: string, @Res() res: Response) {
    const f = await this.fs.getFile(id);
    if (!f) throw new NotFoundException();
    res.setHeader('Content-Type', 'application/pdf');
    // RFC 5987-style header so non-ASCII (Chinese, etc.) filenames survive intact.
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.send(f.buffer);
  }

  @Get('folders/:id/zip')
  async downloadZip(@Param('id') id: string, @Res() res: Response) {
    const { archive, name } = await this.fs.streamFolderZip(id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(name)}.zip"`,
    );
    archive.pipe(res);
  }
}
