import { Injectable, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

@Injectable()
export class FsStorageService implements OnModuleInit {
  private readonly root = path.resolve(process.cwd(), 'uploads');

  async onModuleInit() {
    await fs.mkdir(this.root, { recursive: true });
  }

  private resolve(relative: string): string {
    const full = path.resolve(this.root, relative);
    if (!full.startsWith(this.root)) {
      throw new Error('Path traversal detected');
    }
    return full;
  }

  async save(relative: string, buffer: Buffer): Promise<void> {
    const full = this.resolve(relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
  }

  async read(relative: string): Promise<Buffer> {
    return fs.readFile(this.resolve(relative));
  }

  async delete(relative: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(relative));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
