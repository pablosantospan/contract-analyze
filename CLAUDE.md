# ContratoClaro

App para analizar contratos de alquiler con IA. El usuario sube un PDF y recibe en menos de 30 segundos un análisis detallado de cada cláusula, detectando posibles abusos y referenciando la Ley de Arrendamientos Urbanos (LAU) española.

## Contexto del producto

**Problema que resuelve:** La gente firma contratos de alquiler sin entender las cláusulas, algunas de las cuales son ilegales o abusivas según la LAU. Ir a un abogado para algo puntual es caro y lento.

**Usuario objetivo (MVP):** Propietarios e inquilinos particulares en España (B2C). Futuro: gestorías, administradores de fincas (B2B).

**Modelo de negocio:** Pago por uso — 4,99€ por análisis, vía Stripe Checkout. El análisis se genera primero y se muestra una vista previa gratuita (valoración global, datos clave, resumen de riesgos y título/estado de cada cláusula); el pago desbloquea el informe completo (explicación, referencia legal y recomendación de cada cláusula).

**Diferenciación:** Específico para legislación española (LAU), sin almacenar el contrato, resultado inmediato.

## Stack

- **Frontend:** Angular 18 (standalone components, signals)
- **Backend:** Node.js + Express + TypeScript
- **IA:** Claude claude-sonnet-4-6 via Anthropic API
- **PDF parsing:** pdf-parse (solo PDFs con texto, no escaneados)
- **Pagos:** Stripe Checkout (modo pago único, sin suscripciones)
- **Deploy:** Backend en Railway, Frontend en Netlify (ambos en producción)

## Estructura del proyecto

```
contrato-analyzer/
├── CLAUDE.md
├── README.md
├── backend/
│   ├── src/index.ts              # Servidor Express completo: multer + pdf-parse + Anthropic
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
└── frontend/contrato-front/
    └── src/app/
        ├── models/contrato.model.ts       # Tipos TypeScript del análisis
        ├── services/contrato.service.ts   # ContratoService — subir, crearSesionPago, obtenerResultado
        └── components/
            ├── uploader/                  # Drag & drop + subida de PDF + estado de carga
            ├── vista-previa/              # Vista previa gratuita + CTA "Desbloquear informe completo" (4,99€)
            └── resultado/                 # Visualización del informe completo por cláusulas
```

## Comandos

```bash
# Backend
cd backend
cp .env.example .env          # añadir ANTHROPIC_API_KEY
npm install
npm run dev                   # tsx watch — servidor en http://localhost:3000

# Frontend
cd frontend/contrato-front
npm install
ng serve                      # dev en http://localhost:4200
ng build                      # build de producción
ng build --configuration=development  # build rápido sin optimizar
```

## API: endpoints

Flujo "analizar primero, pagar para desbloquear" (sin BD ni autenticación):

1. **`POST /api/subir`**
   - Body: `multipart/form-data` con campo `contrato` (PDF, máx 10 MB)
   - Extrae el texto con `pdf-parse`, lo valida y trunca a 25.000 caracteres, y ejecuta el análisis completo con Claude
   - Guarda el análisis completo en memoria bajo un `analysisId` (TTL 30 min)
   - Respuesta vía SSE: eventos `{type:'chunk'}`, `{type:'done', analysisId, preview}` (preview = `AnalisisPreview`), `{type:'error', error}`

2. **`POST /api/crear-pago`**
   - Body JSON: `{ analysisId: string }`
   - Crea una Stripe Checkout Session de 4,99€ y devuelve `{ url: string }` para redirigir al usuario
   - Si `analysisId` no existe/ha caducado → 404

3. **`GET /api/resultado?session_id=...`**
   - Verifica con Stripe que `payment_status === 'paid'`, recupera el `analysisId` de `session.metadata` y devuelve el análisis completo ya generado
   - Respuesta JSON: `{ analysis: AnalisisContrato }` (lectura instantánea de memoria, sin volver a llamar a Claude)
   - Si el pago no está completado → 402; si el análisis ha caducado → 410

El system prompt especializado en LAU pide JSON estructurado a Claude; si la respuesta viene con fences de markdown, se limpian antes de parsear.

**Pago después del análisis:** como el análisis se ejecuta en `/api/subir` antes de cualquier cobro, un fallo de Claude o de parseo del JSON no afecta a ningún pago — el usuario simplemente puede volver a subir el PDF sin coste. Tras un pago exitoso, `GET /api/resultado` es una operación instantánea (sin IA), pero por si falla de forma transitoria el frontend guarda el `session_id` en una señal (`app.ts`) y, ante un error en estado `cargando_resultado`, muestra un botón "Reintentar" que repite la consulta con la misma sesión, sin cobrar de nuevo.

