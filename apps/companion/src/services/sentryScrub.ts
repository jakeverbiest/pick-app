/**
 * Pure helpers that strip query strings and fragments from every URL-bearing
 * field in Sentry breadcrumbs, transactions/spans and error events, so request
 * URLs like Nominatim reverse-geocode lat/lon or CARTO keys never leave the
 * device. Hostname and path are kept for diagnostics. Nothing here throws: on
 * any error the url-ish fields are removed and the event is still returned.
 */

const URL_IN_TEXT = /(https?:\/\/[^\s?#]*)[?#][^\s]*/gi;

/** For fields that are entirely a URL: cut at the first ? or #. */
export function stripUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const i = value.search(/[?#]/);
  return i === -1 ? value : value.slice(0, i);
}

/** For free text that may embed URLs (span descriptions, transaction names). */
export function stripUrlsInText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(URL_IN_TEXT, '$1');
}

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null;
}

function scrubData(data: unknown): void {
  if (!isObj(data)) return;
  for (const k of ['url', 'http.url', 'http.query', 'http.fragment', 'from', 'to']) {
    if (!(k in data)) continue;
    if (k === 'http.query' || k === 'http.fragment') delete data[k];
    else data[k] = stripUrl(data[k]);
  }
}

function removeUrlish(data: unknown): void {
  if (!isObj(data)) return;
  for (const k of ['url', 'http.url', 'http.query', 'http.fragment']) delete data[k];
}

export function scrubBreadcrumb<T>(crumb: T): T {
  try {
    if (isObj(crumb)) scrubData(crumb.data);
  } catch {
    try { if (isObj(crumb)) removeUrlish(crumb.data); } catch {}
  }
  return crumb;
}

function scrubSpan(span: any): void {
  try {
    scrubData(span.data);
    if (isObj(span.data)) {
      for (const k of Object.keys(span.data)) {
        if (k !== 'url' && k !== 'http.url' && typeof span.data[k] === 'string' && /^https?:\/\//i.test(span.data[k])) {
          span.data[k] = stripUrl(span.data[k]);
        }
      }
    }
    if ('description' in span) span.description = stripUrlsInText(span.description);
  } catch {
    try { removeUrlish(span.data); delete span.description; } catch {}
  }
}

export function scrubTransaction<T>(event: T): T {
  try {
    const e: any = event;
    if (!isObj(e)) return event;
    if (typeof e.transaction === 'string') e.transaction = stripUrlsInText(e.transaction);
    if (Array.isArray(e.spans)) for (const s of e.spans) if (isObj(s)) scrubSpan(s);
    scrubData(e.contexts?.trace?.data);
    if (isObj(e.contexts?.trace) && 'description' in e.contexts.trace) {
      e.contexts.trace.description = stripUrlsInText(e.contexts.trace.description);
    }
    scrubEventFields(e);
  } catch {
    try {
      const e: any = event;
      if (isObj(e)) {
        delete e.spans;
        if (isObj(e.request)) { delete e.request.url; delete e.request.query_string; }
        if (typeof e.transaction === 'string' && /https?:\/\//i.test(e.transaction)) delete e.transaction;
      }
    } catch {}
  }
  return event;
}

function scrubEventFields(e: any): void {
  if (isObj(e.request)) {
    if ('url' in e.request) e.request.url = stripUrl(e.request.url);
    delete e.request.query_string;
  }
  const crumbs = Array.isArray(e.breadcrumbs) ? e.breadcrumbs : e.breadcrumbs?.values;
  if (Array.isArray(crumbs)) for (const c of crumbs) scrubBreadcrumb(c);
}

export function scrubEvent<T>(event: T): T {
  try {
    const e: any = event;
    if (!isObj(e)) return event;
    scrubEventFields(e);
    if (typeof e.transaction === 'string') e.transaction = stripUrlsInText(e.transaction);
    if (Array.isArray(e.spans)) for (const s of e.spans) if (isObj(s)) scrubSpan(s);
  } catch {
    try {
      const e: any = event;
      if (isObj(e)) {
        if (isObj(e.request)) { delete e.request.url; delete e.request.query_string; }
        delete e.breadcrumbs;
      }
    } catch {}
  }
  return event;
}
