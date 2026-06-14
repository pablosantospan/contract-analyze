import express, { Request, Response } from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import Stripe from 'stripe';
import pdfParse from 'pdf-parse';

dotenv.config();

type EstadoClausula = 'ok' | 'atencion' | 'abusiva';
type ValoracionGlobal = 'ok' | 'revisar' | 'peligroso';

interface Clausula {
  titulo: string;
  texto_original: string;
  explicacion: string;
  estado: EstadoClausula;
  referencia_legal: string | null;
  recomendacion: string | null;
}

interface DatosClave {
  duracion: string;
  renta_mensual: string;
  fianza: string;
  fecha_inicio: string;
  tipo_contrato: string;
}

interface AnalisisContrato {
  resumen: string;
  datos_clave: DatosClave;
  clausulas: Clausula[];
  valoracion_global: ValoracionGlobal;
  resumen_riesgos: string;
}

interface ClausulaPreview {
  titulo: string;
  estado: EstadoClausula;
}

interface AnalisisPreview {
  resumen: string;
  datos_clave: DatosClave;
  valoracion_global: ValoracionGlobal;
  resumen_riesgos: string;
  clausulas: ClausulaPreview[];
}

function toPreview(analysis: AnalisisContrato): AnalisisPreview {
  return {
    resumen: analysis.resumen,
    datos_clave: analysis.datos_clave,
    valoracion_global: analysis.valoracion_global,
    resumen_riesgos: analysis.resumen_riesgos,
    clausulas: analysis.clausulas.map(({ titulo, estado }) => ({ titulo, estado })),
  };
}

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:4200' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se admiten archivos PDF'));
    }
  },
});

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '');

const MAX_INPUT_CHARS = 25000;
const PRECIO_ANALISIS_CENTIMOS = 499; // 4,99 €
const ANALYSIS_TTL_MS = 30 * 60 * 1000; // 30 minutos

interface AnalysisEntry {
  analysis: AnalisisContrato;
  expiresAt: number;
}

// Análisis ya generados, pendientes de pago, en memoria (sin BD): se pierden si el servidor se reinicia.
const analyses = new Map<string, AnalysisEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of analyses.entries()) {
    if (entry.expiresAt < now) analyses.delete(id);
  }
}, 5 * 60 * 1000).unref();

const SYSTEM_PROMPT = `Eres un abogado especializado en Derecho Inmobiliario español, experto en la Ley de Arrendamientos Urbanos (LAU, Ley 29/1994 y sus modificaciones, incluyendo la Ley de Vivienda 2023).

Tu tarea es analizar contratos de arrendamiento urbano y devolver un análisis estructurado en JSON.

INSTRUCCIONES:
1. Lee el contrato completo y extrae cada cláusula o sección relevante.
2. Para cada cláusula, evalúa si es legal, si merece atención o si es abusiva/ilegal según la LAU.
3. Siempre que sea relevante, cita el artículo concreto de la LAU (ej: "Art. 17 LAU", "Art. 36 LAU").
4. Sé claro y accesible: el usuario es un particular, no un abogado.
5. Responde ÚNICAMENTE con JSON válido, sin texto adicional ni fences de markdown.

CRITERIOS DE EVALUACIÓN:
- "ok": cláusula legal y habitual, sin riesgos relevantes.
- "atencion": cláusula legal pero que el usuario debe conocer y entender bien (penalizaciones, prórrogas, gastos adicionales, etc.).
- "abusiva": cláusula que contraviene la LAU o impone condiciones ilegales (ej: fianza superior a 2 mensualidades en vivienda habitual, renuncia a derechos irrenunciables, limitaciones ilegales de uso).

FORMATO DE RESPUESTA (JSON estricto, sin markdown):
{
  "resumen": "resumen ejecutivo del contrato en 2-3 frases",
  "datos_clave": {
    "duracion": "duración pactada",
    "renta_mensual": "importe mensual",
    "fianza": "importe de la fianza",
    "fecha_inicio": "fecha de inicio",
    "tipo_contrato": "vivienda habitual / temporada / otro"
  },
  "clausulas": [
    {
      "titulo": "nombre descriptivo de la cláusula",
      "texto_original": "fragmento literal del contrato",
      "explicacion": "qué significa en lenguaje claro",
      "estado": "ok" | "atencion" | "abusiva",
      "referencia_legal": "artículo LAU aplicable o null",
      "recomendacion": "qué hacer si es atencion o abusiva, o null si es ok"
    }
  ],
  "valoracion_global": "ok" | "revisar" | "peligroso",
  "resumen_riesgos": "resumen de los principales riesgos o puntos de atención"
}`;

