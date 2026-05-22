import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { FsApiService, FsNode } from '../creator/fs.service';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FileEntry {
  file: File;
  name: string;
  preview?: SafeResourceUrl;
}

export interface FileRef {
  filename: string;
  qty: number;
  customerName: string;
}

export interface ItemComparison {
  code: string;
  description: string;
  clientQty: number;
  supplierQty: number;   // backend key; displayed as "Creditor"
  match: boolean;
  clientFiles: FileRef[];
  supplierFiles: FileRef[]; // backend key; displayed as "Creditor"
}

export interface ComparisonResult {
  items: ItemComparison[];
}

// ─── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-comparison',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './comparison.html',
  styleUrls: ['./comparison.scss'],
})
export class Comparison {

  // ── Upload state ──────────────────────────────────────────────────────────
  clientFiles   = signal<FileEntry[]>([]);
  creditorFiles = signal<FileEntry[]>([]);

  activeClientIdx   = signal(0);
  activeCreditorIdx = signal(0);

  // ── Previews for the currently-selected file ──────────────────────────────
  clientPreview   = computed(() => this.clientFiles()[this.activeClientIdx()]?.preview ?? null);
  creditorPreview = computed(() => this.creditorFiles()[this.activeCreditorIdx()]?.preview ?? null);

  // ── Process state ─────────────────────────────────────────────────────────
  isLoading  = signal(false);
  parseError = signal<string | null>(null);
  result     = signal<ComparisonResult | null>(null);

  // ── Derived counts ────────────────────────────────────────────────────────
  matchCount    = computed(() => this.result()?.items.filter(i => i.match).length  ?? 0);
  mismatchCount = computed(() => this.result()?.items.filter(i => !i.match).length ?? 0);

  // ── File picker state ─────────────────────────────────────────────────────
  pickerOpen    = signal(false);
  pickerGroup   = signal<'client' | 'creditor'>('creditor');
  pickerPath    = signal<FsNode[]>([]);
  pickerNodes   = signal<FsNode[]>([]);
  pickerLoading = signal(false);

