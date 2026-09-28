// Funcion serverless (Netlify Functions v2, runtime Node/Deno con Request/
// Response estandar). Unico sitio del proyecto que conoce GEMINI_API_KEY:
// esa clave vive solo como variable de entorno del sitio en Netlify, nunca
// en el bundle del cliente (por eso esto no es una llamada directa desde
// ReportEditor.tsx a la API de Gemini).
//
// Autenticacion: exige un ID token de Firebase Auth valido (el mismo que ya
// usa el dashboard) verificado contra el JWKS publico de Firebase. No hace
// falta una cuenta de servicio: solo el project id, que ya es publico (es
// VITE_FIREBASE_PROJECT_ID). Sin esto, cualquiera con la URL de la funcion
// podria agotar la cuota gratuita de Gemini del proyecto.

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { RespuestaInformeIA, SolicitudInformeIA } from "../../src/types/informeIA.ts";

const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// La primera clave de prueba (creada nueva en AI Studio) ya no tenia acceso
// a gemini-2.5-flash (404 pidiendo migrar) y los alias "latest" daban 503
// de saturacion. Con una clave de un proyecto Gemini mas antiguo si funciona
// bien y con mejor calidad que el lite. Si la clave definitiva que se ponga
// mas adelante tampoco tiene acceso a este modelo, volver a "gemini-flash-
// lite-latest" (ver historial de este fichero).
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const jwks = FIREBASE_PROJECT_ID
  ? createRemoteJWKSet(
      new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
    )
  : null;

async function esTokenValido(authHeader: string | null): Promise<boolean> {
  if (!jwks || !FIREBASE_PROJECT_ID || !authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length);
  try {
    await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });
    return true;
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    resumen_ejecutivo: {
      type: "STRING",
      description: "2-3 frases: diagnostico global y la prioridad numero uno, en tono de consultor cercano.",
    },
    saludo: { type: "STRING", description: "Parrafo de saludo personalizado, 3-4 frases." },
    cierre: { type: "STRING", description: "Parrafo de cierre con llamada a la accion, 2-3 frases." },
    dimensiones: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: {
            type: "STRING",
            description: "Copia exactamente el 'id:' de esa area tal como aparece en la entrada, no el nombre.",
          },
          comentario: {
            type: "STRING",
            description: "2-3 frases sobre esta area, citando por que encajan los videos recomendados.",
          },
        },
        required: ["id", "comentario"],
      },
    },
  },
  required: ["resumen_ejecutivo", "saludo", "cierre", "dimensiones"],
};

