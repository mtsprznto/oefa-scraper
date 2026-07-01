import { AxiosInstance } from "axios";
import { createHttpClient } from "./client/httpClient";
import { env } from "./config/env";
import { resolveSite, ScraperConfig } from "./config/sites";
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

// CLI: --site=tfa|dfsai, --pages=N, --skip-pdfs
function parseArgs(): ScraperConfig {
  const argv = process.argv;
  const get = (prefix: string) =>
    argv.find((a) => a.startsWith(prefix))?.split("=")[1];

  const siteKey = get("--site=") ?? env.targetSite;
  const pagesRaw = get("--pages=");

  return {
    site: resolveSite(siteKey),        // lanza si el site es desconocido
    maxPages: pagesRaw ? parseInt(pagesRaw, 10) : null,
    skipPdfs: argv.includes("--skip-pdfs"),
  };
}

const FILTERS: SearchFilters = {};

async function main(): Promise<void> {
  const config = parseArgs();

  ensureDataDir();
  ensureDownloadDir();

  if (config.maxPages !== null) {
    console.log(`[INFO] Modo demo: máximo ${config.maxPages} página(s)`);
  }
  if (config.skipPdfs) {
    console.log("[INFO] --skip-pdfs: solo extracción de metadata");
  }

  const client = createHttpClient();
  const existingProgress = loadProgress(config.site.key);

  if (existingProgress && existingProgress.lastCompletedPage >= existingProgress.totalPages) {
    console.log(`\n[INFO] Scraping de ${config.site.label} ya completado.`);
    const session = await initSession(client, config.site);
    await retryFailedDownloads(client, session, config);
    printSummary(existingProgress);
    return;
  }

  if (existingProgress) {
    await runScraper(client, config, existingProgress, existingProgress.lastCompletedPage + 1);
  } else {
    await initAndRun(client, config);
  }
}

// Inicio limpio: establece el estado inicial del job y delega en runScraper.
async function initAndRun(client: AxiosInstance, config: ScraperConfig): Promise<void> {
  console.log(`\n[INICIO] Site: ${config.site.label}`);
  let session = await initSession(client, config.site);

  console.log("[SEARCH] Ejecutando búsqueda inicial...");
  const searchResult = await executeSearch(client, session, config.site, FILTERS);

  if (!searchResult) {
    console.error(`[ERROR] Búsqueda fallida en ${config.site.label}.`);
    process.exit(1);
  }

  session = searchResult.session;
  const { page: firstPage } = searchResult;

  if (firstPage.totalRecords === 0) {
    console.warn(`[WARN] 0 registros encontrados en ${config.site.label}.`);
    console.warn("       Verificar conectividad y acceso al sitio desde esta IP.");
    process.exit(0);
  }

  const progress: ScraperProgress = {
    site: config.site.key,
    lastCompletedPage: 0,
    totalPages: firstPage.totalPages,
    totalRecords: firstPage.totalRecords,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!config.skipPdfs) {
    await downloadExcel(client, session, config.site);
  }

  // Página 1 ya disponible del search — no hace falta paginación extra
  await processPage(client, session, config, firstPage.records);
  progress.lastCompletedPage = 1;
  saveProgress(progress);

  if (config.maxPages === 1) {
    printSummary(progress);
    console.log("\n[DONE] Límite de páginas alcanzado.");
    return;
  }

  await runScraper(client, config, progress, 2);
}

// Loop de paginación desde startPage. Siempre re-establece sesión JSF al iniciar.
async function runScraper(
  client: AxiosInstance,
  config: ScraperConfig,
  progress: ScraperProgress,
  startPage: number
): Promise<void> {
  console.log(
    `\n[RESUME] Site: ${config.site.label} — retomando desde página ${startPage}/${progress.totalPages}`
  );

  let session = await initSession(client, config.site);

  // executeSearch re-establece el ViewState JSF necesario para paginar
  console.log("[SEARCH] Re-estableciendo estado de sesión...");
  const searchResult = await executeSearch(client, session, config.site, FILTERS);
  if (!searchResult || searchResult.page.totalRecords === 0) {
    console.error("[ERROR] No se pudo re-establecer sesión para paginar.");
    process.exit(1);
  }
  session = searchResult.session;

  // Excel idempotente: skipea si ya existe en disco
  if (!config.skipPdfs) {
    await downloadExcel(client, session, config.site);
  }

  const lastPage =
    config.maxPages !== null
      ? Math.min(progress.totalPages, config.maxPages)
      : progress.totalPages;

  for (let pageNum = startPage; pageNum <= lastPage; pageNum++) {
    console.log(
      `\n[PAGE] ${pageNum}/${progress.totalPages}${config.maxPages ? ` (demo: hasta ${lastPage})` : ""}`
    );

    let navResult = await navigateToPage(
      client, session, config.site, pageNum,
      progress.totalPages, progress.totalRecords, FILTERS
    );

    // Página vacía = ViewState expirado → re-inicializar sesión y reintentar una vez
    if (!navResult || navResult.page.records.length === 0) {
      console.warn(`[WARN] Página ${pageNum} vacía — re-inicializando sesión...`);
      session = await initSession(client, config.site);
      const retry = await executeSearch(client, session, config.site, FILTERS);
      if (retry) session = retry.session;

      navResult = await navigateToPage(
        client, session, config.site, pageNum,
        progress.totalPages, progress.totalRecords, FILTERS
      );

      if (!navResult || navResult.page.records.length === 0) {
        console.error(`[ERROR] Página ${pageNum} sigue vacía tras re-inicialización.`);
        printSummary(progress);
        process.exit(1);
      }
    }

    session = navResult.session;
    await processPage(client, session, config, navResult.page.records);
    progress.lastCompletedPage = pageNum;
    saveProgress(progress); // atomic write — seguro ante kill/crash
  }

  printSummary(progress);
  if (config.maxPages !== null && progress.lastCompletedPage < progress.totalPages) {
    console.log(
      `\n[DONE] Límite --pages=${config.maxPages} alcanzado. Quedan ${progress.totalPages - progress.lastCompletedPage} páginas.`
    );
    console.log("       Para continuar: pnpm start:tfa  (retoma desde aquí automáticamente)");
  } else {
    console.log("\n[DONE] Scraping completado.");
  }
}

// Persiste los registros y descarga los PDFs asociados.
// appendRecords ANTES de downloadPdf garantiza que la metadata nunca se pierde
// aunque los PDFs fallen individualmente.
async function processPage(
  client: AxiosInstance,
  session: JsfSession,
  config: ScraperConfig,
  records: DocumentRecord[]
): Promise<void> {
  appendRecords(records);

  if (config.skipPdfs) return;

  for (const record of records) {
    if (record.pdfParamUuid === null) {
      console.log(`  [SKIP] Sin PDF: ${record.nroResolucion || record.nro}`);
      continue;
    }
    const result = await downloadPdf(client, session, config.site, record);
    if (!result.success) {
      recordFailedDownload(record, result.error ?? "Error desconocido");
    }
  }
}

async function retryFailedDownloads(
  client: AxiosInstance,
  session: JsfSession,
  config: ScraperConfig
): Promise<void> {
  const failed = loadFailedDownloads();
  if (failed.length === 0) {
    console.log("[INFO] Sin descargas fallidas pendientes.");
    return;
  }
  console.log(`\n[RETRY] Reintentando ${failed.length} descargas fallidas...`);
  for (const { record } of failed) {
    const result = await downloadPdf(client, session, config.site, record);
    if (!result.success) {
      console.warn(`  [FAIL] Sigue fallando: ${record.nroResolucion}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
