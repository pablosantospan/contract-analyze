import { Injectable, NgZone } from '@angular/core';
import { Observable } from 'rxjs';
import { AnalisisContrato } from '../models/contrato.model';
import { environment } from '../../environments/environment';

type SseEvent =
  | { type: 'chunk' }
  | { type: 'done'; analysis: AnalisisContrato }
  | { type: 'error'; error: string };

@Injectable({ providedIn: 'root' })
export class ContratoService {
  private readonly apiUrl = `${environment.apiUrl}/api/analizar`;

  constructor(private ngZone: NgZone) {}

  analizar(file: File): Observable<AnalisisContrato> {
    return new Observable(observer => {
      const formData = new FormData();
      formData.append('contrato', file);

      fetch(this.apiUrl, { method: 'POST', body: formData })
        .then(async response => {
          if (!response.ok || !response.body) {
            const errData = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(errData.error ?? 'Error del servidor');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() ?? '';

            for (const part of parts) {
              if (!part.startsWith('data: ')) continue;
              const event = JSON.parse(part.slice(6)) as SseEvent;

              if (event.type === 'done') {
                this.ngZone.run(() => { observer.next(event.analysis); observer.complete(); });
              } else if (event.type === 'error') {
                this.ngZone.run(() => observer.error(new Error(event.error)));
              }
            }
          }
        })
        .catch(err => this.ngZone.run(() => observer.error(err as Error)));
    });
  }
}
