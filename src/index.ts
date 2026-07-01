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
import { log } from "./logger";

// CLI: --site=tfa|dfsai, --pages=N, --skip-pdfs
function parseArgs(): ScraperConfig {
  const argv = process.argv;
  const get = (prefix: string) =>
    argv.find((a) => a.startsWith(prefix))?.split("=")[1];

  const siteKey = get("--site=") ?? env.targetSite;
  const pagesRaw = get("--pages=");

  return {
    site: resolveSite(siteKey),
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
    log.info("Modo demo", { maxPages: config.maxPages });
  }
  if (config.skipPdfs) {
    log.info("--skip-pdfs activo: solo extracción de metadata");
  }

  const client = createHttpClient();
  const existingProgress = loadProgress(config.site.key);

  if (existingProgress && existingProgress.lastCompletedPage >= existingProgress.totalPages) {
    log.info("Scraping ya completado", { site: config.site.key });
    const session = await initSession(client, config.site);
    await retryFailedDownloads(client, session, config);
    printSummary(existingProgress);
    log.close();
    return;
  }

  if (existingProgress) {
    await runScraper(client, config, existingProgress, existingProgress.lastCompletedPage + 1);
  } else {
    await initAndRun(client, config);
  }

  log.close();
}

// Inicio limpio: establece el estado inicial del job y delega en runScraper.
async function initAndRun(client: AxiosInstance, config: ScraperConfig): Promise<void> {
  log.info("Iniciando scraper", { site: config.site.key });
  let session = await initSession(client, config.site);

  log.info("Ejecutando búsqueda inicial");
  const searchResult = await executeSearch(client, session, config.site, FILTERS);

  if (!searchResult) {
    log.error("Búsqueda fallida", { site: config.site.label });
    process.exit(1);
  }

  session = searchResult.session;
  const { page: firstPage } = searchResult;

  if (firstPage.totalRecords === 0) {
    log.warn("0 registros encontrados — verificar conectividad y acceso al sitio", {
      site: config.site.label,
    });
    process.exit(0);
  }

  log.info("Totales obtenidos", {
    totalRecords: firstPage.totalRecords,
    totalPages: firstPage.totalPages,
  });

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

  await processPage(client, session, config, firstPage.records, 1, firstPage.totalPages);
  progress.lastCompletedPage = 1;
  saveProgress(progress);

  if (config.maxPages === 1) {
    printSummary(progress);
    log.info("Límite de páginas alcanzado", { maxPages: config.maxPages });
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
  log.info("Retomando scraper", {
    site: config.site.key,
    startPage,
    totalPages: progress.totalPages,
  });

  let session = await initSession(client, config.site);

  log.info("Re-estableciendo estado de sesión JSF");
  const searchResult = await executeSearch(client, session, config.site, FILTERS);
  if (!searchResult || searchResult.page.totalRecords === 0) {
    log.error("No se pudo re-establecer sesión para paginar");
    process.exit(1);
  }
  session = searchResult.session;

  if (!config.skipPdfs) {
    await downloadExcel(client, session, config.site);
  }

  const lastPage =
    config.maxPages !== null
      ? Math.min(progress.totalPages, config.maxPages)
      : progress.totalPages;

  for (let pageNum = startPage; pageNum <= lastPage; pageNum++) {
    log.info("Navegando a página", {
      page: pageNum,
      totalPages: progress.totalPages,
      ...(config.maxPages ? { demoLimit: lastPage } : {}),
    });

    let navResult = await navigateToPage(
      client, session, config.site, pageNum,
      progress.totalPages, progress.totalRecords, FILTERS
    );

    // Página vacía = ViewState expirado → re-inicializar sesión y reintentar una vez
    if (!navResult || navResult.page.records.length === 0) {
      log.warn("Página vacía — re-inicializando sesión", { page: pageNum });
      session = await initSession(client, config.site);
      const retry = await executeSearch(client, session, config.site, FILTERS);
      if (retry) session = retry.session;

      navResult = await navigateToPage(
        client, session, config.site, pageNum,
        progress.totalPages, progress.totalRecords, FILTERS
      );

      if (!navResult || navResult.page.records.length === 0) {
        log.error("Página sigue vacía tras re-inicialización", { page: pageNum });
        printSummary(progress);
        process.exit(1);
      }
    }

    session = navResult.session;
    await processPage(client, session, config, navResult.page.records, pageNum, progress.totalPages);
    progress.lastCompletedPage = pageNum;
    saveProgress(progress);
  }

  printSummary(progress);
  if (config.maxPages !== null && progress.lastCompletedPage < progress.totalPages) {
    log.info("Límite de páginas alcanzado", {
      maxPages: config.maxPages,
      remaining: progress.totalPages - progress.lastCompletedPage,
    });
  } else {
    log.info("Scraping completado", { site: config.site.key, totalPages: progress.totalPages });
  }
}

// Persiste los registros y descarga los PDFs asociados.
// appendRecords ANTES de downloadPdf garantiza que la metadata nunca se pierde
// aunque los PDFs fallen individualmente.
async function processPage(
  client: AxiosInstance,
  session: JsfSession,
  config: ScraperConfig,
  records: DocumentRecord[],
  pageNum: number,
  totalPages: number
): Promise<void> {
  appendRecords(records);
  log.debug("Registros persistidos", { page: pageNum, count: records.length });

  if (config.skipPdfs) return;

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of records) {
    if (record.pdfParamUuid === null) {
      log.debug("Sin PDF adjunto", { nro: record.nro, resolucion: record.nroResolucion });
      skipped++;
      continue;
    }
    const result = await downloadPdf(client, session, config.site, record);
    if (result.success) {
      downloaded++;
    } else {
      failed++;
      recordFailedDownload(record, result.error ?? "Error desconocido");
      log.warn("PDF fallido — registrado para reintento", {
        resolucion: record.nroResolucion,
        error: result.error,
      });
    }
  }

  log.info("Página procesada", {
    page: pageNum,
    totalPages,
    records: records.length,
    pdfsDescargados: downloaded,
    pdfsSkipped: skipped,
    pdfsFailidos: failed,
  });
}

async function retryFailedDownloads(
  client: AxiosInstance,
  session: JsfSession,
  config: ScraperConfig
): Promise<void> {
  const failed = loadFailedDownloads();
  if (failed.length === 0) {
    log.info("Sin descargas fallidas pendientes");
    return;
  }

  log.info("Reintentando descargas fallidas", { count: failed.length });
  let recovered = 0;

  for (const { record } of failed) {
    const result = await downloadPdf(client, session, config.site, record);
    if (result.success) {
      recovered++;
    } else {
      log.warn("PDF sigue fallando tras reintento", { resolucion: record.nroResolucion });
    }
  }

  log.info("Reintentos completados", { recovered, total: failed.length });
}

main().catch((err: unknown) => {
  log.error("Error fatal no capturado", { error: String(err) });
  log.close();
  process.exit(1);
});
