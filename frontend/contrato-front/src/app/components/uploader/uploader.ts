import { Component, output, signal } from '@angular/core';

@Component({
  selector: 'app-uploader',
  imports: [],
  templateUrl: './uploader.html',
  styleUrl: './uploader.scss',
})
export class Uploader {
  readonly fileSelected = output<File>();

  isDragOver = signal(false);
  error = signal<string | null>(null);

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(): void {
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.processFile(file);
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.processFile(file);
  }

  private processFile(file: File): void {
    this.error.set(null);
    if (file.type !== 'application/pdf') {
      this.error.set('Solo se admiten archivos PDF.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.error.set('El archivo no puede superar los 10 MB.');
      return;
    }
    this.fileSelected.emit(file);
  }
}
