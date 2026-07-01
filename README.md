# Scraper — OEFA TFA / Poder Judicial Perú

Scraper TypeScript implementado con `axios` + `cheerio` — sin browser automation.

## Sitio objetivo

El desafío propone dos targets:

| Site | URL | Acceso |
|------|-----|--------|
| **Poder Judicial Perú** (principal) | `jurisprudencia.pj.gob.pe/...resultado.xhtml` | HTTP 403 fuera de Perú |
| **OEFA TFA** (alternativo oficial) | `publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml` | ✅ Sin VPN |

El scraper implementa el **sitio alternativo oficial** (`consultaTfa.xhtml`): mismo stack JSF/PrimeFaces, misma estructura de paginación, mismos form IDs, misma mecánica de descarga de PDFs. El target principal devuelve HTTP 403 desde IPs fuera de Perú — imposible explorar su estructura o verificar sin acceso físico de red. Adaptar al PJ requiere solo cambiar la URL y form IDs en `src/config/sites.ts`.

**Stack del sitio:** JSF (JavaServer Faces) con PrimeFaces 6.0. Todos los payloads verificados contra HAR real capturado con DevTools.

### Campos extraídos (1753 registros, 176 páginas)

| Campo | Descripción |
|-------|-------------|
| `nro` | Número de fila en la tabla |
| `numeroExpediente` | Número de expediente administrativo |
| `administrado` | Empresa o persona administrada |
| `unidadFiscalizable` | Unidad objeto de fiscalización |
| `sector` | ELECTRICIDAD / HIDROCARBUROS / INDUSTRIA / MINERIA / PESQUERÍA |
| `nroResolucion` | Número de resolución TFA (nombre del PDF) |

## Requisitos

- Node.js v18+
- pnpm v8+ (`npm install -g pnpm` si no lo tenés)

## Instalación

```bash
pnpm install
```

## Uso

```bash
# Demo rápida: 3 páginas (30 registros + PDFs)
pnpm demo

# Scraping completo (1753 docs, 176 páginas) — reanuda si se interrumpe
pnpm start:tfa

# Solo metadata, sin descargar PDFs
pnpm demo:no-pdfs

# Ver estado del checkpoint actual
pnpm status

# Tests
pnpm test
```

### Flags disponibles

| Flag | Descripción | Ejemplo |
|------|-------------|---------|
| `--site=tfa\|dfsai` | Sitio objetivo (default: `dfsai`) | `pnpm start --site=tfa` |
| `--pages=N` | Limitar a N páginas — demo/prueba | `pnpm start --site=tfa --pages=5` |
| `--skip-pdfs` | Solo extraer metadata, no descargar PDFs | `pnpm start --site=tfa --skip-pdfs` |
| `--session=name` | Aísla logs y checkpoint en `data/sessions/{name}/` | `pnpm start --session=instancia-a` |
| `--start-page=N` | Fuerza inicio desde la página N (override del checkpoint) | `pnpm start --session=instancia-a --start-page=50` |
| `--delay-multiplier=N` | Escala los delays base (anti-ban con múltiples workers) | `pnpm start --session=w2 --delay-multiplier=1.5` |

### Multi-instancia (tmux / múltiples terminales)

Dividir el trabajo entre workers con delays escalados para respetar el rate limit:

| Workers | `--delay-multiplier` | Delay efectivo | Requests/min aprox |
|---------|---------------------|----------------|-------------------|
| 1 | 1.0 (default) | 1.5–3.5s | ~20 |
| 2 | 1.5 | 2.25–5.25s | ~13 por worker |
| 3 | 2.0 | 3–7s | ~10 por worker |
| 4+ | 2.5+ | 3.75s+ | ~8 por worker |

```bash
# Paso 1: correr worker-1 unas páginas para crear el checkpoint
pnpm start --site=tfa --session=worker-1 --pages=88 --delay-multiplier=1.5

# Paso 2 (en otra terminal): arrancar worker-2 desde donde termina worker-1
pnpm start --site=tfa --session=worker-2 --start-page=89 --delay-multiplier=1.5

# Reanudar worker-1 si se interrumpe (retoma automáticamente desde el checkpoint)
pnpm start --site=tfa --session=worker-1 --delay-multiplier=1.5
```

Cada sesión escribe en su propio directorio aislado:
```
data/
  sessions/
    worker-1/
      progress.json
      records.json
      scraper.log
    worker-2/
      progress.json
      records.json
      scraper.log
```

## Sample output

El directorio `sample-output/` contiene evidencia real de una ejecución:

- `records.json` — 10 registros de la página 1 (campos completos)
- `pdf/` — 3 PDFs con nombre descriptivo (`264-2012-OEFA_TFA.pdf`, etc.)
- `scraper.log` — log JSONL estructurado de la sesión

Para ver la ejecución completa correr `pnpm demo` (3 páginas, ~2 min).

## Salida

```
downloads/
  pdf/     ← PDFs descargados (nombre = nroResolucion sanitizado)
  excel/   ← RESOLUCIONES_APELACION.xls (exportación completa)
data/
  records.json          ← Todos los registros extraídos (ordenados por nro)
  failed_downloads.json ← PDFs que fallaron (para reintento automático)
  progress.json         ← Checkpoint para reanudar si se interrumpe
  scraper.log           ← Log JSONL estructurado
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
- `javax.faces.ViewState` extraído por `indexOf` (no regex — los `]]>` del CDATA corrompen character classes)
- ViewState rota en cada respuesta AJAX — actualizado automáticamente
- Paginación con `dt_first` (offset de registros, verificado en HAR) — no índice de página
- PDF via POST no-AJAX con `pdfRowIndex` global (data-ri) + `param_uuid` del onclick de `mojarra.jsfcljs`
- Sesión expirada mid-scraping → re-inicializa + re-establece estado JSF → reintenta la página

### Observabilidad
- Logger dual output: consola con colores + JSONL en `data/scraper.log`
- Cada entrada: `{ts, level, msg, ctx}` — machine-readable, grep-able

## Tests

```bash
pnpm test              # 106 tests, 8 archivos
pnpm test:coverage     # con coverage report
```

**Cobertura de criterios del desafío:**

| Criterio | Cobertura |
|----------|-----------|
| Navegar todas las páginas | Fixtures con data-ri global, offset `dt_first` verificado en HAR |
| Extraer info completa | 7 campos + PDF params del onclick, datos exactos del HAR |
| PDFs con nombre descriptivo | `sanitizeFilename` + `nroResolucion` como filename |
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
