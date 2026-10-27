'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../site/biodiversity.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../site/index.html'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(respond) {
  let requests = 0;
  const sections = [3, 6].map(limit => {
    const handlers = new Map();
    const status = {textContent: ''};
    const grid = {innerHTML: '', attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, querySelectorAll() { return []; }};
    const retry = {hidden: true, addEventListener(type, fn) { handlers.set(type, fn); }, click() { return handlers.get('click')(); }};
    return {dataset: {limit}, status, grid, retry, querySelector(selector) { return {'[data-biodiversity-status]': status, '[data-biodiversity-records]': grid, '[data-biodiversity-retry]': retry}[selector]; }};
  });
  const context = vm.createContext({
    URL, Intl, Date, AbortController, setTimeout, clearTimeout,
    window: {}, document: {querySelectorAll: () => sections},
    fetch: async (url, options) => { requests++; return respond(url, options, requests); },
  });
  vm.runInContext(source, context, {filename: 'site/biodiversity.js'});
  return {sections, requests: () => requests};
}
const record = id => ({id, observed_on: '2026-10-25', taxon: {name: 'Example species', preferred_common_name: 'Example insect'}, user: {login: 'recorder'}, quality_grade: 'needs_id', photos: []});
const licensed = overrides => ({id: 101, url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/101/square.jpg', license_code: 'cc-by', attribution: '(c) Photographer, CC BY', hidden: false, flags: [], ...overrides});
const response = results => ({ok: true, json: async () => ({results})});
const countCards = section => (section.grid.innerHTML.match(/class="biodiversity-record"/g) || []).length;

test('both panels share one public request and render three/six records', async () => {
  const b = harness((url, options) => {
    const query = new URL(url).searchParams;
    assert.equal(query.get('project_id'), '168313');
    assert.equal(query.get('order_by'), 'observed_on');
    assert.equal(query.get('order'), 'desc');
    assert.equal(options.credentials, 'omit');
    return response(Array.from({length: 6}, (_, i) => record(i + 1)));
  });
  await settle();
  assert.equal(b.requests(), 1);
  assert.deepEqual(b.sections.map(countCards), [3, 6]);
  assert.ok(b.sections.every(s => s.grid.attrs['aria-busy'] === 'false' && s.retry.hidden));
  assert.match(html, /data-biodiversity data-limit="3"/);
  assert.match(html, /data-biodiversity data-limit="6"/);
  assert.equal((html.match(/href="https:\/\/www\.inaturalist\.org\/projects\/harper-adams-university-biodiversity-data"/g) || []).length, 2);
});

test('external names and attribution are escaped; photos require reuse permission', async () => {
  const records = Array.from({length: 6}, (_, i) => record(i + 1));
  records[0].taxon.preferred_common_name = '<img src=x onerror=alert(1)>';
  records[0].user.login = '<script>unsafe</script>';
  records[0].photos = [licensed({attribution: '<b>Photographer</b>'})];
  records[1].photos = [licensed({license_code: null})];
  records[2].photos = [licensed({hidden: true})];
  records[3].photos = [licensed({flags: [{flag: 'copyright infringement'}]})];
  records[4].photos = [licensed({url: 'https://unexpected.example/photos/101/square.jpg'})];
  records[5].photos = [licensed({license_code: 'unknown'})];
  const b = harness(() => response(records));
  await settle();
  const output = b.sections[1].grid.innerHTML;
  assert.ok(!output.includes('<script>') && !output.includes('<b>Photographer</b>') && !output.includes('<img src=x'));
  assert.ok(output.includes('&lt;script&gt;unsafe&lt;/script&gt;') && output.includes('&lt;b&gt;Photographer&lt;/b&gt;'));
  assert.equal((output.match(/<img /g) || []).length, 1);
  assert.equal((output.match(/Photograph preview unavailable/g) || []).length, 5);
  assert.match(output, /https:\/\/www\.inaturalist\.org\/photos\/101/);
  assert.match(output, /Photo &amp; licence \(CC BY\)/);
});

test('failed request retains a usable message and a retry can load records', async () => {
  const b = harness((_url, _options, number) => number === 1 ? Promise.reject(new Error('Network unavailable')) : response([record(1)]));
  await settle();
  assert.equal(b.requests(), 1);
  assert.ok(b.sections.every(s => !s.retry.hidden && /could not load/.test(s.status.textContent) && s.grid.attrs['aria-busy'] === 'false'));
  await b.sections[0].retry.click();
  await b.sections[1].retry.click();
  assert.equal(b.requests(), 2);
  assert.deepEqual(b.sections.map(countCards), [1, 1]);
  assert.ok(b.sections.every(s => s.retry.hidden));
});

test('invalid IDs are skipped and empty results are reported without a loading spinner', async () => {
  const b = harness(() => response([null, {id: '1'}, {id: -1}, {id: Infinity}]));
  await settle();
  assert.deepEqual(b.sections.map(countCards), [0, 0]);
  assert.ok(b.sections.every(s => /No public records/.test(s.status.textContent) && s.grid.attrs['aria-busy'] === 'false'));
});
