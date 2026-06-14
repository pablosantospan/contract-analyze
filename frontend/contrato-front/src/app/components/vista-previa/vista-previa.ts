import { Component, input, output } from '@angular/core';
import { AnalisisPreview, EstadoClausula, ValoracionGlobal } from '../../models/contrato.model';

@Component({
  selector: 'app-vista-previa',
  imports: [],
  templateUrl: './vista-previa.html',
  styleUrl: './vista-previa.scss',
})
export class VistaPrevia {
  readonly preview = input.required<AnalisisPreview>();
  readonly pagar = output<void>();

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
