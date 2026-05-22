import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FsApiService, FsNode } from './fs.service';
import { AuthService } from '../../../auth.service';

@Component({
  selector: 'app-creator',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './creator.html',
  styleUrls: ['./creator.scss'],
})
export class Creator implements OnInit {
  private fs = inject(FsApiService);
  private auth = inject(AuthService);

  canEdit = this.auth.canEdit;

  // ── Navigation state ──────────────────────────────────────────────────────
  currentNodeId = signal<string | null>(null);
  currentNode   = signal<FsNode | null>(null);
  breadcrumb    = signal<FsNode[]>([]);
  children      = signal<FsNode[]>([]);

  // ── Sidebar state ────────────────────────────────────────────────────────
  creditors     = signal<FsNode[]>([]);

  // ── UI state ─────────────────────────────────────────────────────────────
  loading       = signal(false);
  error         = signal<string | null>(null);

  // ── Derived ──────────────────────────────────────────────────────────────
  folders  = computed(() => this.children().filter((n) => n.type !== 'file'));
  files    = computed(() => this.children().filter((n) => n.type === 'file'));
  isAtRoot = computed(() => this.currentNodeId() === null);
  // The root creditor of the current path (first breadcrumb entry, if it's a creditor)
  currentCreditor = computed<FsNode | null>(() => {
    const crumbs = this.breadcrumb();
    const root = crumbs[0];
    return root && root.type === 'creditor' ? root : null;
  });

  ngOnInit(): void {
    this.loadRoot();
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  async loadRoot(): Promise<void> {
    this.currentNodeId.set(null);
    this.currentNode.set(null);
    this.breadcrumb.set([]);
    await this.refresh();
    this.creditors.set(this.children());
  }

  async openNode(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [node, path] = await Promise.all([this.fs.getNode(id), this.fs.getPath(id)]);
      this.currentNodeId.set(id);
      this.currentNode.set(node);
      this.breadcrumb.set(path);
      await this.refresh();
    } catch (err: unknown) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<void> {
    const children = await this.fs.listChildren(this.currentNodeId());
    this.children.set(children);
    if (this.currentNodeId() === null) {
      this.creditors.set(children);
    } else {
      const list = await this.fs.listChildren(null);
      this.creditors.set(list);
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async addCreditor(): Promise<void> {
    const name = window.prompt('Creditor name? (required)');
    if (!name?.trim()) return;
    const phone       = window.prompt('Phone? (optional)') ?? '';
    const email       = window.prompt('Email? (optional)') ?? '';
    const description = window.prompt('Brief description? (optional)') ?? '';
    try {
      await this.fs.createCreditor(name.trim(), {
        phone: phone.trim() || null,
        email: email.trim() || null,
        description: description.trim() || null,
      });
      await this.refresh();
    } catch (err: unknown) {
      this.error.set((err as Error).message);
    }
  }

  async editCreditorInfo(): Promise<void> {
    const creditor = this.currentCreditor();
    if (!creditor) return;
    const phone       = window.prompt('Phone?',       creditor.phone       ?? '') ?? '';
    const email       = window.prompt('Email?',       creditor.email       ?? '') ?? '';
    const description = window.prompt('Description?', creditor.description ?? '') ?? '';
    try {
      const updated = await this.fs.updateCreditor(creditor.id, {
        phone: phone.trim() || null,
        email: email.trim() || null,
        description: description.trim() || null,
      });
      // Reflect the new metadata in the breadcrumb so the header updates
      this.breadcrumb.update((crumbs) => crumbs.map((c) => (c.id === updated.id ? updated : c)));
      await this.refresh();
    } catch (err: unknown) {
      this.error.set((err as Error).message);
    }
  }

  async addFolder(): Promise<void> {
    const parentId = this.currentNodeId();
    if (!parentId) return;
    const name = window.prompt('Folder name?');
    if (!name?.trim()) return;
    try {
      await this.fs.createFolder(parentId, name.trim());
      await this.refresh();
    } catch (err: unknown) {
      this.error.set((err as Error).message);
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const parentId = this.currentNodeId();
    if (!parentId) return;
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    this.loading.set(true);
    this.error.set(null);
    try {
      for (const f of files) {
        await this.fs.uploadFile(parentId, f);
      }
      await this.refresh();
    } catch (err: unknown) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
      input.value = '';
    }
  }

  async deleteNode(node: FsNode, e: Event): Promise<void> {
    e.stopPropagation();
    const ok = window.confirm(`Delete "${node.name}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await this.fs.delete(node.id);
      await this.refresh();
    } catch (err: unknown) {
      this.error.set((err as Error).message);
    }
  }

  async renameNode(node: FsNode, e: Event): Promise<void> {
    e.stopPropagation();
    const name = window.prompt('Rename to:', node.name);
    if (!name?.trim() || name.trim() === node.name) return;
    try {
      await this.fs.rename(node.id, name.trim());
      await this.refresh();
    } catch (err: unknown) {
      this.error.set((err as Error).message);
    }
  }

  exportZip(): void {
    const id = this.currentNodeId();
    if (!id) return;
    window.location.href = this.fs.zipUrl(id);
  }

  fileUrl(id: string, name?: string): string {
    return this.fs.fileUrl(id, name);
  }

  // ── Breadcrumb navigation ───────────────────────────────────────────────

  navigateBreadcrumb(node: FsNode | null): void {
    if (node === null) {
      this.loadRoot();
    } else {
      this.openNode(node.id);
    }
  }
}
