# Scraper — Repositorio Digital OEFA

Scraper TypeScript para extraer resoluciones del Tribunal de Fiscalización Ambiental (TFA) del [Repositorio Digital OEFA](https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml). Implementado con `axios` + `cheerio` — sin browser automation.

---

## Sitio objetivo

El desafío propone dos targets:

| Site | URL | Acceso |
|------|-----|--------|
| **Poder Judicial Perú** (principal) | `jurisprudencia.pj.gob.pe/...resultado.xhtml` | HTTP 403 fuera de Perú |
| **OEFA TFA** (alternativo oficial) | `publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml` | ✅ Sin VPN |

El scraper implementa el **sitio alternativo oficial** (`consultaTfa.xhtml`): mismo stack JSF/PrimeFaces, mismos form IDs, misma mecánica de paginación y descarga de PDFs. El target principal devuelve HTTP 403 desde IPs fuera de Perú — imposible explorar su estructura sin acceso físico de red. Adaptar al PJ requiere solo cambiar la URL y form IDs en `src/config/sites.ts`.

**Stack detectado:** JSF (JavaServer Faces) con PrimeFaces 6.0. Todos los payloads verificados contra capturas HAR reales.

### Campos extraídos (1753 registros, 176 páginas)

| Campo | Descripción |
|-------|-------------|
| `nro` | Número de fila en la tabla |
| `numeroExpediente` | Número de expediente administrativo |
| `administrado` | Empresa o persona administrada |
| `unidadFiscalizable` | Unidad objeto de fiscalización |
| `sector` | ELECTRICIDAD / HIDROCARBUROS / INDUSTRIA / MINERIA / PESQUERÍA |
| `nroResolucion` | Número de resolución TFA (nombre descriptivo del PDF) |

---

## Requisitos

- Node.js v18+
- pnpm v8+ (`npm install -g pnpm` si no lo tenés)

## Instalación

```bash
pnpm install
```

---

## Uso rápido

```bash
# Demo: 3 páginas, 30 registros + PDFs (~2 min)
pnpm demo

# Scraping completo: 1753 documentos, 176 páginas
pnpm start:tfa

# Ver estado del checkpoint actual
pnpm status

# Solo metadata (sin descargar PDFs)
pnpm demo:no-pdfs

# Tests
pnpm test
```

---

## Referencia de flags

| Flag | Descripción | Default |
|------|-------------|---------|
| `--site=tfa\|dfsai` | Sitio objetivo | `dfsai` |
| `--pages=N` | Limitar a N páginas (demo/prueba) | sin límite |
| `--skip-pdfs` | Solo extraer metadata, sin descargar PDFs | `false` |
| `--session=name` | Aísla logs y checkpoint en `data/sessions/{name}/` | sin aislamiento |
| `--start-page=N` | Fuerza inicio desde la página N (requiere checkpoint previo) | desde checkpoint |
| `--delay-multiplier=N` | Multiplica los delays base para respetar rate limit con múltiples workers | `1.0` |

---

## Multi-instancia (tmux / workers en paralelo)

Dividir el scraping entre múltiples terminales requiere dos cosas:
1. **Sesiones aisladas** (`--session`) para que cada worker tenga su propio log y checkpoint
2. **Delays escalados** (`--delay-multiplier`) para no superar el rate limit del servidor

### Tabla de workers recomendados

| Workers | `--delay-multiplier` | Delay efectivo por request | Throughput total |
|---------|---------------------|---------------------------|-----------------|
| 1 | `1.0` (default) | 1.5–3.5s | ~20 req/min |
| 2 | `1.5` | 2.25–5.25s | ~26 req/min |
| 3 | `2.0` | 3–7s | ~30 req/min |
| 4+ | `2.5+` | 3.75s+ | ~32 req/min |

### Ejemplo: 2 workers dividiendo 176 páginas

```bash
# Terminal 1 — páginas 1-88
pnpm start --site=tfa --session=worker-1 --pages=88 --delay-multiplier=1.5

# Terminal 2 — páginas 89-176
# Nota: --start-page requiere un checkpoint previo en esa sesión.
# La primera vez worker-2 arranca desde página 1 y construye su propio checkpoint.
# Para forzar el rango exacto, correr primero unas páginas sin --start-page.
pnpm start --site=tfa --session=worker-2 --start-page=89 --delay-multiplier=1.5
```

### Estructura de directorios con sesiones

Cada sesión escribe en su directorio aislado — sin conflictos entre workers:

```
data/
  sessions/
    worker-1/
      progress.json       ← checkpoint de worker-1
      records.json        ← registros extraídos por worker-1
      failed_downloads.json
      scraper.log         ← log JSONL de worker-1
    worker-2/
      progress.json
      records.json
      failed_downloads.json
      scraper.log
  scraper.log             ← log de runs sin --session
  progress.json           ← checkpoint de runs sin --session
```

