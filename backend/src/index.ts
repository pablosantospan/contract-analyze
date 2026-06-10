import express, { Request, Response } from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
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

interface AnalisisContrato {
  resumen: string;
  datos_clave: {
    duracion: string;
    renta_mensual: string;
    fianza: string;
    fecha_inicio: string;
    tipo_contrato: string;
  };
  clausulas: Clausula[];
  valoracion_global: ValoracionGlobal;
  resumen_riesgos: string;
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

const MAX_INPUT_CHARS = 25000;

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

app.post('/api/analizar', upload.single('contrato'), async (req: Request, res: Response): Promise<void> => {
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

  // SSE headers — keep connection alive during the full stream
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
    send({ type: 'done', analysis });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    send({ type: 'error', error: `Error al analizar el contrato: ${msg}` });
  }

  res.end();
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ContratoClaro en http://localhost:${PORT}`);
});