  private http      = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);
  private fsApi     = inject(FsApiService);

  // ─── File handling ─────────────────────────────────────────────────────────

  async onFilesAdded(group: 'client' | 'creditor', event: Event): Promise<void> {
    const input    = event.target as HTMLInputElement;
    const rawFiles = Array.from(input.files ?? []);
    if (!rawFiles.length) return;

    const entries = rawFiles.map(f => this.toFileEntry(f));

    if (group === 'client') {
      this.clientFiles.update(prev => [...prev, ...entries]);
      this.activeClientIdx.set(this.clientFiles().length - entries.length);
    } else {
      this.creditorFiles.update(prev => [...prev, ...entries]);
      this.activeCreditorIdx.set(this.creditorFiles().length - entries.length);
    }

    input.value = '';
  }

  removeFile(group: 'client' | 'creditor', idx: number, e: Event): void {
    e.stopPropagation();
    if (group === 'client') {
      const updated = [...this.clientFiles()];
      updated.splice(idx, 1);
      this.clientFiles.set(updated);
      this.activeClientIdx.set(Math.max(0, Math.min(idx, updated.length - 1)));
    } else {
      const updated = [...this.creditorFiles()];
      updated.splice(idx, 1);
      this.creditorFiles.set(updated);
      this.activeCreditorIdx.set(Math.max(0, Math.min(idx, updated.length - 1)));
    }
  }

  selectFile(group: 'client' | 'creditor', idx: number): void {
    if (group === 'client') this.activeClientIdx.set(idx);
    else this.activeCreditorIdx.set(idx);
  }

  async runComparison(): Promise<void> {
    if (this.clientFiles().length === 0 || this.creditorFiles().length === 0) {
      this.parseError.set('Please upload at least one client invoice and one creditor invoice.');
      return;
    }

    this.isLoading.set(true);
    this.parseError.set(null);
    this.result.set(null);

    const form = new FormData();
    for (const e of this.clientFiles())   form.append('client',   e.file, e.name);
    // creditor files are sent as 'supplier' to reuse the existing backend parsing logic
    for (const e of this.creditorFiles()) form.append('supplier', e.file, e.name);

    this.http.post<{ success: boolean; comparison: ItemComparison[]; error?: string }>(
      `${environment.apiBase}/api/invoice/compare`, form
    ).subscribe({
      next: res => {
        if (!res.success) {
          this.parseError.set(res.error ?? 'Comparison failed.');
        } else {
          const items = [...res.comparison].sort((a, b) => {
            if (a.match !== b.match) return a.match ? 1 : -1;
            return a.code.localeCompare(b.code);
          });
          this.result.set({ items });
        }
        this.isLoading.set(false);
      },
      error: err => {
        this.parseError.set(err?.error?.error ?? 'Server error — please try again.');
        this.isLoading.set(false);
      }
    });
  }

  loadSampleResult(): void {
    this.result.set({
      items: [
        {
          code: 'RM-1001',
          description: 'Raw Material Type A',
          clientQty: 500,
          supplierQty: 500,
          match: true,
          clientFiles: [
            { filename: 'INV-2024-0081', qty: 500, customerName: 'ABC Trading Sdn Bhd' },
          ],
          supplierFiles: [
            { filename: 'CR-2024-0045', qty: 500, customerName: 'ABC Trading Sdn Bhd' },
          ],
        },
        {
          code: 'RM-1002',
          description: 'Raw Material Type B',
          clientQty: 1200,
          supplierQty: 1150,
          match: false,
          clientFiles: [
            { filename: 'INV-2024-0081', qty: 700, customerName: 'ABC Trading Sdn Bhd' },
            { filename: 'INV-2024-0095', qty: 500, customerName: 'XYZ Industries Sdn Bhd' },
          ],
          supplierFiles: [
            { filename: 'CR-2024-0045', qty: 1150, customerName: 'ABC Trading Sdn Bhd' },
          ],
        },
        {
          code: 'FG-2001',
          description: 'Finished Goods Type C',
          clientQty: 300,
          supplierQty: 0,
          match: false,
          clientFiles: [
            { filename: 'INV-2024-0102', qty: 300, customerName: 'DEF Corp Sdn Bhd' },
          ],
          supplierFiles: [],
        },
      ],
    });
  }

  reset(): void {
    this.clientFiles.set([]);
    this.creditorFiles.set([]);
    this.activeClientIdx.set(0);
    this.activeCreditorIdx.set(0);
    this.result.set(null);
    this.parseError.set(null);
  }

  // ─── File picker ───────────────────────────────────────────────────────────

  openPicker(group: 'client' | 'creditor'): void {
    this.pickerGroup.set(group);
    this.pickerPath.set([]);
    this.pickerOpen.set(true);
    this.loadPickerChildren(null);
  }

  closePicker(): void {
    this.pickerOpen.set(false);
  }

  async pickerNavigate(node: FsNode): Promise<void> {
    if (node.type === 'file') {
      await this.pickerSelectFile(node);
      return;
    }
    this.pickerPath.update(p => [...p, node]);
    await this.loadPickerChildren(node.id);
  }

  async pickerJumpTo(index: number): Promise<void> {
    if (index < 0) {
      this.pickerPath.set([]);
      await this.loadPickerChildren(null);
    } else {
      const path = this.pickerPath().slice(0, index + 1);
      this.pickerPath.set(path);
      await this.loadPickerChildren(path[path.length - 1].id);
    }
  }

  pickerNodeIcon(node: FsNode): string {
    if (node.type === 'creditor') return 'business';
    if (node.type === 'folder')   return 'folder';
    return 'description';
  }

  private async loadPickerChildren(parentId: string | null): Promise<void> {
    this.pickerLoading.set(true);
    try {
      const nodes = await this.fsApi.listChildren(parentId);
      this.pickerNodes.set(nodes);
    } catch {
      this.pickerNodes.set([]);
    } finally {
      this.pickerLoading.set(false);
    }
  }

  private async pickerSelectFile(node: FsNode): Promise<void> {
    this.pickerLoading.set(true);
    try {
      const url  = this.fsApi.fileUrl(node.id, node.name);
      const blob = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
      const file  = new File([blob], node.name, { type: 'application/pdf' });
      const entry = this.toFileEntry(file);

      const group = this.pickerGroup();
      if (group === 'client') {
        this.clientFiles.update(prev => [...prev, entry]);
        this.activeClientIdx.set(this.clientFiles().length - 1);
      } else {
        this.creditorFiles.update(prev => [...prev, entry]);
        this.activeCreditorIdx.set(this.creditorFiles().length - 1);
      }
      this.closePicker();
    } catch {
      this.pickerLoading.set(false);
      this.parseError.set('Failed to load file from creditor section.');
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private toFileEntry(file: File): FileEntry {
    const blobUrl = URL.createObjectURL(file);
    return {
      file,
      name: file.name,
      preview: this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl),
    };
  }
}
