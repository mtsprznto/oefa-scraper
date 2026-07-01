import { AxiosInstance } from "axios";
import { createHttpClient } from "./client/httpClient";
import { env } from "./config/env";
import { resolveSite, SiteConfig } from "./config/sites";
import { initSession, JsfSession } from "./scrapers/jsfSession";
import { executeSearch, navigateToPage, SearchFilters } from "./scrapers/searchScraper";
import { downloadPdf, ensureDownloadDir } from "./downloaders/pdfDownloader";
import { downloadExcel } from "./downloaders/excelDownloader";
import { DocumentRecord } from "./parsers/documentParser";
import {
  ensureDataDir,
  loadProgress,
  saveProgress,
  appendRecords,
  recordFailedDownload,
  loadFailedDownloads,
  printSummary,
  ScraperProgress,
} from "./storage/stateManager";

// CLI args
// --site=tfa|dfsai     Sitio objetivo (fallback a TARGET_SITE del .env)
// --pages=N            Limitar a N páginas (demo). Sin este flag: corre completo
// --skip-pdfs          Solo extraer metadata, no descargar PDFs
function parseArgs() {
  const argv = process.argv;
  const get = (prefix: string) =>
    argv.find((a) => a.startsWith(prefix))?.split("=")[1];

  const pagesRaw = get("--pages=");
  return {
    siteKey: get("--site=") ?? env.targetSite,
    maxPages: pagesRaw ? parseInt(pagesRaw, 10) : null, // null = sin límite
    skipPdfs: argv.includes("--skip-pdfs"),
  };
}

const FILTERS: SearchFilters = {};

async function main(): Promise<void> {
  const { siteKey, maxPages, skipPdfs } = parseArgs();
  const site = resolveSite(siteKey);

  ensureDataDir();
  ensureDownloadDir();

  const client = createHttpClient();

  const existingProgress = loadProgress(siteKey);

  if (existingProgress && existingProgress.lastCompletedPage >= existingProgress.totalPages) {
    console.log(`\n[INFO] Scraping de ${site.label} ya completado.`);
    const session = await initSession(client, site);
    await retryFailedDownloads(client, session, site);
    printSummary(existingProgress);
    return;
  }

  if (maxPages !== null) {
    console.log(`[INFO] Modo demo: máximo ${maxPages} página(s)`);
  }
  if (skipPdfs) {
    console.log("[INFO] --skip-pdfs: solo extracción de metadata");
  }

  if (existingProgress) {
    await runScraper(client, site, siteKey, existingProgress, existingProgress.lastCompletedPage + 1, maxPages, skipPdfs);
  } else {
    await runFreshScraper(client, site, siteKey, maxPages, skipPdfs);
  }
}

