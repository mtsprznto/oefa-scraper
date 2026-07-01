import { AxiosInstance } from "axios";
import {
  JsfSession,
  buildPathWithSession,
  updateViewState,
} from "./jsfSession";
import { SiteConfig } from "../config/sites";
import { ParsedPage, parseSearchResponse, parsePaginationResponse } from "../parsers/documentParser";
import { randomDelay, withRetry } from "../client/httpClient";
import { log } from "../logger";

// IDs de form verificados en HTML real — idénticos en TFA y DFSAI
const FORM_ID = "listarDetalleInfraccionRAAForm";

export interface SearchFilters {
  nroExpediente?: string;
  administrado?: string;
  unidadFiscalizable?: string;
  sector?: "" | "1" | "2" | "3" | "8" | "9";
  nroResolucion?: string;
}

export interface SearchResult {
  page: ParsedPage;
  session: JsfSession;
}

// Ejecuta la búsqueda inicial (click en Buscar).
export async function executeSearch(
  client: AxiosInstance,
  session: JsfSession,
  site: SiteConfig,
  filters: SearchFilters = {}
): Promise<SearchResult | null> {
  const xml = await withRetry(async () => {
    await randomDelay();
    const response = await client.post(
      buildPathWithSession(site.path, session.jsessionId),
      buildSearchPayload(session.viewState, filters),
      { headers: buildAjaxHeaders(session.siteUrl) }
    );
    return response.data as string;
  }, "executeSearch");

  if (!xml) return null;

  // Detectar HTTP 200 con body inesperado (captcha, error page, anti-bot).
  // partial-response válida de JSF siempre contiene el updateId del form.
  if (!xml.includes("listarDetalleInfraccionRAAForm")) {
    log.error("Respuesta no es partial-response JSF válida — posible bloqueo o captcha");
    return null;
  }

  const page = parseSearchResponse(xml, site);
  const updatedSession = updateViewState(session, xml);
  return { page, session: updatedSession };
}

// Navega a una página específica del DataTable PrimeFaces (1-indexed).
// Requiere totalPages y totalRecords del search inicial para reconstruir ParsedPage.
export async function navigateToPage(
  client: AxiosInstance,
  session: JsfSession,
  site: SiteConfig,
  pageNumber: number,
  totalPages: number,
  totalRecords: number,
  filters: SearchFilters = {}
): Promise<SearchResult | null> {
  const xml = await withRetry(async () => {
    await randomDelay();
    const response = await client.post(
      buildPathWithSession(site.path, session.jsessionId),
      buildPaginationPayload(session.viewState, filters, pageNumber),
      { headers: buildAjaxHeaders(session.siteUrl) }
    );
    return response.data as string;
  }, `navigateToPage(${pageNumber})`);

  if (!xml) return null;

  const page = parsePaginationResponse(xml, site, pageNumber, totalPages, totalRecords);
  const updatedSession = updateViewState(session, xml);

  // 0 registros en una página que debería tener datos = ViewState expirado o respuesta inesperada.
  // Se retorna igualmente — el caller (index.ts) detecta el vacío y re-inicializa sesión.
  // Loguear aquí para trazabilidad: distingue expiración de sesión vs error de red (que retorna null).
  if (page.records.length === 0) {
    log.warn("Respuesta vacía en paginación — posible ViewState expirado", {
      page: pageNumber,
      site: site.key,
    });
  }

  return { page, session: updatedSession };
}

// Payload del botón Buscar — verificado en HAR real del sitio
function buildSearchPayload(
  viewState: string,
  filters: SearchFilters
): URLSearchParams {
  const p = new URLSearchParams();
  // Orden y parámetros exactos del HAR capturado
  p.append("javax.faces.partial.ajax", "true");
  p.append("javax.faces.source", `${FORM_ID}:btnBuscar`);
  p.append("javax.faces.partial.execute", "@all"); // HAR usa @all, no btnBuscar+txtNroexp
  p.append("javax.faces.partial.render", `${FORM_ID}:pgLista ${FORM_ID}:txtNroexp`);
  p.append(`${FORM_ID}:btnBuscar`, `${FORM_ID}:btnBuscar`); // param extra del HAR
  p.append(FORM_ID, FORM_ID);
  p.append(`${FORM_ID}:txtNroexp`, filters.nroExpediente ?? "");
  p.append(`${FORM_ID}:j_idt21`, filters.administrado ?? "");
  p.append(`${FORM_ID}:j_idt25`, filters.unidadFiscalizable ?? "");
  p.append(`${FORM_ID}:idsector`, filters.sector ?? "");
  p.append(`${FORM_ID}:j_idt34`, filters.nroResolucion ?? "");
  p.append(`${FORM_ID}:dt_scrollState`, "0,0");
  p.append("javax.faces.ViewState", viewState);
  return p;
}

// Paginación PrimeFaces DataTable — payload verificado en HAR real.
// Usa dt_first (offset de registros) no índice de página.
function buildPaginationPayload(
  viewState: string,
  filters: SearchFilters,
  pageNumber: number
): URLSearchParams {
  const ROWS = 10;
  const first = (pageNumber - 1) * ROWS; // offset: página 2 → first=10, página 3 → first=20
  const p = new URLSearchParams();
  p.append("javax.faces.partial.ajax", "true");
  p.append("javax.faces.source", `${FORM_ID}:dt`);
  p.append("javax.faces.partial.execute", `${FORM_ID}:dt`);
  p.append("javax.faces.partial.render", `${FORM_ID}:dt`);
  p.append(`${FORM_ID}:dt`, `${FORM_ID}:dt`);
  p.append(`${FORM_ID}:dt_pagination`, "true");
  p.append(`${FORM_ID}:dt_first`, String(first));
  p.append(`${FORM_ID}:dt_rows`, String(ROWS));
  p.append(`${FORM_ID}:dt_skipChildren`, "true");
  p.append(`${FORM_ID}:dt_encodeFeature`, "true");
  p.append(FORM_ID, FORM_ID);
  p.append(`${FORM_ID}:txtNroexp`, filters.nroExpediente ?? "");
  p.append(`${FORM_ID}:j_idt21`, filters.administrado ?? "");
  p.append(`${FORM_ID}:j_idt25`, filters.unidadFiscalizable ?? "");
  p.append(`${FORM_ID}:idsector`, filters.sector ?? "");
  p.append(`${FORM_ID}:j_idt34`, filters.nroResolucion ?? "");
  p.append(`${FORM_ID}:dt_scrollState`, "0,0");
  p.append("javax.faces.ViewState", viewState);
  return p;
}

function buildAjaxHeaders(siteUrl: string): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Faces-Request": "partial/ajax",
    "X-Requested-With": "XMLHttpRequest",
    Referer: siteUrl,
    Accept: "application/xml, text/xml, */*; q=0.01",
  };
}