app.post('/api/subir', upload.single('contrato'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'No se ha enviado ningún archivo PDF' });
    return;
  }

  let textoContrato: string;
  try {
    const parsed = await pdfParse(req.file.buffer);
    textoContrato = parsed.text.trim();
  } catch {
    res.status(422).json({ error: 'No se pudo extraer el texto del PDF. Asegúrate de que no está escaneado.' });
    return;
  }

  if (textoContrato.length < 100) {
    res.status(422).json({ error: 'El PDF no contiene suficiente texto. Puede ser un documento escaneado.' });
    return;
  }

  if (textoContrato.length > MAX_INPUT_CHARS) {
    textoContrato = textoContrato.slice(0, MAX_INPUT_CHARS);
  }

  // SSE headers — keep connection alive durante el análisis (30-90s)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Analiza el siguiente contrato de arrendamiento:\n\n${textoContrato}`,
        },
      ],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        send({ type: 'chunk' });
      }
    }

    const finalMsg = await stream.finalMessage();
    const rawContent = finalMsg.content[0];
    if (rawContent.type !== 'text') throw new Error('Respuesta inesperada de la IA');

    let jsonText = rawContent.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const analysis = JSON.parse(jsonText) as AnalisisContrato;

    const analysisId = crypto.randomUUID();
    analyses.set(analysisId, { analysis, expiresAt: Date.now() + ANALYSIS_TTL_MS });

    send({ type: 'done', analysisId, preview: toPreview(analysis) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    send({ type: 'error', error: `Error al analizar el contrato: ${msg}` });
  }

  res.end();
});

app.post('/api/crear-pago', express.json(), async (req: Request, res: Response): Promise<void> => {
  const { analysisId } = req.body as { analysisId?: string };

  if (!analysisId || !analyses.has(analysisId)) {
    res.status(404).json({ error: 'No se encontró el análisis. Vuelve a subir el PDF.' });
    return;
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: PRECIO_ANALISIS_CENTIMOS,
            product_data: {
              name: 'Informe completo de contrato de alquiler — ContratoClaro',
            },
          },
          quantity: 1,
        },
      ],
      metadata: { analysisId },
      success_url: `${frontendUrl}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/?canceled=true&analysisId=${analysisId}`,
    });

    if (!session.url) throw new Error('Stripe no devolvió una URL de checkout');

    res.json({ url: session.url });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: `Error al crear la sesión de pago: ${msg}` });
  }
});

app.get('/api/resultado', async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.query.session_id;

  if (typeof sessionId !== 'string') {
    res.status(400).json({ error: 'Falta el parámetro session_id' });
    return;
  }

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    res.status(404).json({ error: 'No se encontró la sesión de pago' });
    return;
  }

  if (session.payment_status !== 'paid') {
    res.status(402).json({ error: 'El pago no se ha completado todavía' });
    return;
  }

  const analysisId = session.metadata?.['analysisId'];
  const entry = analysisId ? analyses.get(analysisId) : undefined;

  if (!entry) {
    res.status(410).json({ error: 'El análisis ha caducado. Vuelve a subir el contrato.' });
    return;
  }

  res.json({ analysis: entry.analysis });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ContratoClaro en http://localhost:${PORT}`);
});
