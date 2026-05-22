import { Component, computed, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';

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
  supplierQty: number;
  match: boolean;
  clientFiles: FileRef[];
  supplierFiles: FileRef[];
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
  supplierFiles = signal<FileEntry[]>([]);

  activeClientIdx   = signal(0);
  activeSupplierIdx = signal(0);

  // ── Previews for the currently-selected file ──────────────────────────────
  clientPreview   = computed(() => this.clientFiles()[this.activeClientIdx()]?.preview ?? null);
  supplierPreview = computed(() => this.supplierFiles()[this.activeSupplierIdx()]?.preview ?? null);

  // ── Process state ─────────────────────────────────────────────────────────
  isLoading  = signal(false);
  parseError = signal<string | null>(null);
  result     = signal<ComparisonResult | null>(null);

  // ── Derived counts ────────────────────────────────────────────────────────
  matchCount    = computed(() => this.result()?.items.filter(i => i.match).length  ?? 0);
  mismatchCount = computed(() => this.result()?.items.filter(i => !i.match).length ?? 0);

  constructor(private http: HttpClient, private sanitizer: DomSanitizer) {}

  // ─── File handling ─────────────────────────────────────────────────────────

  async onFilesAdded(group: 'client' | 'supplier', event: Event): Promise<void> {
    const input   = event.target as HTMLInputElement;
    const rawFiles = Array.from(input.files ?? []);
    if (!rawFiles.length) return;

    const entries = rawFiles.map(f => this.toFileEntry(f));

    if (group === 'client') {
      this.clientFiles.update(prev => [...prev, ...entries]);
      this.activeClientIdx.set(this.clientFiles().length - entries.length);
    } else {
      this.supplierFiles.update(prev => [...prev, ...entries]);
      this.activeSupplierIdx.set(this.supplierFiles().length - entries.length);
    }

    input.value = '';
  }

  removeFile(group: 'client' | 'supplier', idx: number, e: Event): void {
    e.stopPropagation();
    if (group === 'client') {
      const updated = [...this.clientFiles()];
      updated.splice(idx, 1);
      this.clientFiles.set(updated);
      this.activeClientIdx.set(Math.max(0, Math.min(idx, updated.length - 1)));
    } else {
      const updated = [...this.supplierFiles()];
      updated.splice(idx, 1);
      this.supplierFiles.set(updated);
      this.activeSupplierIdx.set(Math.max(0, Math.min(idx, updated.length - 1)));
    }
  }

  selectFile(group: 'client' | 'supplier', idx: number): void {
    group === 'client'
      ? this.activeClientIdx.set(idx)
      : this.activeSupplierIdx.set(idx);
  }


  async runComparison(): Promise<void> {
    if (this.clientFiles().length === 0 || this.supplierFiles().length === 0) {
      this.parseError.set('Please upload at least one client invoice and one supplier invoice.');
      return;
    }

    this.isLoading.set(true);
    this.parseError.set(null);
    this.result.set(null);

    const form = new FormData();
    for (const e of this.clientFiles())   form.append('client',   e.file, e.name);
    for (const e of this.supplierFiles()) form.append('supplier', e.file, e.name);

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

  reset(): void {
    this.clientFiles.set([]);
    this.supplierFiles.set([]);
    this.activeClientIdx.set(0);
    this.activeSupplierIdx.set(0);
    this.result.set(null);
    this.parseError.set(null);
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