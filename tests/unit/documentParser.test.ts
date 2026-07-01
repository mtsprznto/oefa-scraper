import { describe, it, expect } from "vitest";
import {
  parseSearchResponse,
  parsePaginationResponse,
  sanitizeFilename,
} from "../../src/parsers/documentParser";
import {
  SEARCH_RESPONSE_XML,
  SEARCH_RESPONSE_EMPTY_XML,
  PAGE2_RESPONSE_XML,
  PAGE_EMPTY_RESPONSE_XML,
} from "../fixtures";
import { SITES } from "../../src/config/sites";

// ─── parseSearchResponse ──────────────────────────────────────────────────────

describe("parseSearchResponse()", () => {
  it("parsea totales del XML real (1753 registros, 176 páginas)", () => {
    const page = parseSearchResponse(SEARCH_RESPONSE_XML, SITES.tfa);
    expect(page.totalRecords).toBe(1753);
    expect(page.totalPages).toBe(176); // Math.ceil(1753 / 10)
    expect(page.currentPage).toBe(1);  // page:0 → +1
  });

  it("parsea 3 registros del XML fixture", () => {
    const page = parseSearchResponse(SEARCH_RESPONSE_XML, SITES.tfa);
    expect(page.records).toHaveLength(3);
  });

  it("primer registro: campos exactos del HAR real", () => {
    const page = parseSearchResponse(SEARCH_RESPONSE_XML, SITES.tfa);
    const r = page.records[0];
    expect(r.nro).toBe("1");
    expect(r.numeroExpediente).toBe("891-08-PRODUCE/DIGSECOVI-Dsvs");
    expect(r.administrado).toBe("Corporación del Mar  S.A.");
    expect(r.unidadFiscalizable).toBe("Planta Playa Lado Norte Puerto Malabrigo");
    expect(r.sector).toBe("Pesquería");
    expect(r.nroResolucion).toBe("264-2012-OEFA/TFA");
  });

  it("primer registro: PDF params extraídos del onclick", () => {
    const page = parseSearchResponse(SEARCH_RESPONSE_XML, SITES.tfa);
    const r = page.records[0];
    expect(r.pdfRowIndex).toBe(0);
    expect(r.pdfParamUuid).toBe("153a6d2a-cbed-40ef-b8ef-cd2272b19867");
  });

  it("segundo registro: pdfRowIndex=1, UUID correcto", () => {
    const page = parseSearchResponse(SEARCH_RESPONSE_XML, SITES.tfa);
    const r = page.records[1];
    expect(r.pdfRowIndex).toBe(1);
    expect(r.pdfParamUuid).toBe("9c8d4d4a-846f-4e41-b047-4dbb8b1d2571");
  });

  it("archivoNombre es la versión sanitizada de nroResolucion", () => {
    const page = parseSearchResponse(SEARCH_RESPONSE_XML, SITES.tfa);
    const r = page.records[0];
    // "264-2012-OEFA/TFA" → sanitizeFilename reemplaza "/" por "_"
    expect(r.archivoNombre).toBe("264-2012-OEFA_TFA");
  });

  it("retorna emptyPage() si no hay update id=pgLista", () => {
    const xml = `<partial-response><changes></changes></partial-response>`;
    const page = parseSearchResponse(xml, SITES.tfa);
    expect(page.totalRecords).toBe(0);
    expect(page.records).toHaveLength(0);
  });

  it("retorna emptyPage() en XML de búsqueda vacía (0 resultados)", () => {
    const page = parseSearchResponse(SEARCH_RESPONSE_EMPTY_XML, SITES.tfa);
    expect(page.totalRecords).toBe(0);
    expect(page.records).toHaveLength(0);
    expect(page.totalPages).toBe(1);
  });

  it("funciona igual con site dfsai (misma estructura HTML)", () => {
    const page = parseSearchResponse(SEARCH_RESPONSE_XML, SITES.dfsai);
    expect(page.totalRecords).toBe(1753);
    expect(page.records).toHaveLength(3);
  });
});

// ─── parsePaginationResponse ──────────────────────────────────────────────────

describe("parsePaginationResponse()", () => {
  it("parsea página 2 del XML real (data-ri empezando en 10)", () => {
    const page = parsePaginationResponse(PAGE2_RESPONSE_XML, SITES.tfa, 2, 176, 1753);
    expect(page.currentPage).toBe(2);
    expect(page.totalPages).toBe(176);
    expect(page.totalRecords).toBe(1753);
    expect(page.records).toHaveLength(2);
  });

  it("primer registro página 2: datos correctos del HAR real", () => {
    const page = parsePaginationResponse(PAGE2_RESPONSE_XML, SITES.tfa, 2, 176, 1753);
    const r = page.records[0];
    expect(r.nro).toBe("11");
    expect(r.numeroExpediente).toBe("657-2011-PRODUCE/DIGSECOVI-Dsvs");
    expect(r.administrado).toBe("Instituto Tecnológico de la Producción");
    expect(r.nroResolucion).toBe("236-2013-OEFA/TFA");
    expect(r.pdfRowIndex).toBe(10); // data-ri global, no relativo
    expect(r.pdfParamUuid).toBe("746821e4-f99f-4e5c-90e2-7e2e2e3731d8");
  });

  it("retorna emptyPage si no hay update id=dt", () => {
    const xml = `<partial-response><changes></changes></partial-response>`;
    const page = parsePaginationResponse(xml, SITES.tfa, 5, 176, 1753);
    expect(page.records).toHaveLength(0);
    expect(page.currentPage).toBe(1); // emptyPage default
  });

  it("retorna página vacía correctamente (ViewState expirado)", () => {
    const page = parsePaginationResponse(PAGE_EMPTY_RESPONSE_XML, SITES.tfa, 3, 176, 1753);
    expect(page.records).toHaveLength(0);
  });
});

// ─── sanitizeFilename ─────────────────────────────────────────────────────────

describe("sanitizeFilename()", () => {
  it("reemplaza / con _", () => {
    expect(sanitizeFilename("264-2012-OEFA/TFA")).toBe("264-2012-OEFA_TFA");
  });

  it("reemplaza caracteres prohibidos en nombres de archivo", () => {
    const chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    for (const c of chars) {
      expect(sanitizeFilename(`test${c}name`)).toBe("test_name");
    }
  });

  it("colapsa múltiples espacios en uno", () => {
    expect(sanitizeFilename("264   2012")).toBe("264 2012");
  });

  it("trim: elimina espacios iniciales y finales", () => {
    expect(sanitizeFilename("  264-2012  ")).toBe("264-2012");
  });

  it("trunca a 200 caracteres máximo", () => {
    const long = "A".repeat(300);
    expect(sanitizeFilename(long)).toHaveLength(200);
  });

  it("cadena vacía retorna cadena vacía", () => {
    expect(sanitizeFilename("")).toBe("");
  });

  it("nombre normal sin caracteres especiales no se modifica", () => {
    expect(sanitizeFilename("007-2016-OEFA-TFA-SEPIM")).toBe("007-2016-OEFA-TFA-SEPIM");
  });
});
