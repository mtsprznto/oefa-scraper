import { AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import { SiteConfig } from "../config/sites";
import { env } from "../config/env";
import { log } from "../logger";

export interface JsfSession {
  viewState: string;
  jsessionId: string;
  siteUrl: string; // URL completa del sitio activo
}

// Obtiene sesión fresca: GET al sitio → extrae ViewState + JSESSIONID.
// Verificado en HTML real: ViewState en input[name="javax.faces.ViewState"],
// JSESSIONID en Set-Cookie.
export async function initSession(
  client: AxiosInstance,
  site: SiteConfig
): Promise<JsfSession> {
  const siteUrl = `${env.baseUrl}${site.path}`;

  const response = await client.get(site.path, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  const viewState = extractViewState(response.data as string);
  if (!viewState) {
    throw new Error(
      `No se encontró javax.faces.ViewState en ${site.label}. ¿Sesión expirada o URL incorrecta?`
    );
  }

  const setCookie = (response.headers["set-cookie"] as string[] | undefined) ?? [];
  const jsessionId = extractJsessionId(setCookie);

  log.info("Sesión JSF inicializada", {
    site: site.key,
    viewStatePrefix: viewState.substring(0, 20) + "...",
    jsessionIdPrefix: jsessionId.substring(0, 8) + "...",
  });

  return { viewState, jsessionId, siteUrl };
}

// ViewState rota en cada respuesta AJAX de PrimeFaces.
// Si no hay nuevo ViewState, retorna la sesión original (no debe ocurrir en uso normal).
export function updateViewState(
  session: JsfSession,
  partialResponseXml: string
): JsfSession {
  const newViewState = extractViewStateFromPartial(partialResponseXml);
  if (!newViewState) return session;
  return { ...session, viewState: newViewState };
}

// Detecta respuesta vacía inesperada que indica ViewState expirado.
// Distinto de 429: no hay error HTTP, el servidor devuelve 0 resultados silenciosamente.
export function isViewStateExpired(
  xml: string,
  expectedMinRecords: number
): boolean {
  if (expectedMinRecords === 0) return false;
  const match = xml.match(/rowCount:(\d+)/);
  const rowCount = match ? parseInt(match[1], 10) : 0;
  return rowCount === 0;
}

export function extractViewState(html: string): string | null {
  const $ = cheerio.load(html);
  return $('input[name="javax.faces.ViewState"]').attr("value") ?? null;
}

export function buildPathWithSession(
  sitePath: string,
  jsessionId: string
): string {
  if (!jsessionId) return sitePath;
  return `${sitePath};jsessionid=${jsessionId}`;
}

// PrimeFaces devuelve el ViewState actualizado en <update id="j_id1:javax.faces.ViewState:0">
function extractViewStateFromPartial(xml: string): string | null {
  const m = xml.match(
    /<update id="j_id1:javax\.faces\.ViewState:0"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/
  );
  return m?.[1] ?? null;
}

function extractJsessionId(setCookieHeaders: string[]): string {
  for (const header of setCookieHeaders) {
    const m = header.match(/JSESSIONID=([A-F0-9]+)/i);
    if (m) return m[1];
  }
  return "";
}
