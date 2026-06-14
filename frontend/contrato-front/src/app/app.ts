import { Component, OnInit, signal } from '@angular/core';
import { ContratoService } from './services/contrato.service';
import { AnalisisContrato, AnalisisPreview } from './models/contrato.model';
import { Uploader } from './components/uploader/uploader';
import { Resultado } from './components/resultado/resultado';
import { VistaPrevia } from './components/vista-previa/vista-previa';

type AppState =
  | 'idle'
  | 'analizando'
  | 'vista_previa'
  | 'redirigiendo'
  | 'cargando_resultado'
  | 'done'
  | 'error'
  | 'cancelado';

@Component({
  selector: 'app-root',
  imports: [Uploader, Resultado, VistaPrevia],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  state = signal<AppState>('idle');
  preview = signal<AnalisisPreview | null>(null);
  analysis = signal<AnalisisContrato | null>(null);
  errorMsg = signal<string | null>(null);
  analysisId = signal<string | null>(null);
  sessionId = signal<string | null>(null);

  constructor(private contratoService: ContratoService) {}

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const canceled = params.get('canceled');
    const analysisId = params.get('analysisId');

    if (sessionId || canceled) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (sessionId) {
      this.cargarResultado(sessionId);
    } else if (canceled === 'true' && analysisId) {
      this.analysisId.set(analysisId);
      this.state.set('cancelado');
    }
  }

  onFileSelected(file: File): void {
    this.state.set('analizando');
    this.errorMsg.set(null);

    this.contratoService.subir(file).subscribe({
      next: ({ analysisId, preview }) => {
        this.analysisId.set(analysisId);
        this.preview.set(preview);
        this.state.set('vista_previa');
      },
      error: (err: Error) => {
        this.errorMsg.set(err.message ?? 'Error al analizar el contrato.');
        this.state.set('error');
      },
    });
  }

  async pagar(): Promise<void> {
    const analysisId = this.analysisId();
    if (!analysisId) return;

    this.state.set('redirigiendo');
    this.errorMsg.set(null);

    try {
      const { url } = await this.contratoService.crearSesionPago(analysisId);
      window.location.href = url;
    } catch (err) {
      this.errorMsg.set(err instanceof Error ? err.message : 'Error al iniciar el pago.');
      this.state.set('error');
    }
  }

  reintentarResultado(): void {
    const sessionId = this.sessionId();
    if (!sessionId) return;
    this.cargarResultado(sessionId);
  }

  private async cargarResultado(sessionId: string): Promise<void> {
    this.sessionId.set(sessionId);
    this.state.set('cargando_resultado');
    this.analysis.set(null);
    this.errorMsg.set(null);

    try {
      const analysis = await this.contratoService.obtenerResultado(sessionId);
      this.analysis.set(analysis);
      this.state.set('done');
    } catch (err) {
      this.errorMsg.set(err instanceof Error ? err.message : 'Error al conectar con el servidor.');
      this.state.set('error');
    }
  }

  reset(): void {
    this.state.set('idle');
    this.preview.set(null);
    this.analysis.set(null);
    this.errorMsg.set(null);
    this.analysisId.set(null);
    this.sessionId.set(null);
  }
}
