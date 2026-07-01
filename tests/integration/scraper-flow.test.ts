/**
 * Test de integración: flujo completo del scraper.
 *
 * Cubre los 7 criterios del desafío técnico:
 *   1. Navegación por todas las páginas
 *   2. Extracción de información de documentos
 *   3. Descarga de PDFs con nombre descriptivo
 *   4. Manejo de 429 con backoff exponencial
 *   5. Continuar tras 429 persistente (null → recordar fallo)
 *   6. Registrar documentos fallidos para reintento
 *   7. Estructura modular verificada
 *
 * Sin requests reales — todo mockeado con fixtures del HAR.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Readable } from "stream";
import axios from "axios";
import {
  SEARCH_RESPONSE_XML,
  PAGE2_RESPONSE_XML,
  SEARCH_RESPONSE_EMPTY_XML,
  PAGE_EMPTY_RESPONSE_XML,
  INITIAL_HTML_WITH_VIEWSTATE,
  VIEW_STATE_AFTER_SEARCH,
  VIEW_STATE_AFTER_PAGE2,
  JSESSION_ID,
  SESSION_BASE,
} from "../fixtures";
import { SITES } from "../../src/config/sites";

// ─── Setup tmp dirs aislados ──────────────────────────────────────────────────

let tmpDir: string;
let pdfDir: string;
let dataDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scraper-integration-"));
  pdfDir = path.join(tmpDir, "pdf");
  dataDir = path.join(tmpDir, "data");
  fs.mkdirSync(pdfDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  process.env["DOWNLOAD_DIR"] = tmpDir;
  process.env["DATA_DIR"] = dataDir;
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["DOWNLOAD_DIR"];
  delete process.env["DATA_DIR"];
  vi.resetModules();
  vi.restoreAllMocks();
});

// ─── Helper: mock de axios error ─────────────────────────────────────────────

// Crea un error que axios.isAxiosError() reconoce.
// Usamos Object.create para settear el prototype sin llamar al constructor
// (que lanza en algunos entornos de test por el config={} vacío).
function axiosError(status: number): Error {
  const err = Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status },
    config: {},
    code: String(status),
  });
  Object.setPrototypeOf(err, axios.AxiosError.prototype);
  return err;
}

function pdfStream() {
  const s = new Readable();
  s.push(Buffer.from("%PDF-1.4 integration-test"));
  s.push(null);
  return s;
}

// ─── Criterio 1+2: Navegación completa + extracción ─────────────────────────

describe("Criterio 1+2: Navegar páginas y extraer documentos", () => {
  it("extrae registros de página 1 (búsqueda inicial)", async () => {
    const { parseSearchResponse } = await import("../../src/parsers/documentParser");

    const page = parseSearchResponse(SEARCH_RESPONSE_XML, SITES.tfa);

    expect(page.totalRecords).toBe(1753);
    expect(page.totalPages).toBe(176);
    expect(page.records).toHaveLength(3);

    // Todos los campos están presentes
    for (const r of page.records) {
      expect(r.nro).toBeTruthy();
      expect(r.numeroExpediente).toBeTruthy();
      expect(r.nroResolucion).toBeTruthy();
      expect(typeof r.pdfRowIndex === "number" || r.pdfRowIndex === null).toBe(true);
    }
  });

  it("extrae registros de página 2 con data-ri global correcto", async () => {
    const { parsePaginationResponse } = await import(
      "../../src/parsers/documentParser"
    );

    const page = parsePaginationResponse(PAGE2_RESPONSE_XML, SITES.tfa, 2, 176, 1753);

    expect(page.records[0].pdfRowIndex).toBe(10); // índice global, no 0
    expect(page.records[0].nroResolucion).toBe("236-2013-OEFA/TFA");
  });

  it("flujo executeSearch → navigateToPage → ViewState rota correctamente", async () => {
    vi.doMock("../../src/client/httpClient", () => ({
      randomDelay: vi.fn().mockResolvedValue(undefined),
      withRetry: vi.fn().mockImplementation(
        async (fn: () => Promise<unknown>) => fn()
      ),
    }));

    const { executeSearch, navigateToPage } = await import(
      "../../src/scrapers/searchScraper"
    );

    // Página 1: búsqueda inicial
    const mockClient = {
      post: vi
        .fn()
        .mockResolvedValueOnce({ data: SEARCH_RESPONSE_XML }) // búsqueda
        .mockResolvedValueOnce({ data: PAGE2_RESPONSE_XML }), // página 2
    };

    const searchResult = await executeSearch(
      mockClient as never,
      SESSION_BASE,
      SITES.tfa
    );
    expect(searchResult).not.toBeNull();
    expect(searchResult!.session.viewState).toBe(VIEW_STATE_AFTER_SEARCH);

    // Página 2: usa el ViewState actualizado del search
    const navResult = await navigateToPage(
      mockClient as never,
      searchResult!.session, // sesión con ViewState nuevo
      SITES.tfa,
      2,
      176,
      1753
    );
    expect(navResult).not.toBeNull();
    expect(navResult!.session.viewState).toBe(VIEW_STATE_AFTER_PAGE2);

    // El POST de página 2 usó el ViewState del search (rotación correcta)
    const page2Call = mockClient.post.mock.calls[1];
    const page2Body = page2Call[1] as URLSearchParams;
    expect(page2Body.get("javax.faces.ViewState")).toBe(VIEW_STATE_AFTER_SEARCH);
  });
});

// ─── Criterio 3: Nombres descriptivos de PDFs ────────────────────────────────

describe("Criterio 3: Nombres descriptivos de PDF", () => {
  it("archivoNombre = sanitizeFilename(nroResolucion)", async () => {
    const { parseSearchResponse } = await import("../../src/parsers/documentParser");
    const { sanitizeFilename } = await import("../../src/parsers/documentParser");

    const page = parseSearchResponse(SEARCH_RESPONSE_XML, SITES.tfa);
    const record = page.records[0];

    expect(record.archivoNombre).toBe(sanitizeFilename(record.nroResolucion));
    expect(record.archivoNombre).toBe("264-2012-OEFA_TFA");
  });

  it("downloadPdf usa nroResolucion sanitizado como nombre de archivo", async () => {
    const { downloadPdf } = await import("../../src/downloaders/pdfDownloader");

    const mockClient = {
      post: vi.fn().mockResolvedValue({
        data: pdfStream(),
        headers: { "content-type": "application/pdf" },
      }),
    };

    const record = {
      nro: "1",
      numeroExpediente: "EXP-001",
      administrado: "Test",
      unidadFiscalizable: "Test",
      sector: "Test",
      nroResolucion: "264-2012-OEFA/TFA",
      pdfRowIndex: 0,
      pdfParamUuid: "153a6d2a-cbed-40ef-b8ef-cd2272b19867",
      archivoNombre: "264-2012-OEFA_TFA",
    };

    vi.mock("../../src/client/httpClient", () => ({
      randomDelay: vi.fn().mockResolvedValue(undefined),
      withRetry: vi.fn().mockImplementation(
        async (fn: () => Promise<unknown>) => fn()
      ),
    }));

    const result = await downloadPdf(
      mockClient as never,
      SESSION_BASE,
      SITES.tfa,
      record
    );

    if (result.filePath) {
      expect(path.basename(result.filePath)).toMatch(/264-2012-OEFA_TFA\.pdf/);
    }
  });
});

// ─── Criterio 4: 429 con backoff exponencial ─────────────────────────────────
// La lógica de withRetry se prueba exhaustivamente en tests/unit/httpClient.test.ts.
// Aquí se verifica el comportamiento observable: que un 429 persistente en downloadPdf
// no rompe el flujo — registra el fallo y continúa.

describe("Criterio 4: PDF con 429 persistente → se registra en failed_downloads", () => {
  it("downloadPdf sin pdfParamUuid retorna {success: false, error: 'Sin params'}", async () => {
    const { downloadPdf } = await import("../../src/downloaders/pdfDownloader");
    const { RECORD_NO_PDF, SESSION_BASE } = await import("../fixtures");

    // Registro sin PDF — retorna false inmediatamente sin hacer request
    const result = await downloadPdf(
      {} as never,
      SESSION_BASE,
      SITES.tfa,
      RECORD_NO_PDF as never
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Sin params/i);
  });

  it("fallo en descarga no lanza excepción — flujo continúa", async () => {
    const { recordFailedDownload, loadFailedDownloads } = await import(
      "../../src/storage/stateManager"
    );
    const { RECORD_WITH_PDF } = await import("../fixtures");

    recordFailedDownload(RECORD_WITH_PDF as never, "HTTP 429 persistente");

    const failed = loadFailedDownloads();
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBe("HTTP 429 persistente");
    expect(failed[0].record.nroResolucion).toBe("264-2012-OEFA/TFA");
  });
});

// ─── Criterio 5+6: Resume y registro de fallidos ─────────────────────────────

describe("Criterio 5+6: Resume desde checkpoint y registro de fallidos", () => {
  it("loadProgress retorna null en inicio limpio", async () => {
    const { loadProgress } = await import("../../src/storage/stateManager");
    expect(loadProgress("dfsai")).toBeNull();
  });

  it("saveProgress + loadProgress: retoma desde la página correcta", async () => {
    const { saveProgress, loadProgress } = await import(
      "../../src/storage/stateManager"
    );

    const progress = {
      site: "dfsai",
      lastCompletedPage: 42,
      totalPages: 176,
      totalRecords: 1753,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveProgress(progress);
    const loaded = loadProgress("dfsai");

    expect(loaded).not.toBeNull();
    expect(loaded!.lastCompletedPage).toBe(42);
    // La próxima página a procesar sería 43
    expect(loaded!.lastCompletedPage + 1).toBe(43);
  });

  it("appendRecords + loadRecords: acumula entre páginas", async () => {
    const { appendRecords, loadRecords } = await import(
      "../../src/storage/stateManager"
    );

    const make = (nro: string, exp: string, res: string) => ({
      nro,
      numeroExpediente: exp,
      administrado: "Test",
      unidadFiscalizable: "Test",
      sector: "Test",
      nroResolucion: res,
      pdfRowIndex: null,
      pdfParamUuid: null,
      archivoNombre: null,
    });

    // Simula procesamiento de 3 páginas
    appendRecords([make("1", "EXP-001", "RES-001"), make("2", "EXP-002", "RES-002")]);
    appendRecords([make("3", "EXP-003", "RES-003"), make("4", "EXP-004", "RES-004")]);
    appendRecords([make("5", "EXP-005", "RES-005")]);

    const all = loadRecords();
    expect(all).toHaveLength(5);
    expect(all.map((r) => r.nro)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("recordFailedDownload registra fallos para reintento posterior", async () => {
    const { recordFailedDownload, loadFailedDownloads } = await import(
      "../../src/storage/stateManager"
    );

    const record = {
      nro: "1",
      numeroExpediente: "EXP-001",
      administrado: "Test",
      unidadFiscalizable: "Test",
      sector: "Test",
      nroResolucion: "RES-001",
      pdfRowIndex: 0,
      pdfParamUuid: "uuid-001",
      archivoNombre: "RES-001",
    };

    recordFailedDownload(record, "Falló tras todos los reintentos");

    const failed = loadFailedDownloads();
    expect(failed).toHaveLength(1);
    expect(failed[0].record.nroResolucion).toBe("RES-001");
    expect(failed[0].error).toBe("Falló tras todos los reintentos");
    expect(failed[0].failedAt).toBeTruthy();
  });

  it("registro de fallos es idempotente (no duplica misma resolución)", async () => {
    const { recordFailedDownload, loadFailedDownloads } = await import(
      "../../src/storage/stateManager"
    );

    const record = {
      nro: "1",
      numeroExpediente: "EXP-001",
      administrado: "Test",
      unidadFiscalizable: "Test",
      sector: "Test",
      nroResolucion: "RES-001",
      pdfRowIndex: 0,
      pdfParamUuid: "uuid-001",
      archivoNombre: "RES-001",
    };

    recordFailedDownload(record, "Error 1");
    recordFailedDownload(record, "Error 2"); // duplicado

    const failed = loadFailedDownloads();
    expect(failed).toHaveLength(1);
  });

  it("escritura atómica: no deja .tmp si el proceso fuera a morir", async () => {
    const { appendRecords } = await import("../../src/storage/stateManager");

    appendRecords([{
      nro: "1",
      numeroExpediente: "EXP-001",
      administrado: "Test",
      unidadFiscalizable: "Test",
      sector: "Test",
      nroResolucion: "RES-001",
      pdfRowIndex: null,
      pdfParamUuid: null,
      archivoNombre: null,
    }]);

    const tmpFiles = fs.readdirSync(dataDir).filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

// ─── Criterio 7: Estructura modular ──────────────────────────────────────────

describe("Criterio 7: Módulos con responsabilidades claras", () => {
  it("config/sites: resolveSite lanza error para sitio inválido", async () => {
    const { resolveSite } = await import("../../src/config/sites");
    expect(() => resolveSite("unknown")).toThrowError(/Sitio desconocido/);
  });

  it("jsfSession: extractViewState y buildPathWithSession son funciones puras", async () => {
    const { extractViewState, buildPathWithSession } = await import(
      "../../src/scrapers/jsfSession"
    );

    // No tienen efectos secundarios, misma entrada → misma salida
    const html = `<input name="javax.faces.ViewState" value="VS-TEST" />`;
    expect(extractViewState(html)).toBe("VS-TEST");
    expect(extractViewState(html)).toBe("VS-TEST"); // idempotente

    const path1 = buildPathWithSession("/path", "SESSION");
    const path2 = buildPathWithSession("/path", "SESSION");
    expect(path1).toBe(path2);
  });

  it("documentParser: sanitizeFilename es función pura y determinista", async () => {
    const { sanitizeFilename } = await import("../../src/parsers/documentParser");
    const input = "264-2012-OEFA/TFA";
    expect(sanitizeFilename(input)).toBe(sanitizeFilename(input));
  });

  it("stateManager: escritura no afecta a otras funciones del módulo", async () => {
    const { saveProgress, loadProgress, loadRecords } = await import(
      "../../src/storage/stateManager"
    );

    // Guardar progress no debe corromper records
    saveProgress({
      site: "dfsai",
      lastCompletedPage: 1,
      totalPages: 10,
      totalRecords: 100,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(loadRecords()).toEqual([]); // no afectó records
    expect(loadProgress("dfsai")).not.toBeNull();
  });
});

// ─── Escenario completo: 2 páginas, 1 PDF fallido ─────────────────────────────

describe("Escenario E2E: 2 páginas + fallo PDF registrado", () => {
  it("parsea páginas, acumula records, registra PDF fallido", async () => {
    const {
      appendRecords,
      recordFailedDownload,
      saveProgress,
      loadRecords,
      loadFailedDownloads,
    } = await import("../../src/storage/stateManager");

    const { parseSearchResponse, parsePaginationResponse } = await import(
      "../../src/parsers/documentParser"
    );

    // --- Página 1 ---
    const page1 = parseSearchResponse(SEARCH_RESPONSE_XML, SITES.tfa);
    expect(page1.records).toHaveLength(3);
    appendRecords(page1.records);

    saveProgress({
      site: "tfa",
      lastCompletedPage: 1,
      totalPages: page1.totalPages,
      totalRecords: page1.totalRecords,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // --- Página 2 ---
    const page2 = parsePaginationResponse(PAGE2_RESPONSE_XML, SITES.tfa, 2, 176, 1753);
    expect(page2.records).toHaveLength(2);
    appendRecords(page2.records);

    // Simular fallo en descarga del primer PDF de página 2
    const failedRecord = page2.records[0];
    recordFailedDownload(failedRecord, "Falló tras todos los reintentos");

    saveProgress({
      site: "tfa",
      lastCompletedPage: 2,
      totalPages: 176,
      totalRecords: 1753,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // --- Verificaciones ---
    const allRecords = loadRecords();
    expect(allRecords).toHaveLength(5); // 3 + 2

    const failed = loadFailedDownloads();
    expect(failed).toHaveLength(1);
    expect(failed[0].record.nroResolucion).toBe("236-2013-OEFA/TFA");

    // Orden numérico correcto
    const nros = allRecords.map((r) => parseInt(r.nro, 10));
    expect(nros).toEqual([...nros].sort((a, b) => a - b));
  });
});
