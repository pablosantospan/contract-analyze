import { Injectable, NgZone } from '@angular/core';
import { Observable } from 'rxjs';
import { AnalisisContrato, AnalisisPreview, CrearPagoResponse } from '../models/contrato.model';
import { environment } from '../../environments/environment';

type SseEvent =
  | { type: 'chunk' }
  | { type: 'done'; analysisId: string; preview: AnalisisPreview }
  | { type: 'error'; error: string };

@Injectable({ providedIn: 'root' })
export class ContratoService {
  private readonly baseUrl = environment.apiUrl;

  constructor(private ngZone: NgZone) {}

  subir(file: File): Observable<{ analysisId: string; preview: AnalisisPreview }> {
    return new Observable(observer => {
      const formData = new FormData();
      formData.append('contrato', file);

      fetch(`${this.baseUrl}/api/subir`, { method: 'POST', body: formData })
        .then(async response => {
          if (!response.ok || !response.body) {
            const errData = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(errData.error ?? 'Error al subir el contrato');
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
                this.ngZone.run(() => {
                  observer.next({ analysisId: event.analysisId, preview: event.preview });
                  observer.complete();
                });
              } else if (event.type === 'error') {
                this.ngZone.run(() => observer.error(new Error(event.error)));
              }
            }
          }
        })
        .catch(err => this.ngZone.run(() => observer.error(err as Error)));
    });
  }

  async crearSesionPago(analysisId: string): Promise<CrearPagoResponse> {
    const response = await fetch(`${this.baseUrl}/api/crear-pago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysisId }),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(errData.error ?? 'Error al iniciar el pago');
    }
    return response.json() as Promise<CrearPagoResponse>;
  }

  async obtenerResultado(sessionId: string): Promise<AnalisisContrato> {
    const url = `${this.baseUrl}/api/resultado?session_id=${encodeURIComponent(sessionId)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(errData.error ?? 'Error al obtener el resultado');
    }
    const { analysis } = await response.json() as { analysis: AnalisisContrato };
    return analysis;
  }
}
