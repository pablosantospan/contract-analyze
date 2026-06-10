import { Component, signal } from '@angular/core';
import { ContratoService } from './services/contrato.service';
import { AnalisisContrato } from './models/contrato.model';
import { Uploader } from './components/uploader/uploader';
import { Resultado } from './components/resultado/resultado';

type AppState = 'idle' | 'loading' | 'done' | 'error';

@Component({
  selector: 'app-root',
  imports: [Uploader, Resultado],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  state = signal<AppState>('idle');
  analysis = signal<AnalisisContrato | null>(null);
  errorMsg = signal<string | null>(null);

  constructor(private contratoService: ContratoService) {}

  onFileSelected(file: File): void {
    this.state.set('loading');
    this.analysis.set(null);
    this.errorMsg.set(null);

    this.contratoService.analizar(file).subscribe({
      next: (analysis) => {
        this.analysis.set(analysis);
        this.state.set('done');
      },
      error: (err: Error) => {
        this.errorMsg.set(err.message ?? 'Error al conectar con el servidor.');
        this.state.set('error');
      },
    });
  }

  reset(): void {
    this.state.set('idle');
    this.analysis.set(null);
    this.errorMsg.set(null);
  }
}
