import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import { DatabaseService } from '../invoice/database.service';
import { FsStorageService } from './fs-storage.service';

export interface FsNode {
  id: string;
  parent_id: string | null;
  type: 'creditor' | 'folder' | 'file';
  name: string;
  size_bytes: number | null;
  storage_path: string | null;
  created_at: string;
  phone: string | null;
  email: string | null;
  description: string | null;
}

export interface CreditorInfo {
  phone?: string | null;
  email?: string | null;
  description?: string | null;
}

@Injectable()
export class FsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: FsStorageService,
  ) {}

  async listChildren(parentId: string | null): Promise<FsNode[]> {
    const sql =
      parentId === null
        ? `SELECT * FROM fs_nodes WHERE parent_id IS NULL ORDER BY type ASC, name ASC`
        : `SELECT * FROM fs_nodes WHERE parent_id = $1 ORDER BY type ASC, name ASC`;
    const params = parentId === null ? [] : [parentId];
    const { rows } = await this.db.query(sql, params);
    return rows;
  }

  async getNode(id: string): Promise<FsNode | null> {
    const { rows } = await this.db.query(`SELECT * FROM fs_nodes WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async getPath(id: string): Promise<FsNode[]> {
    const sql = `
      WITH RECURSIVE path AS (
        SELECT * FROM fs_nodes WHERE id = $1
        UNION ALL
        SELECT n.* FROM fs_nodes n JOIN path p ON n.id = p.parent_id
      )
      SELECT * FROM path
    `;
    const { rows } = await this.db.query(sql, [id]);
    return (rows as FsNode[]).reverse();
  }

  async createCreditor(name: string, info: CreditorInfo = {}): Promise<FsNode> {
    return this.insertNode({ parentId: null, type: 'creditor', name, info });
  }

  async updateCreditor(id: string, info: CreditorInfo): Promise<FsNode> {
    const { rows } = await this.db.query(
      `UPDATE fs_nodes
         SET phone = $1, email = $2, description = $3
       WHERE id = $4 AND type = 'creditor'
       RETURNING *`,
      [info.phone ?? null, info.email ?? null, info.description ?? null, id],
    );
    if (!rows[0]) throw new NotFoundException('Creditor not found');
    return rows[0];
  }

  async createFolder(parentId: string, name: string): Promise<FsNode> {
    const parent = await this.getNode(parentId);
    if (!parent) throw new NotFoundException('Parent not found');
    if (parent.type === 'file') throw new BadRequestException('Cannot create folder under a file');
    return this.insertNode({ parentId, type: 'folder', name });
  }

  async createFile(
    parentId: string,
    file: { buffer: Buffer; originalname: string },
  ): Promise<FsNode> {
    const parent = await this.getNode(parentId);
    if (!parent) throw new NotFoundException('Parent not found');
    if (parent.type === 'file') throw new BadRequestException('Cannot upload under a file');

    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    const id = randomUUID();
    const storagePath = id;
    await this.storage.save(storagePath, file.buffer);

    const { rows } = await this.db.query(
      `INSERT INTO fs_nodes (id, parent_id, type, name, size_bytes, storage_path)
       VALUES ($1, $2, 'file', $3, $4, $5) RETURNING *`,
      [id, parentId, originalName, file.buffer.length, storagePath],
    );
    return rows[0];
  }

  async renameNode(id: string, name: string): Promise<FsNode> {
    const { rows } = await this.db.query(
      `UPDATE fs_nodes SET name = $1 WHERE id = $2 RETURNING *`,
      [name, id],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  async deleteNode(id: string): Promise<void> {
    const { rows } = await this.db.query(
      `WITH RECURSIVE descendants AS (
         SELECT * FROM fs_nodes WHERE id = $1
         UNION ALL
         SELECT n.* FROM fs_nodes n JOIN descendants d ON n.parent_id = d.id
       )
       SELECT storage_path FROM descendants WHERE type = 'file' AND storage_path IS NOT NULL`,
      [id],
    );
    for (const row of rows) {
      await this.storage.delete(row.storage_path);
    }
    await this.db.query(`DELETE FROM fs_nodes WHERE id = $1`, [id]);
  }

  async getFile(id: string): Promise<{ buffer: Buffer; name: string } | null> {
    const node = await this.getNode(id);
    if (!node || node.type !== 'file' || !node.storage_path) return null;
    const buffer = await this.storage.read(node.storage_path);
    return { buffer, name: node.name };
  }

  async streamFolderZip(folderId: string): Promise<{ archive: archiver.Archiver; name: string }> {
    const folder = await this.getNode(folderId);
    if (!folder) throw new NotFoundException();
    if (folder.type === 'file') throw new BadRequestException('Cannot zip a single file');

    const archive = archiver('zip', { zlib: { level: 9 } });

    const walk = async (nodeId: string, prefix: string): Promise<void> => {
      const children = await this.listChildren(nodeId);
      for (const child of children) {
        const childPath = prefix ? `${prefix}/${child.name}` : child.name;
        if (child.type === 'file' && child.storage_path) {
          const buf = await this.storage.read(child.storage_path);
          archive.append(buf, { name: childPath });
        } else {
          await walk(child.id, childPath);
        }
      }
    };

    walk(folderId, '')
      .then(() => archive.finalize())
      .catch((err) => archive.abort());

    return { archive, name: folder.name };
  }

  private async insertNode(opts: {
    parentId: string | null;
    type: 'creditor' | 'folder';
    name: string;
    info?: CreditorInfo;
  }): Promise<FsNode> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO fs_nodes (id, parent_id, type, name, phone, email, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        id,
        opts.parentId,
        opts.type,
        opts.name,
        opts.info?.phone ?? null,
        opts.info?.email ?? null,
        opts.info?.description ?? null,
      ],
    );
    return rows[0];
  }
}
