import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractViewState,
  buildPathWithSession,
  updateViewState,
  initSession,
} from "../../src/scrapers/jsfSession";
import {
  INITIAL_HTML_WITH_VIEWSTATE,
  INITIAL_HTML_NO_VIEWSTATE,
  VIEW_STATE_INITIAL,
  VIEW_STATE_AFTER_SEARCH,
  JSESSION_ID,
  SESSION_BASE,
  SEARCH_RESPONSE_XML,
} from "../fixtures";
import { SITES } from "../../src/config/sites";

// ─── extractViewState ─────────────────────────────────────────────────────────

describe("extractViewState()", () => {
  it("extrae ViewState del HTML real", () => {
    const vs = extractViewState(INITIAL_HTML_WITH_VIEWSTATE);
    expect(vs).toBe(VIEW_STATE_INITIAL);
  });

  it("retorna null si no hay ViewState en el HTML", () => {
    const vs = extractViewState(INITIAL_HTML_NO_VIEWSTATE);
    expect(vs).toBeNull();
  });

  it("retorna null para HTML vacío", () => {
    expect(extractViewState("")).toBeNull();
  });

  it("extrae el primer ViewState si hay múltiples inputs", () => {
    const html = `
      <input name="javax.faces.ViewState" value="FIRST" />
      <input name="javax.faces.ViewState" value="SECOND" />
    `;
    // cheerio retorna el primero
    const vs = extractViewState(html);
    expect(vs).toBe("FIRST");
  });
});

// ─── buildPathWithSession ─────────────────────────────────────────────────────

describe("buildPathWithSession()", () => {
  it("agrega jsessionid al path", () => {
    const result = buildPathWithSession("/repdig/consulta/consultaTfa.xhtml", JSESSION_ID);
    expect(result).toBe(
      `/repdig/consulta/consultaTfa.xhtml;jsessionid=${JSESSION_ID}`
    );
  });

  it("retorna path sin modificar si jsessionId es vacío", () => {
    const path = "/repdig/consulta/consultaTfa.xhtml";
    expect(buildPathWithSession(path, "")).toBe(path);
  });
});

// ─── updateViewState ──────────────────────────────────────────────────────────

describe("updateViewState()", () => {
  it("extrae nuevo ViewState del XML de respuesta AJAX", () => {
    const updated = updateViewState(SESSION_BASE, SEARCH_RESPONSE_XML);
    expect(updated.viewState).toBe(VIEW_STATE_AFTER_SEARCH);
    // jsessionId y siteUrl no cambian
    expect(updated.jsessionId).toBe(SESSION_BASE.jsessionId);
    expect(updated.siteUrl).toBe(SESSION_BASE.siteUrl);
  });

  it("retorna sesión original si el XML no tiene ViewState", () => {
    const xml = `<partial-response><changes></changes></partial-response>`;
    const updated = updateViewState(SESSION_BASE, xml);
    expect(updated).toBe(SESSION_BASE); // misma referencia
  });

  it("el ViewState actualizado difiere del original", () => {
    const updated = updateViewState(SESSION_BASE, SEARCH_RESPONSE_XML);
    expect(updated.viewState).not.toBe(SESSION_BASE.viewState);
  });
});


// ─── initSession ─────────────────────────────────────────────────────────────

describe("initSession()", () => {
  it("extrae ViewState y JSESSIONID de la respuesta GET", async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue({
        data: INITIAL_HTML_WITH_VIEWSTATE,
        headers: {
          "set-cookie": [`JSESSIONID=${JSESSION_ID}; Path=/; HttpOnly`],
        },
      }),
    };

    const session = await initSession(
      mockClient as never,
      SITES.tfa
    );

    expect(session.viewState).toBe(VIEW_STATE_INITIAL);
    expect(session.jsessionId).toBe(JSESSION_ID);
    expect(session.siteUrl).toContain(SITES.tfa.path);
    expect(mockClient.get).toHaveBeenCalledWith(
      SITES.tfa.path,
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("lanza error si no hay ViewState en el HTML", async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue({
        data: INITIAL_HTML_NO_VIEWSTATE,
        headers: { "set-cookie": [] },
      }),
    };

    await expect(initSession(mockClient as never, SITES.tfa)).rejects.toThrow(
      /javax\.faces\.ViewState/
    );
  });

  it("maneja Set-Cookie ausente (jsessionId vacío)", async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue({
        data: INITIAL_HTML_WITH_VIEWSTATE,
        headers: {},
      }),
    };

    const session = await initSession(mockClient as never, SITES.tfa);
    expect(session.jsessionId).toBe("");
  });
});
