import assert from 'node:assert/strict';
import { stripUrl, stripUrlsInText, scrubBreadcrumb, scrubTransaction, scrubEvent } from '../sentryScrub';

const NOM = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=40.7128&lon=-74.0060&zoom=14';
const CARTO = 'https://gcp-us-east1.api.carto.com/v3/maps/x/query?api_key=SECRET123&q=1#frag';

// URLs
assert.equal(stripUrl(NOM), 'https://nominatim.openstreetmap.org/reverse');
assert.equal(stripUrl(CARTO), 'https://gcp-us-east1.api.carto.com/v3/maps/x/query');
assert.equal(stripUrl('https://example.com/a/b'), 'https://example.com/a/b');
assert.equal(stripUrl('not a url'), 'not a url');
assert.equal(stripUrl(undefined), undefined);
assert.equal(stripUrl(42), 42);
assert.doesNotThrow(() => stripUrl('http://[bad?x=1'));
assert.equal(stripUrl('http://[bad?x=1'), 'http://[bad');

// Text
assert.equal(stripUrlsInText(`GET ${NOM}`), 'GET https://nominatim.openstreetmap.org/reverse');
assert.equal(stripUrlsInText('Map screen render'), 'Map screen render');
assert.equal(stripUrlsInText('what? really#1'), 'what? really#1');

// Breadcrumb
const crumb: any = { category: 'fetch', data: { url: NOM, method: 'GET', status_code: 200 } };
scrubBreadcrumb(crumb);
assert.equal(crumb.data.url, 'https://nominatim.openstreetmap.org/reverse');
assert.equal(crumb.data.method, 'GET');
assert.deepEqual(scrubBreadcrumb({ message: 'x' }), { message: 'x' });
assert.equal(scrubBreadcrumb(null), null);

// Transaction / spans
const tx: any = {
  transaction: `GET ${CARTO}`,
  spans: [
    { description: `GET ${CARTO}`, data: { 'http.url': CARTO, url: CARTO, 'http.query': 'api_key=SECRET123', 'http.request.method': 'GET' } },
    { description: 'plain span', data: {} },
    { description: 'no data' },
  ],
  contexts: { trace: { data: { url: NOM } } },
};
scrubTransaction(tx);
const s = JSON.stringify(tx);
assert.ok(!s.includes('SECRET123') && !s.includes('lat=') && !s.includes('frag'), s);
assert.equal(tx.spans[0].description, 'GET https://gcp-us-east1.api.carto.com/v3/maps/x/query');
assert.equal(tx.spans[0].data['http.request.method'], 'GET');
assert.equal(tx.spans[1].description, 'plain span');
assert.equal(tx.contexts.trace.data.url, 'https://nominatim.openstreetmap.org/reverse');

// Error event
const ev: any = {
  request: { url: `${NOM}`, query_string: 'lat=1&lon=2' },
  breadcrumbs: [{ data: { url: CARTO } }, { message: 'hi' }],
};
scrubEvent(ev);
assert.equal(ev.request.url, 'https://nominatim.openstreetmap.org/reverse');
assert.equal(ev.request.query_string, undefined);
assert.ok(!JSON.stringify(ev).includes('SECRET123'));
const ev2: any = { breadcrumbs: { values: [{ data: { url: NOM } }] } };
scrubEvent(ev2);
assert.equal(ev2.breadcrumbs.values[0].data.url, 'https://nominatim.openstreetmap.org/reverse');

// Never throws, even on hostile shapes
const hostile: any = { request: {}, breadcrumbs: [{ get data() { throw new Error('x'); } }], spans: [{ get data() { throw new Error('y'); } }] };
assert.doesNotThrow(() => scrubEvent(hostile));
assert.doesNotThrow(() => scrubTransaction(hostile));
assert.doesNotThrow(() => scrubBreadcrumb(hostile.breadcrumbs[0]));
for (const v of [null, undefined, 1, 'str', []]) {
  assert.doesNotThrow(() => { scrubEvent(v); scrubTransaction(v); scrubBreadcrumb(v); });
}
console.log('sentryScrub: ok');
