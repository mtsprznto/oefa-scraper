# Scraper — OEFA TFA / Poder Judicial Perú

Scraper TypeScript implementado con `axios` + `cheerio` — sin browser automation.

## Sitio objetivo

El desafío propone dos targets:

| Site | URL | Acceso |
|------|-----|--------|
| **Poder Judicial Perú** (principal) | `jurisprudencia.pj.gob.pe/...resultado.xhtml` | 403 sin IP peruana |
| **OEFA TFA** (alternativo oficial) | `publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml` | ✅ Sin VPN |

El scraper implementa el **sitio alternativo oficial** (`consultaTfa.xhtml`) dado que el target principal devuelve HTTP 403 desde IPs fuera de Perú — no hay forma de explorar su estructura ni verificar el scraper sin acceso de red. Ambos sitios usan JSF/PrimeFaces con estructura idéntica; adaptar al PJ requiere solo cambiar la URL y los form IDs en `src/config/sites.ts`.

## Requisitos

- Node.js v18+
- pnpm v8+

## Instalación

```bash
pnpm install
```

## Uso

```bash
# Scraping completo (1753 docs, 176 páginas) — reanuda si se interrumpe
pnpm start:tfa

# Demo rápida: 3 páginas (30 registros)
pnpm demo

# Solo metadata, sin descargar PDFs
pnpm demo:no-pdfs

# Ver estado del checkpoint actual
pnpm status
```

### Flags disponibles

| Flag | Descripción | Ejemplo |
|------|-------------|---------|
| `--site=tfa\|dfsai` | Sitio objetivo (default: `dfsai`) | `pnpm start --site=tfa` |
| `--pages=N` | Limitar a N páginas — demo/prueba | `pnpm start --site=tfa --pages=5` |
| `--skip-pdfs` | Solo extraer metadata, no descargar PDFs | `pnpm start --site=tfa --skip-pdfs` |

## Sitio objetivo

**URL:** `https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml`

**Stack detectado:** JSF (JavaServer Faces) con PrimeFaces 6.0. Cada interacción es un POST AJAX con `javax.faces.ViewState` que rota en cada respuesta — implementado correctamente con extracción dinámica.

**Todos los payloads verificados contra HAR real** (DevTools Network capture del sitio con IP peruana).

### Campos extraídos

| Campo | Descripción |
|-------|-------------|
| `nro` | Número de fila en la tabla |
| `numeroExpediente` | Número de expediente administrativo |
| `administrado` | Empresa o persona administrada |
| `unidadFiscalizable` | Unidad objeto de fiscalización |
| `sector` | ELECTRICIDAD / HIDROCARBUROS / INDUSTRIA / MINERIA / PESQUERÍA |
| `nroResolucion` | Número de resolución TFA (nombre del PDF) |

## Salida

```
downloads/
  pdf/     ← PDFs descargados (nombre = nroResolucion sanitizado)
  excel/   ← Reservado para exportación Excel
data/
  records.json          ← Todos los registros extraídos (ordenados por nro)
  failed_downloads.json ← PDFs que fallaron (para reintento)
  progress.json         ← Checkpoint para reanudar si se interrumpe
```

## Características técnicas

### Resume automático
- `data/progress.json` guarda la última página completada tras cada página exitosa
- Al reiniciar, el scraper retoma desde `lastCompletedPage + 1` automáticamente
- Escritura **atómica** (`.tmp` → rename) — el JSON nunca queda corrupto ante kill/crash
- PDFs ya descargados se saltan (verificación por existencia + `size > 0`)

### Manejo de errores 429
- Detección de HTTP 429 / 503 / 502
- Backoff exponencial: 2s → 4s → 8s → 16s
- Jitter ±25% para evitar sincronización de reintentos
- Tras 4 reintentos: registra en `failed_downloads.json` y **continúa** con el siguiente

### Anti-ban
- Delay aleatorio 1.5–3.5s entre requests (configurable vía `.env`)
- User-Agent real de Chrome
- Headers completos: Accept-Language `es-PE`, Referer correcto
- CookieJar persistente (tough-cookie) para mantener JSESSIONID

### Arquitectura JSF
- `javax.faces.ViewState` extraído por `indexOf` (no regex — los `]]>` del CDATA corrompen los character classes)
- ViewState rota en cada respuesta AJAX — actualizado automáticamente
- Paginación con `dt_first` (offset de registros, verificado en HAR) — no índice de página
- PDF descargado via POST no-AJAX con `pdfRowIndex` global (data-ri) + `param_uuid` del onclick de `mojarra.jsfcljs`

### Sesión expirada
- Página vacía inesperada mid-scraping → re-inicializa sesión + re-establece estado JSF → reintenta la página

## Sitio alternativo (sin VPN)

Para desarrollo y testing (misma estructura JSF):
```bash
pnpm start:dfsai
```
`https://publico.oefa.gob.pe/repdig/consulta/consultaDfsai.xhtml` — mismo dominio, mismos form IDs, sin geo-bloqueo.

## Tests

```bash
pnpm test              # 104 tests, 8 archivos
pnpm test:coverage     # con coverage report
```

**Cobertura de criterios del desafío:**

| Criterio | Cobertura |
|----------|-----------|
| Navegar todas las páginas | Fixtures con data-ri global, offset `dt_first` verificado |
| Extraer info completa | 7 campos + PDF params del onclick, datos exactos del HAR |
| PDFs con nombre descriptivo | `sanitizeFilename` + `archivoNombre` + filePath |
| 429 con backoff exponencial | `withRetry`: retry→éxito, 4 reintentos máx, null sin lanzar |
| Continuar tras 429 persistente | null propagado al caller, flujo no interrumpido |
| Registrar fallidos | `recordFailedDownload` + `loadFailedDownloads` idempotente |
| Resume desde checkpoint | `loadProgress` / `saveProgress` atómico, por site |

## Variables de entorno

Copiar `.env.example` a `.env` para personalizar:

```bash
cp .env.example .env
```

| Variable | Default | Descripción |
|----------|---------|-------------|
| `TARGET_SITE` | `dfsai` | Sitio por defecto (`tfa` \| `dfsai`) |
| `BASE_URL` | `https://publico.oefa.gob.pe` | URL base del servidor |
| `DELAY_MIN_MS` | `1500` | Delay mínimo entre requests |
| `DELAY_MAX_MS` | `3500` | Delay máximo entre requests |
| `DOWNLOAD_DIR` | `./downloads` | Directorio para PDFs |
| `DATA_DIR` | `./data` | Directorio para datos y checkpoint |
