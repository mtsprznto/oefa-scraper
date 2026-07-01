import * as cheerio from "cheerio";
import { SiteConfig } from "../config/sites";
import { log } from "../logger";

export interface DocumentRecord {
  nro: string;
  numeroExpediente: string;
  administrado: string;
  unidadFiscalizable: string;
  sector: string;
  nroResolucion: string;
  // PDF: POST no-AJAX con rowIndex global (data-ri) y param_uuid del onclick de mojarra
  pdfRowIndex: number | null;
  pdfParamUuid: string | null;
  archivoNombre: string | null;
}

export interface ParsedPage {
  records: DocumentRecord[];
  totalRecords: number;
  currentPage: number;
  totalPages: number;
}

// Parsea respuesta de búsqueda inicial (update id="pgLista").
// Contiene el datatable completo con totales.
export function parseSearchResponse(partialXml: string, site: SiteConfig): ParsedPage {
  const cdata = extractCdata(partialXml, "listarDetalleInfraccionRAAForm:pgLista");
  if (!cdata) return emptyPage();

  const scriptMatch = cdata.match(/rowCount:(\d+),page:(\d+)/);
  const totalRecords = scriptMatch ? parseInt(scriptMatch[1], 10) : 0;
  const pageIndex = scriptMatch ? parseInt(scriptMatch[2], 10) : 0;
  const rowsPerPage = parseInt(cdata.match(/rows:(\d+)/)?.[1] ?? "10", 10);
  const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / rowsPerPage) : 1;

  const records = parseRows(cdata, site);

  log.debug("Search response parseado", {
    site: site.key,
    page: pageIndex + 1,
    totalPages,
    records: records.length,
    totalRecords,
  });

  return { records, totalRecords, currentPage: pageIndex + 1, totalPages };
}

// Parsea respuesta de paginación (update id="dt").
// No incluye totales — solo las filas de la página actual.
export function parsePaginationResponse(
  partialXml: string,
  site: SiteConfig,
  pageNumber: number,
  totalPages: number,
  totalRecords: number
): ParsedPage {
  const cdata = extractCdata(partialXml, "listarDetalleInfraccionRAAForm:dt");
  if (!cdata) return emptyPage();

  const records = parseRows(cdata, site);

  log.debug("Pagination response parseado", {
    site: site.key,
    page: pageNumber,
    totalPages,
    records: records.length,
  });

  return { records, totalRecords, currentPage: pageNumber, totalPages };
}

// Extrae las filas de datos del HTML del datatable.
// data-ri contiene el índice global del registro — usado en el POST de descarga PDF.
// El CDATA de paginación llega sin <table>/<tbody> wrapper — cheerio descarta <tr>
// huérfanos por defecto, por eso se envuelve antes de parsear.
function parseRows(html: string, _site: SiteConfig): DocumentRecord[] {
  const wrapped = html.trimStart().startsWith("<tr") ? `<table><tbody>${html}</tbody></table>` : html;
  const $ = cheerio.load(wrapped);
  const records: DocumentRecord[] = [];

  $("tr[data-ri]").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 7) return;

    const onclick = $(tds[6]).find("[onclick]").attr("onclick") ?? null;
    const pdfData = extractPdfParams(onclick);
    const nroResolucion = $(tds[5]).text().trim();

    records.push({
      nro: $(tds[0]).text().trim(),
      numeroExpediente: $(tds[1]).text().trim(),
      administrado: $(tds[2]).text().trim(),
      unidadFiscalizable: $(tds[3]).text().trim(),
      sector: $(tds[4]).text().trim(),
      nroResolucion,
      pdfRowIndex: pdfData?.rowIndex ?? null,
      pdfParamUuid: pdfData?.paramUuid ?? null,
      archivoNombre: sanitizeFilename(nroResolucion),
    });
  });

  return records;
}

// Extrae el contenido CDATA de un <update id="..."> sin usar regex.
// Los caracteres especiales del updateId (":") y del delimitador CDATA ("]]>")
// hacen que la construcción dinámica de regex sea propensa a errores.
function extractCdata(xml: string, updateId: string): string | null {
  const openTag = `<update id="${updateId}"><![CDATA[`;
  const closeTag = `]]></update>`;
  const start = xml.indexOf(openTag);
  if (start === -1) return null;
  const contentStart = start + openTag.length;
  const end = xml.indexOf(closeTag, contentStart);
  if (end === -1) return null;
  return xml.substring(contentStart, end);
}

interface PdfParams {
  rowIndex: number;
  paramUuid: string;
}

// Formato verificado en HAR: mojarra.jsfcljs con {dt:{rowIndex}:j_idt63, param_uuid}
// El rowIndex es global (data-ri), no relativo a la página.
function extractPdfParams(onclick: string | null): PdfParams | null {
  if (!onclick) return null;
  const rowMatch = onclick.match(/dt:(\d+):j_idt63/);
  const uuidMatch = onclick.match(/'param_uuid'\s*:\s*'([^']+)'/);
  if (!rowMatch || !uuidMatch) return null;
  return { rowIndex: parseInt(rowMatch[1], 10), paramUuid: uuidMatch[1] };
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 200);
}

function emptyPage(): ParsedPage {
  return { records: [], totalRecords: 0, currentPage: 1, totalPages: 1 };
}