async function runFreshScraper(
  client: AxiosInstance,
  site: SiteConfig,
  siteKey: string,
  maxPages: number | null,
  skipPdfs: boolean
): Promise<void> {
  console.log(`\n[INICIO] Site: ${site.label}`);
  let session = await initSession(client, site);

  console.log("[SEARCH] Ejecutando búsqueda inicial...");
  const searchResult = await executeSearch(client, session, site, FILTERS);

  if (!searchResult) {
    console.error(`[ERROR] Búsqueda fallida en ${site.label}.`);
    process.exit(1);
  }

  session = searchResult.session;
  const { page: firstPage } = searchResult;

  if (firstPage.totalRecords === 0) {
    console.warn(`[WARN] 0 registros encontrados en ${site.label}.`);
    console.warn("       Verificar conectividad y acceso al sitio desde esta IP.");
    process.exit(0);
  }

  const progress: ScraperProgress = {
    site: siteKey,
    lastCompletedPage: 0,
    totalPages: firstPage.totalPages,
    totalRecords: firstPage.totalRecords,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Descargar Excel con todos los registros del resultado (una sola vez tras el search)
  if (!skipPdfs) {
    await downloadExcel(client, session, site);
  }

  // Procesar página 1 (ya la tenemos del search)
  await processPage(client, session, site, firstPage.records, skipPdfs);
  progress.lastCompletedPage = 1;
  saveProgress(progress);

  if (maxPages === 1) {
    printSummary(progress);
    console.log("\n[DONE] Límite de páginas alcanzado.");
    return;
  }

  await runScraper(client, site, siteKey, progress, 2, maxPages, skipPdfs);
}

// Loop de paginación a partir de startPage. Carga su propia sesión.
async function runScraper(
  client: AxiosInstance,
  site: SiteConfig,
  siteKey: string,
  progress: ScraperProgress,
  startPage: number,
  maxPages: number | null,
  skipPdfs: boolean
): Promise<void> {
  console.log(`\n[RESUME] Site: ${site.label} — retomando desde página ${startPage}/${progress.totalPages}`);

  let session = await initSession(client, site);

  // executeSearch necesario para establecer el estado de sesión JSF antes de paginar
  console.log("[SEARCH] Re-estableciendo estado de sesión...");
  const searchResult = await executeSearch(client, session, site, FILTERS);
  if (!searchResult || searchResult.page.totalRecords === 0) {
    console.error("[ERROR] No se pudo re-establecer sesión para paginar.");
    process.exit(1);
  }
  session = searchResult.session;

  // Excel: idempotente (excelDownloader skipea si ya existe en disco)
  if (!skipPdfs) {
    await downloadExcel(client, session, site);
  }

  // maxPages limita el total de páginas procesadas en esta ejecución
  const lastPage = maxPages !== null
    ? Math.min(progress.totalPages, maxPages)
    : progress.totalPages;

  for (let pageNum = startPage; pageNum <= lastPage; pageNum++) {
    console.log(`\n[PAGE] ${pageNum}/${progress.totalPages}${maxPages ? ` (demo: hasta ${lastPage})` : ""}`);

    let navResult = await navigateToPage(
      client, session, site, pageNum,
      progress.totalPages, progress.totalRecords, FILTERS
    );

    // Página vacía inesperada = ViewState expirado → re-inicializar y reintentar una vez
    if (!navResult || navResult.page.records.length === 0) {
      console.warn(`[WARN] Página ${pageNum} vacía — re-inicializando sesión...`);
      session = await initSession(client, site);
      const retry = await executeSearch(client, session, site, FILTERS);
      if (retry) session = retry.session;

      navResult = await navigateToPage(
        client, session, site, pageNum,
        progress.totalPages, progress.totalRecords, FILTERS
      );

      if (!navResult || navResult.page.records.length === 0) {
        console.error(`[ERROR] Página ${pageNum} sigue vacía tras re-inicialización.`);
        printSummary(progress);
        process.exit(1);
      }
    }

    session = navResult.session;
    await processPage(client, session, site, navResult.page.records, skipPdfs);
    progress.lastCompletedPage = pageNum;
    saveProgress(progress); // atomic write — seguro ante kill/crash
  }

  printSummary(progress);
  if (maxPages !== null && progress.lastCompletedPage < progress.totalPages) {
    console.log(`\n[DONE] Límite --pages=${maxPages} alcanzado. Quedan ${progress.totalPages - progress.lastCompletedPage} páginas.`);
    console.log("       Para continuar: pnpm start:tfa  (retoma desde aquí automáticamente)");
  } else {
    console.log("\n[DONE] Scraping completado.");
  }
}

async function processPage(
  client: AxiosInstance,
  session: JsfSession,
  site: SiteConfig,
  records: DocumentRecord[],
  skipPdfs: boolean
): Promise<void> {
  appendRecords(records); // atomic write antes de descargar PDFs

  if (skipPdfs) return;

  for (const record of records) {
    if (record.pdfParamUuid === null) {
      console.log(`  [SKIP] Sin PDF: ${record.nroResolucion || record.nro}`);
      continue;
    }
    const result = await downloadPdf(client, session, site, record);
    if (!result.success) {
      recordFailedDownload(record, result.error ?? "Error desconocido");
    }
  }
}

async function retryFailedDownloads(
  client: AxiosInstance,
  session: JsfSession,
  site: SiteConfig
): Promise<void> {
  const failed = loadFailedDownloads();
  if (failed.length === 0) {
    console.log("[INFO] Sin descargas fallidas pendientes.");
    return;
  }
  console.log(`\n[RETRY] Reintentando ${failed.length} descargas fallidas...`);
  for (const { record } of failed) {
    const result = await downloadPdf(client, session, site, record);
    if (!result.success) {
      console.warn(`  [FAIL] Sigue fallando: ${record.nroResolucion}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
