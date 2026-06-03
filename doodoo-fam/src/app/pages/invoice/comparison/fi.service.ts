import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer, switchMap, takeWhile, shareReplay } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface FiItemComparison {
  productCode: string;
  productName: string;
  fiQty: number;
  doodooQty: number;
  status: 'matched' | 'qty_mismatch' | 'fi_only' | 'doodoo_only';
}

export interface FiOrderPairResult {
  fiOrderId: string;
  orderNumber: string;
  rowIndex: number;
  doodooOrderId: string | null;
  pairStatus: 'compared' | 'unlinked' | 'doodoo_not_found';
  items: FiItemComparison[];
}

export interface FiComparisonResult {
  pairs: FiOrderPairResult[];
  totalPairs: number;
  mismatchCount: number;
}

export interface FiJob {
  status: 'running' | 'done' | 'error';
  message: string;
  result?: FiComparisonResult;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class FiService {
  private http = inject(HttpClient);
  private base = `${environment.apiBase}/api/fashion-index`;

  startComparison(orderIds: string[]): Observable<{ jobId: string }> {
    return this.http.post<{ jobId: string }>(
      `${this.base}/compare`,
      { orderIds },
      { withCredentials: true },
    );
  }

  pollJob(jobId: string): Observable<FiJob> {
    return timer(0, 3_000).pipe(
      switchMap(() =>
        this.http.get<FiJob>(`${this.base}/jobs/${jobId}`, { withCredentials: true }),
      ),
      takeWhile(job => job.status === 'running', true),
      shareReplay(1),
    );
  }
}
