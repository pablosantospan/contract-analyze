export type EstadoClausula = 'ok' | 'atencion' | 'abusiva';
export type ValoracionGlobal = 'ok' | 'revisar' | 'peligroso';

export interface DatosClave {
  duracion: string;
  renta_mensual: string;
  fianza: string;
  fecha_inicio: string;
  tipo_contrato: string;
}

export interface Clausula {
  titulo: string;
  texto_original: string;
  explicacion: string;
  estado: EstadoClausula;
  referencia_legal: string | null;
  recomendacion: string | null;
}

export interface AnalisisContrato {
  resumen: string;
  datos_clave: DatosClave;
  clausulas: Clausula[];
  valoracion_global: ValoracionGlobal;
  resumen_riesgos: string;
}

export interface ClausulaPreview {
  titulo: string;
  estado: EstadoClausula;
}

export interface AnalisisPreview {
  resumen: string;
  datos_clave: DatosClave;
  valoracion_global: ValoracionGlobal;
  resumen_riesgos: string;
  clausulas: ClausulaPreview[];
}

export interface CrearPagoResponse {
  url: string;
}
