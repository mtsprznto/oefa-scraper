import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SEARCH_RESPONSE_XML,
  PAGE2_RESPONSE_XML,
  SESSION_BASE,
  VIEW_STATE_AFTER_SEARCH,
  VIEW_STATE_AFTER_PAGE2,
} from "../fixtures";
import { SITES } from "../../src/config/sites";

// Mock de httpClient para evitar delays reales
vi.mock("../../src/client/httpClient", () => ({
  randomDelay: vi.fn().mockResolvedValue(undefined),
  withRetry: vi.fn().mockImplementation(
    async (fn: () => Promise<unknown>) => fn()
  ),
}));

// ─── executeSearch ────────────────────────────────────────────────────────────

describe("executeSearch()", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hace POST con los params correctos del HAR", async () => {
    const { executeSearch } = await import("../../src/scrapers/searchScraper");
    const mockClient = {
      post: vi.fn().mockResolvedValue({ data: SEARCH_RESPONSE_XML }),
    };

    await executeSearch(mockClient as never, SESSION_BASE, SITES.tfa);

    expect(mockClient.post).toHaveBeenCalledOnce();
    const [url, body, config] = mockClient.post.mock.calls[0];

    // URL incluye jsessionid
    expect(url).toContain(";jsessionid=");
    expect(url).toContain(SITES.tfa.path);

    // Headers AJAX
    expect(config.headers["Faces-Request"]).toBe("partial/ajax");
    expect(config.headers["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(config.headers["Content-Type"]).toContain(
      "application/x-www-form-urlencoded"
    );

    // Body: params verificados en HAR
    const params = body as URLSearchParams;
    expect(params.get("javax.faces.partial.ajax")).toBe("true");
    expect(params.get("javax.faces.source")).toBe(
      "listarDetalleInfraccionRAAForm:btnBuscar"
    );
    expect(params.get("javax.faces.partial.execute")).toBe("@all");
    expect(params.get("javax.faces.ViewState")).toBe(SESSION_BASE.viewState);
  });

  it("retorna SearchResult con página parseada y sesión actualizada", async () => {
    const { executeSearch } = await import("../../src/scrapers/searchScraper");
    const mockClient = {
      post: vi.fn().mockResolvedValue({ data: SEARCH_RESPONSE_XML }),
    };

    const result = await executeSearch(mockClient as never, SESSION_BASE, SITES.tfa);

    expect(result).not.toBeNull();
    expect(result!.page.totalRecords).toBe(1753);
    expect(result!.page.totalPages).toBe(176);
    expect(result!.page.currentPage).toBe(1);
    expect(result!.page.records).toHaveLength(3);
    // ViewState debe haberse actualizado con el del XML de respuesta
    expect(result!.session.viewState).toBe(VIEW_STATE_AFTER_SEARCH);
  });

  it("retorna null si withRetry falla (retorna null)", async () => {
    const { withRetry } = await import("../../src/client/httpClient");
    vi.mocked(withRetry).mockResolvedValueOnce(null);

    const { executeSearch } = await import("../../src/scrapers/searchScraper");
    const mockClient = { post: vi.fn() };

    const result = await executeSearch(mockClient as never, SESSION_BASE, SITES.tfa);
    expect(result).toBeNull();
  });

  it("aplica filtros en el body del POST", async () => {
    const { executeSearch } = await import("../../src/scrapers/searchScraper");
    const mockClient = {
      post: vi.fn().mockResolvedValue({ data: SEARCH_RESPONSE_XML }),
    };

    await executeSearch(mockClient as never, SESSION_BASE, SITES.tfa, {
      nroExpediente: "EXP-001",
      sector: "1",
    });

    const [, body] = mockClient.post.mock.calls[0];
    const params = body as URLSearchParams;
    expect(params.get("listarDetalleInfraccionRAAForm:txtNroexp")).toBe("EXP-001");
    expect(params.get("listarDetalleInfraccionRAAForm:idsector")).toBe("1");
  });
});

// ─── navigateToPage ───────────────────────────────────────────────────────────

describe("navigateToPage()", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hace POST con dt_first correcto (página 2 → first=10)", async () => {
    const { navigateToPage } = await import("../../src/scrapers/searchScraper");
    const mockClient = {
      post: vi.fn().mockResolvedValue({ data: PAGE2_RESPONSE_XML }),
    };

    await navigateToPage(mockClient as never, SESSION_BASE, SITES.tfa, 2, 176, 1753);

    const [, body] = mockClient.post.mock.calls[0];
    const params = body as URLSearchParams;
    expect(params.get("listarDetalleInfraccionRAAForm:dt_first")).toBe("10");
    expect(params.get("listarDetalleInfraccionRAAForm:dt_rows")).toBe("10");
    expect(params.get("listarDetalleInfraccionRAAForm:dt_pagination")).toBe("true");
    expect(params.get("javax.faces.source")).toBe("listarDetalleInfraccionRAAForm:dt");
  });

  it("página 3 → dt_first=20", async () => {
    const { navigateToPage } = await import("../../src/scrapers/searchScraper");
    const mockClient = {
      post: vi.fn().mockResolvedValue({ data: PAGE2_RESPONSE_XML }),
    };

    await navigateToPage(mockClient as never, SESSION_BASE, SITES.tfa, 3, 176, 1753);

    const [, body] = mockClient.post.mock.calls[0];
    const params = body as URLSearchParams;
    expect(params.get("listarDetalleInfraccionRAAForm:dt_first")).toBe("20");
  });

  it("página 1 → dt_first=0", async () => {
    const { navigateToPage } = await import("../../src/scrapers/searchScraper");
    const mockClient = {
      post: vi.fn().mockResolvedValue({ data: PAGE2_RESPONSE_XML }),
    };

    await navigateToPage(mockClient as never, SESSION_BASE, SITES.tfa, 1, 176, 1753);

    const [, body] = mockClient.post.mock.calls[0];
    const params = body as URLSearchParams;
    expect(params.get("listarDetalleInfraccionRAAForm:dt_first")).toBe("0");
  });

  it("retorna SearchResult con registros de página 2 y ViewState actualizado", async () => {
    const { navigateToPage } = await import("../../src/scrapers/searchScraper");
    const mockClient = {
      post: vi.fn().mockResolvedValue({ data: PAGE2_RESPONSE_XML }),
    };

    const result = await navigateToPage(
      mockClient as never,
      SESSION_BASE,
      SITES.tfa,
      2,
      176,
      1753
    );

    expect(result).not.toBeNull();
    expect(result!.page.currentPage).toBe(2);
    expect(result!.page.totalPages).toBe(176);
    expect(result!.page.records).toHaveLength(2);
    expect(result!.page.records[0].pdfRowIndex).toBe(10); // data-ri global
    expect(result!.session.viewState).toBe(VIEW_STATE_AFTER_PAGE2);
  });

  it("retorna null si withRetry falla", async () => {
    const { withRetry } = await import("../../src/client/httpClient");
    vi.mocked(withRetry).mockResolvedValueOnce(null);

    const { navigateToPage } = await import("../../src/scrapers/searchScraper");
    const mockClient = { post: vi.fn() };

    const result = await navigateToPage(
      mockClient as never,
      SESSION_BASE,
      SITES.tfa,
      2,
      176,
      1753
    );
    expect(result).toBeNull();
  });
});