**Limitación conocida del MVP:** los análisis ya generados pero pendientes de pago se guardan en memoria y se pierden si el servidor se reinicia (p. ej. redeploy en Railway) entre la vista previa y el pago. Riesgo bajo (Railway solo redespliega con `git push`) pero no nulo — el usuario vería un error pidiendo volver a subir el PDF aunque Stripe ya haya cobrado.

**Riesgo de coste:** cada PDF subido genera una llamada a Claude (coste ~centavos), pague o no el usuario después de ver la vista previa. `/api/subir` está limitado a 5 peticiones cada 15 minutos por IP (`express-rate-limit`) para acotar el abuso.

## Modelo de datos (contrato.model.ts)

```typescript
type EstadoClausula = 'ok' | 'atencion' | 'abusiva'
type ValoracionGlobal = 'ok' | 'revisar' | 'peligroso'

interface AnalisisContrato {
  resumen: string
  datos_clave: {
    duracion: string
    renta_mensual: string
    fianza: string
    fecha_inicio: string
    tipo_contrato: string
  }
  clausulas: Clausula[]
  valoracion_global: ValoracionGlobal
  resumen_riesgos: string
}

interface Clausula {
  titulo: string
  texto_original: string
  explicacion: string
  estado: EstadoClausula
  referencia_legal: string | null
  recomendacion: string | null
}

// Vista previa gratuita (antes de pagar): mismo análisis sin los campos
// de detalle de cada cláusula (texto_original, explicacion,
// referencia_legal, recomendacion)
interface ClausulaPreview {
  titulo: string
  estado: EstadoClausula
}

interface AnalisisPreview {
  resumen: string
  datos_clave: AnalisisContrato['datos_clave']
  valoracion_global: ValoracionGlobal
  resumen_riesgos: string
  clausulas: ClausulaPreview[]
}
```

## Convenciones Angular

- Standalone components — NO usar NgModules
- Estado con signals: `signal()`, `computed()`, `input()`, `output()`
- Nunca usar `any` — tipar con los modelos de `contrato.model.ts`
- No usar `setTimeout` en producción
- Tests de observables: `fakeAsync` + `tick` o `firstValueFrom`, nunca `done()`
- Estilos en SCSS por componente; variables CSS globales en `styles.scss`

## Convenciones backend

- TypeScript estricto (`strict: true`)
- No usar `any` — tipar respuestas de Anthropic y pdf-parse explícitamente
- Modelo fijo: `claude-sonnet-4-6`, `max_tokens: 8192`
- Respuesta vía streaming SSE (Server-Sent Events) para evitar timeouts en contratos largos
- El texto del contrato se trunca a 25.000 caracteres antes de enviarlo a la IA

## Variables de entorno

```
ANTHROPIC_API_KEY=sk-ant-...            # obligatoria
STRIPE_SECRET_KEY=sk_test_...           # obligatoria (modo test mientras no haya cuenta verificada)
PORT=3000                               # opcional, default 3000
FRONTEND_URL=http://localhost:4200      # origen permitido por CORS y redirecciones de Stripe
```

## Despliegue

- **Backend (Railway):** Root Directory = `backend`. Variables: `ANTHROPIC_API_KEY`, `FRONTEND_URL` (URL de Netlify)
- **Frontend (Netlify):** Base directory = `frontend/contrato-front`, build con `netlify.toml`. La URL del backend se configura en `src/environments/environment.prod.ts` (`apiUrl`)

## Diseño visual

- Fondo: `#f7f6f3` (crema suave), superficie: `#ffffff`
- Acento principal: `#1a5c3a` (verde oscuro)
- Tipografía: Sora (headings) + Inter (body)
- Paleta de estados:
  - ok → verde `#166534` / `#dcfce7`
  - atencion → ámbar `#92400e` / `#fef3c7`
  - abusiva → rojo `#991b1b` / `#fee2e2`

## Lo que NO hay todavía (backlog)

- [ ] Webhooks de Stripe (mayor robustez ante cierres de pestaña tras el pago)
- [ ] Pasar Stripe a modo Live (verificación de cuenta + `sk_live_...`)
- [ ] Autenticación / historial de análisis por usuario
- [ ] Soporte PDFs escaneados (OCR)
- [ ] Modo B2B: prompt adaptado para gestorías y administradores de fincas
- [ ] Generación de contratos desde cero (no solo análisis)
- [ ] Análisis de declaración de la renta para propietarios (posible pivot/extensión)

## Contexto de negocio (para decisiones de producto)

- Mercado: alquiler residencial en España, muy activo y con legislación cambiante (Ley de Vivienda 2023, nueva normativa alquiler de temporada)
- Validación planeada: 20-30 usuarios reales en primeras 2 semanas post-lanzamiento, pago por uso desde el día 1
- Señal de éxito en 60 días: al menos 10-15 pagos reales + peticiones de mejora concretas
- Pivotes preparados si falla B2C: vender a gestorías (B2B), o cambiar foco a generación de contratos o fiscalidad de alquileres