function construirPrompt(datos: SolicitudInformeIA): string {
  const nombrePila = datos.nombre_contacto.split(" ")[0] || datos.nombre_contacto;
  const bloquesDimension = datos.dimensiones
    .map((d) => {
      const videos = d.videos
        .map((v) => `    - "${v.titulo}" (nivel ${v.nivel ?? "sin nivel"}, ${v.duracion_min} min): ${v.resumen ?? "sin resumen"}`)
        .join("\n");
      return `- id: ${d.id}\n  nombre: ${d.nombre} (${d.pct}% · ${d.score}/${d.max})\n  Videos recomendados para esta area:\n${videos || "    (ninguno)"}`;
    })
    .join("\n\n");

  return `Eres un consultor senior de transformacion digital de la Oficina Acelera Pyme del COIIAS, escribiendo en \
espanol de Espana un informe personalizado tras un test de madurez digital para una pyme.

Datos de la empresa:
- Contacto: ${nombrePila} (rol: ${datos.rol_contacto ?? "no especificado"})
- Empresa: ${datos.empresa}
- Sector: ${datos.sector}
- Tamano: ${datos.tamano_empresa}
- Puntuacion global: ${datos.pct_global}/100 (nivel: ${datos.tier_label})

Resultado y videos formativos recomendados por area:
${bloquesDimension}

Instrucciones:
- Tono profesional, cercano y concreto, tuteando al contacto. Nada de relleno de marketing ni frases genericas.
- Basate solo en los datos anteriores: no inventes cifras, nombres de video ni funcionalidades que no aparezcan.
- El "resumen_ejecutivo" debe nombrar la prioridad mas urgente (la de menor porcentaje) y por que.
- En "dimensiones", el campo "id" de cada area debe ser copiado literalmente del "id:" de esa area en la entrada \
(nunca el nombre ni una traduccion): el dashboard lo usa para encajar tu comentario en el sitio correcto.
- Cada "comentario" de dimension debe mencionar de forma natural, sin listarlos como catalogo, por que los videos \
recomendados encajan con el resultado de esa area.
- Responde unicamente en el formato JSON solicitado.`;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Metodo no permitido." }, 405);
  if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY no esta configurada en el servidor." }, 500);

  if (!(await esTokenValido(req.headers.get("authorization")))) {
    return json({ error: "No autorizado: inicia sesion en el dashboard." }, 401);
  }

  let datos: SolicitudInformeIA;
  try {
    datos = await req.json();
  } catch {
    return json({ error: "Cuerpo de la peticion invalido." }, 400);
  }
  if (!datos?.empresa || !Array.isArray(datos.dimensiones)) {
    return json({ error: "Faltan datos de la empresa o de las dimensiones." }, 400);
  }

  let respuestaGemini: Response;
  try {
    respuestaGemini = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: construirPrompt(datos) }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 4096,
          // gemini-2.5-flash piensa por defecto y esos tokens de "thinking"
          // restan del mismo maxOutputTokens: con un cuestionario real (7
          // dimensiones, hasta 4 videos cada una) el pensamiento se comia
          // ~1300 de 2048 tokens y el JSON se cortaba a mitad de frase
          // (finishReason MAX_TOKENS -> "Gemini no ha devuelto un JSON
          // valido"). No hace falta razonamiento profundo para redactar
          // este texto, así que se desactiva.
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch {
    return json({ error: "No se ha podido contactar con Gemini. Intentalo de nuevo." }, 502);
  }

  if (!respuestaGemini.ok) {
    const detalle = await respuestaGemini.text().catch(() => "");
    console.error("[generar-informe-ia] Gemini error", respuestaGemini.status, detalle);
    // 429 = cuota agotada; 503 = "high demand" de Google en el modelo, algo
    // frecuente en el tier gratuito de los modelos flash mas nuevos. Ambos
    // son transitorios: se informa igual y se anima a reintentar en breve.
    if (respuestaGemini.status === 429 || respuestaGemini.status === 503) {
      return json(
        { error: "Gemini esta saturado o sin cuota gratuita disponible ahora mismo. Prueba de nuevo en unos minutos." },
        respuestaGemini.status,
      );
    }
    return json({ error: "Gemini ha devuelto un error generando el informe." }, 502);
  }

  const cuerpo = await respuestaGemini.json();
  const texto = cuerpo?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof texto !== "string") {
    return json({ error: "Respuesta de Gemini sin contenido utilizable." }, 502);
  }

  let resultado: RespuestaInformeIA;
  try {
    resultado = JSON.parse(texto);
  } catch (err) {
    // Se registra el motivo de corte (normalmente MAX_TOKENS) y el final
    // del texto: es lo que hay que mirar en Netlify > Functions > logs si
    // esto se repite con la clave definitiva.
    console.error(
      "[generar-informe-ia] JSON invalido. finishReason:",
      cuerpo?.candidates?.[0]?.finishReason,
      "usage:",
      JSON.stringify(cuerpo?.usageMetadata),
      "ultimos 300 caracteres:",
      texto.slice(-300),
      "error:",
      err instanceof Error ? err.message : err,
    );
    return json({ error: "Gemini no ha devuelto un JSON valido." }, 502);
  }

  return json(resultado);
};
