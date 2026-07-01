/**
 * Fixtures extraídos de HAR reales capturados el 2026-07-01.
 * Los XML son las respuestas exactas del servidor (recortadas para legibilidad
 * pero manteniendo toda la estructura que el parser consume).
 */

// ─── ViewStates reales del HAR ────────────────────────────────────────────────

export const VIEW_STATE_INITIAL =
  "egbc4cAkNwsA2U7E7tYD099qBDlVArSQN3Gcgf5G1eu/bCXfwFVcsAR9uMQx1Z9Dzu43lLiUpUt6Fy+vRWtiBxk3XmUPG6yJKSW/1MNlxlICl+2J9zAVRfYbv2vyZG4sqauo0qq3/kzyc/XJomkjBKpTUVv2DLo2aod8LKI3h25KkNKlel5FD26kgjRnfTViDdbIAvHlHGnNTuPvK9Zl4o95NV8I3x1M23wG4Is+JEXwboABCD1234";

export const VIEW_STATE_AFTER_SEARCH =
  "vycaNgaUxY5e8M6ys2atwDEt0YZCy+SxDOO5tBPU6CNoWsLeNbl1SyZ6jJy49clqdTEBkI0kCUiWoYwVpk3EP5X4Bji/YcOdXJmvnmGqbYJ5PjKx9Jfa8jjquzBRIsiqEldcLK8b/ZZbwcB8Ggck22/LfitD5EoUZ13kQD7dwDsel7DOwt9zVrAb1XaR/zFvMLTsUua9TuZ7AMgHfpXVb774yZ/TEST_AFTER_SEARCH";

export const VIEW_STATE_AFTER_PAGE2 =
  "Xc2cxuNB0zMo+ovX6atr+j4z+O0YWmBA8I8eB1S2ujP9zA5VhsmxGN2wNOY53Fxetou6yI93x156NKkB1hm5/TEST_AFTER_PAGE2";

export const JSESSION_ID = "6B311836CB10A8FC01FEEC81E42E346A";

// ─── HTML de la página inicial (GET) ─────────────────────────────────────────

export const INITIAL_HTML_WITH_VIEWSTATE = `
<!DOCTYPE html>
<html>
<head><title>Consulta TFA</title></head>
<body>
<form id="listarDetalleInfraccionRAAForm">
  <input type="hidden" name="javax.faces.ViewState" value="${VIEW_STATE_INITIAL}" />
  <input type="text" name="listarDetalleInfraccionRAAForm:txtNroexp" />
  <input type="submit" id="listarDetalleInfraccionRAAForm:btnBuscar" />
</form>
</body>
</html>
`;

export const INITIAL_HTML_NO_VIEWSTATE = `
<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body><p>Session expired</p></body>
</html>
`;

// ─── Respuesta XML de executeSearch (búsqueda inicial) ────────────────────────
// Extraído del HAR real: publico.oefa.gob.pe_Archive [26-07-01 10-31-36].har
// rowCount:1753, page:0 → 176 páginas de 10 registros

