// Cliente de la funcion serverless netlify/functions/generar-informe-ia.mts.
// No llama a Gemini directamente: la API key de Gemini solo existe en el
// entorno de esa funcion, nunca en el bundle del navegador.

import { auth } from "./firebase";
import { cuestionario } from "./cuestionario";
import { videoPorId } from "./videos";
import { idsRecomendadosDimension } from "./scoring";
import type { MapaRespuestas } from "./scoring";
import type { PerfilEmpresa, DimensionResultado } from "../types/respuesta";
import type { DimensionContextoIA, RespuestaInformeIA, SolicitudInformeIA } from "../types/informeIA";

function etiquetaCampo(campoId: string, valor: string): string {
  const campo = cuestionario.perfil_empresa.campos.find((c) => c.id === campoId);
  return campo?.opciones?.find((o) => o.value === valor)?.label ?? valor;
}

/** Construye el payload de la peticion a partir de los datos que el
 * dashboard ya tiene cargados (perfil, resultado, respuestas): la funcion
 * serverless no toca Firestore, solo recibe lo que hace falta para redactar
 * el informe. */
export function construirSolicitudInformeIA(
  perfil: PerfilEmpresa,
  dimensionesResultado: DimensionResultado[],
  pctGlobal: number,
  tierLabel: string,
  respuestas: MapaRespuestas,
): SolicitudInformeIA {
  const dimensiones: DimensionContextoIA[] = dimensionesResultado
    .map((fila) => {
      const dim = cuestionario.dimensiones.find((d) => d.id === fila.id);
      if (!dim) return null;
      const ids = idsRecomendadosDimension(dim, perfil.sector, respuestas, 4);
      const videos = ids
        .map(videoPorId)
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
        .map((v) => ({
          titulo: v.titulo,
          nivel: v.nivel,
          duracion_min: Math.round(v.duracion_seg / 60),
          resumen: v.resumen,
        }));
      const entrada: DimensionContextoIA = { id: fila.id, nombre: dim.nombre, score: fila.score, max: fila.max, pct: fila.pct, videos };
      return entrada;
    })
    .filter((d): d is DimensionContextoIA => d !== null);

  return {
    empresa: perfil.empresa,
    sector: etiquetaCampo("sector", perfil.sector),
    tamano_empresa: etiquetaCampo("tamano_empresa", perfil.tamano_empresa),
    rol_contacto: perfil.rol_contacto ? etiquetaCampo("rol_contacto", perfil.rol_contacto) : null,
    nombre_contacto: perfil.nombre_contacto,
    pct_global: pctGlobal,
    tier_label: tierLabel,
    dimensiones,
  };
}

export async function generarInformeIA(payload: SolicitudInformeIA): Promise<RespuestaInformeIA> {
  if (!auth?.currentUser) {
    throw new Error("Debes iniciar sesion en el dashboard para generar el informe con IA.");
  }
  const token = await auth.currentUser.getIdToken();
  const res = await fetch("/api/generar-informe-ia", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(cuerpo.error ?? `Error ${res.status} generando el informe con IA.`);
  }
  return res.json();
}
