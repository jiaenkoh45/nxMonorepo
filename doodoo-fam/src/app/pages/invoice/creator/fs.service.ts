import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';

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

@Injectable({ providedIn: 'root' })
export class FsApiService {
  private http = inject(HttpClient);
  private base = `${environment.apiBase}/api/fs`;

  listChildren(parentId: string | null): Promise<FsNode[]> {
    const url = parentId ? `${this.base}/children?parentId=${parentId}` : `${this.base}/children`;
    return firstValueFrom(this.http.get<{ children: FsNode[] }>(url)).then((r) => r.children);
  }

  getPath(id: string): Promise<FsNode[]> {
    return firstValueFrom(this.http.get<{ path: FsNode[] }>(`${this.base}/path/${id}`)).then(
      (r) => r.path,
    );
  }

  getNode(id: string): Promise<FsNode> {
    return firstValueFrom(this.http.get<{ node: FsNode }>(`${this.base}/node/${id}`)).then(
      (r) => r.node,
    );
  }

  createCreditor(name: string, info: CreditorInfo = {}): Promise<FsNode> {
    return firstValueFrom(
      this.http.post<{ node: FsNode }>(`${this.base}/creditors`, { name, ...info }),
    ).then((r) => r.node);
  }

  updateCreditor(id: string, info: CreditorInfo): Promise<FsNode> {
    return firstValueFrom(
      this.http.patch<{ node: FsNode }>(`${this.base}/creditors/${id}`, info),
    ).then((r) => r.node);
  }

  createFolder(parentId: string, name: string): Promise<FsNode> {
    return firstValueFrom(
      this.http.post<{ node: FsNode }>(`${this.base}/folders`, { parentId, name }),
    ).then((r) => r.node);
  }

  uploadFile(parentId: string, file: File): Promise<FsNode> {
    const form = new FormData();
    form.append('parentId', parentId);
    form.append('file', file, file.name);
    return firstValueFrom(this.http.post<{ node: FsNode }>(`${this.base}/files`, form)).then(
      (r) => r.node,
    );
  }

  rename(id: string, name: string): Promise<FsNode> {
    return firstValueFrom(
      this.http.patch<{ node: FsNode }>(`${this.base}/nodes/${id}`, { name }),
    ).then((r) => r.node);
  }

  delete(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<{ success: boolean }>(`${this.base}/nodes/${id}`)).then(
      () => undefined,
    );
  }

  fileUrl(id: string, name?: string): string {
    const suffix = name ? `/${encodeURIComponent(name)}` : '';
    return `${this.base}/files/${id}/raw${suffix}`;
  }

  zipUrl(folderId: string): string {
    return `${this.base}/folders/${folderId}/zip`;
  }
}
