import { Component, input, signal } from '@angular/core';
import { AnalisisContrato, EstadoClausula, ValoracionGlobal } from '../../models/contrato.model';

@Component({
  selector: 'app-resultado',
  imports: [],
  templateUrl: './resultado.html',
  styleUrl: './resultado.scss',
})
export class Resultado {
  readonly analysis = input.required<AnalisisContrato>();

  expandedIndex = signal<number | null>(null);

  toggle(index: number): void {
    this.expandedIndex.set(this.expandedIndex() === index ? null : index);
  }

  estadoLabel(estado: EstadoClausula): string {
    const labels: Record<EstadoClausula, string> = {
      ok: 'Sin problemas',
      atencion: 'Atención',
      abusiva: 'Abusiva',
    };
    return labels[estado];
  }

  globalLabel(valoracion: ValoracionGlobal): string {
    const labels: Record<ValoracionGlobal, string> = {
      ok: 'Contrato en orden',
      revisar: 'Revisar antes de firmar',
      peligroso: 'Riesgos graves detectados',
    };
    return labels[valoracion];
  }
}
