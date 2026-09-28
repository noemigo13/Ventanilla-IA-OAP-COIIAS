// Contrato entre el dashboard (ReportEditor) y la funcion serverless
// netlify/functions/generar-informe-ia.mts. Vive en src/types (no en la
// funcion) porque el cliente y la funcion importan exactamente el mismo
// fichero: si el contrato cambia, cambia en un solo sitio.

export interface VideoContextoIA {
  titulo: string;
  nivel: string | null;
  duracion_min: number;
  resumen: string | null;
}

export interface DimensionContextoIA {
  id: string;
  nombre: string;
  score: number;
  max: number;
  pct: number;
  videos: VideoContextoIA[];
}

export interface SolicitudInformeIA {
  empresa: string;
  sector: string;
  tamano_empresa: string;
  rol_contacto: string | null;
  nombre_contacto: string;
  pct_global: number;
  tier_label: string;
  dimensiones: DimensionContextoIA[];
}

export interface RespuestaInformeIA {
  resumen_ejecutivo: string;
  saludo: string;
  cierre: string;
  dimensiones: { id: string; comentario: string }[];
}