// NOTA: el CDATA de pgLista debe contener una tabla completa para que cheerio
// pueda encontrar los tr[data-ri] — sin <table> wrapper cheerio descarta los <tr>.
// Estructura extraída del HAR real con la tabla completa preservada.
export const SEARCH_RESPONSE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<partial-response id="j_id1"><changes><update id="listarDetalleInfraccionRAAForm:txtNroexp"><![CDATA[<input id="listarDetalleInfraccionRAAForm:txtNroexp" type="text" name="listarDetalleInfraccionRAAForm:txtNroexp" value="" class="cajaTexto" maxlength="100" size="30" />]]></update><update id="listarDetalleInfraccionRAAForm:pgLista"><![CDATA[<span id="listarDetalleInfraccionRAAForm:pgLista"><div id="listarDetalleInfraccionRAAForm:dt" class="ui-datatable ui-widget ui-datatable-scrollable" style="margin-bottom:20px;width:100%;"><div class="ui-datatable-scrollable-body" tabindex="-1"><table role="grid" class="grillaFlat"><tbody id="listarDetalleInfraccionRAAForm:dt_data" class="ui-datatable-data ui-widget-content"><tr data-ri="0" class="ui-widget-content ui-datatable-even" role="row"><td role="gridcell" style="text-align:center;vertical-align:top;"> 1</td><td role="gridcell" style="text-align: justify;vertical-align:top;">891-08-PRODUCE/DIGSECOVI-Dsvs</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Corporación del Mar  S.A.</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Planta Playa Lado Norte Puerto Malabrigo</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Pesquería</td><td role="gridcell" style="text-align:left;">264-2012-OEFA/TFA</td><td role="gridcell" style="text-align: center;vertical-align:top;"><a href="#" title="" onclick="mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm'),{'listarDetalleInfraccionRAAForm:dt:0:j_idt63':'listarDetalleInfraccionRAAForm:dt:0:j_idt63','param_uuid':'153a6d2a-cbed-40ef-b8ef-cd2272b19867'},'');return false"><img src="../images/pdf_descarga.png" alt="" style="border:0;width:25px" /></a></td></tr><tr data-ri="1" class="ui-widget-content ui-datatable-odd" role="row"><td role="gridcell" style="text-align:center;vertical-align:top;"> 2</td><td role="gridcell" style="text-align: justify;vertical-align:top;">857-2011-PRODUCE/DIGSECOVI-Dsvs</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Consorcio Pacífico Sur S.R.L.</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Planta de Congelado y Harina Residual</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Pesquería</td><td role="gridcell" style="text-align:left;">007-2016-OEFA/TFA-SEPIM</td><td role="gridcell" style="text-align: center;vertical-align:top;"><a href="#" title="" onclick="mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm'),{'listarDetalleInfraccionRAAForm:dt:1:j_idt63':'listarDetalleInfraccionRAAForm:dt:1:j_idt63','param_uuid':'9c8d4d4a-846f-4e41-b047-4dbb8b1d2571'},'');return false"><img src="../images/pdf_descarga.png" alt="" style="border:0;width:25px" /></a></td></tr><tr data-ri="2" class="ui-widget-content ui-datatable-even" role="row"><td role="gridcell"> 3</td><td role="gridcell">853-2011-PRODUCE/DIGSECOVI-Dsvs</td><td role="gridcell">Nutrifish S.A.C.</td><td role="gridcell">Planta procesamiento</td><td role="gridcell">Pesquería</td><td role="gridcell">019-2015-OEFA/TFA-SEPIM</td><td role="gridcell"><a href="#" onclick="mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm'),{'listarDetalleInfraccionRAAForm:dt:2:j_idt63':'listarDetalleInfraccionRAAForm:dt:2:j_idt63','param_uuid':'c49ed7f3-85ea-42ff-a290-cc39dc206f51'},'');return false"></a></td></tr></tbody></table></div><div id="listarDetalleInfraccionRAAForm:dt_paginator_bottom" class="ui-paginator"><span class="ui-paginator-current">Página 1 de 176 (1753 registros)</span></div><script id="listarDetalleInfraccionRAAForm:dt_s" type="text/javascript">$(function(){PrimeFaces.cw("DataTable","widget_listarDetalleInfraccionRAAForm_dt",{id:"listarDetalleInfraccionRAAForm:dt",paginator:{id:['listarDetalleInfraccionRAAForm:dt_paginator_bottom'],rows:10,rowCount:1753,page:0,currentPageTemplate:'Página {currentPage} de {totalPages} ({totalRecords} registros)'},scrollable:true});});</script></div></span>]]></update><update id="j_id1:javax.faces.ViewState:0"><![CDATA[${VIEW_STATE_AFTER_SEARCH}]]></update></changes></partial-response>`;

// Respuesta de búsqueda con 0 resultados (TFA fuera de Perú)
export const SEARCH_RESPONSE_EMPTY_XML = `<?xml version='1.0' encoding='UTF-8'?>
<partial-response id="j_id1"><changes><update id="listarDetalleInfraccionRAAForm:pgLista"><![CDATA[<span id="listarDetalleInfraccionRAAForm:pgLista"><div id="listarDetalleInfraccionRAAForm:dt"><tbody id="listarDetalleInfraccionRAAForm:dt_data"></tbody><script id="listarDetalleInfraccionRAAForm:dt_s" type="text/javascript">$(function(){PrimeFaces.cw("DataTable","widget",{id:"listarDetalleInfraccionRAAForm:dt",paginator:{rows:10,rowCount:0,page:0}});});</script></div></span>]]></update><update id="j_id1:javax.faces.ViewState:0"><![CDATA[${VIEW_STATE_AFTER_SEARCH}]]></update></changes></partial-response>`;

// ─── Respuesta XML de navigateToPage (paginación) ─────────────────────────────
// Extraído del HAR real: next-page-publico.oefa.gob.pe_Archive [26-07-01 10-42-25].har
// Página 2 (dt_first=10), data-ri empieza en 10

// Respuesta de paginación: update id="listarDetalleInfraccionRAAForm:dt"
// CDATA contiene directamente las filas (sin wrapper <table>) — exactamente como
// el servidor las envía en el HAR real. El parsePaginationResponse wrappea con
// tabla al parsearlo, cheerio necesita el contexto.
// Fixture: incluye <table><tbody> para compatibilidad con cheerio.
export const PAGE2_RESPONSE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<partial-response id="j_id1"><changes><update id="listarDetalleInfraccionRAAForm:dt"><![CDATA[<table><tbody><tr data-ri="10" class="ui-widget-content ui-datatable-even" role="row"><td role="gridcell" style="text-align:center;vertical-align:top;"> 11</td><td role="gridcell" style="text-align: justify;vertical-align:top;">657-2011-PRODUCE/DIGSECOVI-Dsvs</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Instituto Tecnológico de la Producción</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Planta de procesamiento de recursos hidrobiológicos</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Pesquería</td><td role="gridcell" style="text-align:left;">236-2013-OEFA/TFA</td><td role="gridcell" style="text-align: center;vertical-align:top;"><a href="#" title="" onclick="mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm'),{'listarDetalleInfraccionRAAForm:dt:10:j_idt63':'listarDetalleInfraccionRAAForm:dt:10:j_idt63','param_uuid':'746821e4-f99f-4e5c-90e2-7e2e2e3731d8'},'');return false"><img src="../images/pdf_descarga.png" alt="" style="border:0;width:25px" /></a></td></tr><tr data-ri="11" class="ui-widget-content ui-datatable-odd" role="row"><td role="gridcell" style="text-align:center;vertical-align:top;"> 12</td><td role="gridcell" style="text-align: justify;vertical-align:top;">655-2011-PRODUCE/DIGSECOVI</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Natural Protein Technologies S.A.C.</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Planta de Harina</td><td role="gridcell" style="text-align: justify;vertical-align:top;">Pesquería</td><td role="gridcell" style="text-align:left;">231-2012-OEFA/TFA</td><td role="gridcell" style="text-align: center;vertical-align:top;"><a href="#" title="" onclick="mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm'),{'listarDetalleInfraccionRAAForm:dt:11:j_idt63':'listarDetalleInfraccionRAAForm:dt:11:j_idt63','param_uuid':'62d415af-6462-4b14-9cab-a95717cc91f9'},'');return false"></a></td></tr></tbody></table>]]></update><update id="j_id1:javax.faces.ViewState:0"><![CDATA[${VIEW_STATE_AFTER_PAGE2}]]></update></changes></partial-response>`;

