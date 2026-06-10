# ContratoClaro

App para analizar contratos de alquiler con IA. El usuario sube un PDF y recibe en menos de 30 segundos un análisis detallado de cada cláusula, detectando posibles abusos y referenciando la Ley de Arrendamientos Urbanos (LAU) española.

## Contexto del producto

**Problema que resuelve:** La gente firma contratos de alquiler sin entender las cláusulas, algunas de las cuales son ilegales o abusivas según la LAU. Ir a un abogado para algo puntual es caro y lento.

**Usuario objetivo (MVP):** Propietarios e inquilinos particulares en España (B2C). Futuro: gestorías, administradores de fincas (B2B).

**Modelo de negocio:** Pago por uso — 4,99€ por análisis, o freemium (resumen gratis, informe detallado de pago). Stripe pendiente de integrar.

**Diferenciación:** Específico para legislación española (LAU), sin almacenar el contrato, resultado inmediato.

## Stack

- **Frontend:** Angular 18 (standalone components, signals)
- **Backend:** Node.js + Express + TypeScript
- **IA:** Claude claude-sonnet-4-6 via Anthropic API
- **PDF parsing:** pdf-parse (solo PDFs con texto, no escaneados)
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
        ├── services/contrato.service.ts   # ContratoService — POST /api/analizar
        └── components/
            ├── uploader/                  # Drag & drop + subida de PDF + estado de carga
            └── resultado/                 # Visualización del análisis por cláusulas
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

## API: endpoint principal

`POST /api/analizar`
- Body: `multipart/form-data` con campo `contrato` (PDF, máx 10 MB)
- Respuesta OK: `{ success: true, analysis: AnalisisContrato }`
- Respuesta error: `{ error: string }`

El backend extrae el texto del PDF con `pdf-parse`, lo pasa a Claude con un system prompt especializado en LAU, y devuelve JSON estructurado. Si la respuesta viene con fences de markdown, se limpian antes de parsear.

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
PORT=3000                               # opcional, default 3000
FRONTEND_URL=http://localhost:4200      # origen permitido por CORS
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

- [ ] Integración Stripe (4,99€ por análisis)
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