### Resume de un worker interrumpido

Si un worker se interrumpe (Ctrl+C, crash, corte de red), se retoma automáticamente desde el último checkpoint:

```bash
# worker-1 se interrumpió en página 45 → continúa desde página 46
pnpm start --site=tfa --session=worker-1 --delay-multiplier=1.5
```

---

## Salida de archivos

```
downloads/
  pdf/                          ← PDFs con nombre = nroResolucion sanitizado
  excel/                        ← RESOLUCIONES_APELACION.xls (exportación completa)
data/
  records.json                  ← Todos los registros extraídos (ordenados por nro)
  failed_downloads.json         ← PDFs que fallaron — para reintento en próximo run
  progress.json                 ← Checkpoint de la última página completada
  scraper.log                   ← Log JSONL estructurado
```

---

## Sample output

El directorio `sample-output/` contiene evidencia real de una ejecución:

- `records.json` — 10 registros de la página 1 con todos los campos
- `pdf/` — 3 PDFs descargados con nombre descriptivo
- `scraper.log` — log JSONL de la sesión

---

## Características técnicas

### Resume atómico
- `progress.json` se escribe tras cada página completada
- Escritura **atómica** (`.tmp` → rename) — el JSON nunca queda corrupto ante kill/crash
- PDFs ya descargados se saltan automáticamente (verificación por tamaño > 0)
- Si el site objetivo cambia, el checkpoint anterior se invalida automáticamente

### Manejo de errores 429
- Detección de HTTP 429, 502 y 503
- Backoff exponencial: 2s → 4s → 8s → 16s con jitter ±25%
- Tras 4 reintentos: registra en `failed_downloads.json` y **continúa** con el siguiente documento
- `failed_downloads.json` se procesa automáticamente al reiniciar un run completo

### Anti-ban
- Delay aleatorio configurable entre requests (default 1.5–3.5s, escalable con `--delay-multiplier`)
- User-Agent de Chrome real con headers completos
- Accept-Language `es-PE` + Referer correcto en cada request
- CookieJar persistente (tough-cookie) para mantener JSESSIONID activo

### Arquitectura JSF/PrimeFaces
- `javax.faces.ViewState` extraído por `indexOf` — los `]]>` del CDATA corrompen los character classes de regex
- ViewState rota automáticamente en cada respuesta AJAX
- Paginación con `dt_first` (offset de registros, no índice de página) — verificado en HAR
- PDF descargado via POST no-AJAX con `pdfRowIndex` global (data-ri) + `param_uuid` del onclick de `mojarra.jsfcljs`
- Sesión JSF expirada mid-scraping → re-inicializa + re-establece ViewState → reintenta la página

### Observabilidad
- Logger dual: consola coloreada por nivel + JSONL en `data/scraper.log`
- Formato: `{"ts":"...","level":"INFO","msg":"...","ctx":{...}}`
- Grep útil:

```bash
# Ver solo errores y advertencias
grep '"level":"WARN"\|"level":"ERROR"' data/scraper.log | jq .

# Ver progreso de páginas
grep '"msg":"Página procesada"' data/scraper.log | jq '{page: .ctx.page, pdfs: .ctx.pdfsDescargados}'

# Ver tiempos entre sesiones
grep '"msg":"Sesión JSF inicializada"' data/scraper.log | jq .ts
```

---

## Tests

```bash
pnpm test              # 109 tests, 8 archivos
pnpm test:coverage     # con reporte de cobertura
```

| Criterio del desafío | Cobertura |
|----------------------|-----------|
| Navegar todas las páginas | `dt_first` offset verificado en HAR, fixtures con data-ri global |
| Extraer info completa | 7 campos + PDF params del onclick con datos exactos del HAR |
| PDFs con nombre descriptivo | `sanitizeFilename` + `nroResolucion` como filename |
| 429 con backoff exponencial | `withRetry`: 4 reintentos máx, null sin lanzar excepción |
| Continuar tras 429 persistente | null propagado al caller, flujo no interrumpido |
| Registrar documentos fallidos | `recordFailedDownload` + `loadFailedDownloads` idempotente |
| Resume desde checkpoint | `loadProgress` / `saveProgress` atómico, por site y por sesión |

---

## Variables de entorno

```bash
cp .env.example .env
```

| Variable | Default | Descripción |
|----------|---------|-------------|
| `TARGET_SITE` | `dfsai` | Sitio por defecto (`tfa` \| `dfsai`) |
| `BASE_URL` | `https://publico.oefa.gob.pe` | URL base del servidor |
| `DELAY_MIN_MS` | `1500` | Delay mínimo entre requests (ms) |
| `DELAY_MAX_MS` | `3500` | Delay máximo entre requests (ms) |
| `DOWNLOAD_DIR` | `./downloads` | Directorio raíz para PDFs y Excel |
| `DATA_DIR` | `./data` | Directorio para datos, checkpoint y logs |