// Respuesta de paginación vacía (ViewState expirado silencioso)
export const PAGE_EMPTY_RESPONSE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<partial-response id="j_id1"><changes><update id="listarDetalleInfraccionRAAForm:dt"><![CDATA[]]></update><update id="j_id1:javax.faces.ViewState:0"><![CDATA[${VIEW_STATE_AFTER_SEARCH}]]></update></changes></partial-response>`;

// ─── Registro de documento con PDF ───────────────────────────────────────────

export const RECORD_WITH_PDF = {
  nro: "1",
  numeroExpediente: "891-08-PRODUCE/DIGSECOVI-Dsvs",
  administrado: "Corporación del Mar  S.A.",
  unidadFiscalizable: "Planta Playa Lado Norte Puerto Malabrigo",
  sector: "Pesquería",
  nroResolucion: "264-2012-OEFA/TFA",
  pdfRowIndex: 0,
  pdfParamUuid: "153a6d2a-cbed-40ef-b8ef-cd2272b19867",
  archivoNombre: "264-2012-OEFA_TFA",
};

export const RECORD_NO_PDF = {
  nro: "99",
  numeroExpediente: "999-2020-PRODUCE/TEST",
  administrado: "Empresa Test S.A.",
  unidadFiscalizable: "Planta Test",
  sector: "Minería",
  nroResolucion: "099-2020-OEFA/DFSAI",
  pdfRowIndex: null,
  pdfParamUuid: null,
  archivoNombre: null,
};

// ─── Sesión JSF base ──────────────────────────────────────────────────────────

export const SESSION_BASE = {
  viewState: VIEW_STATE_INITIAL,
  jsessionId: JSESSION_ID,
  siteUrl: "https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml",
};

export const SESSION_UPDATED = {
  viewState: VIEW_STATE_AFTER_SEARCH,
  jsessionId: JSESSION_ID,
  siteUrl: "https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml",
};
