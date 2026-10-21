'use strict';
// Small, offline browser harness: execute the real app and its event handlers.
// This checks routing/ARIA state, not layout; visual checks remain separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'site/hub.js'), 'utf8').replace(/\bload\(\);\s*$/, '');

async function browser(relative = '') {
  const nodes = [], stack = [], byId = new Map(), windowEvents = new Map(), documentEvents = new Map();
  const storage = new Map();
  let current = new URL(relative, 'https://entomology-hau.github.io/entohub/');
  const historyEntries = [current.href];
  let historyIndex = 0;
  let document;
  const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  function matches(node, selector) {
    if (selector === '[data-section]') return 'data-section' in node.attrs;
    if (selector === '[data-panel]') return 'data-panel' in node.attrs;
    if (selector === '[data-kind]') return 'data-kind' in node.attrs;
    if (selector === '[data-save]') return 'data-save' in node.attrs;
    if (selector === 'a[href^="#"]') return node.tagName === 'A' && (node.attrs.href || '').startsWith('#');
    if (selector === 'meta[name="theme-color"]') return node.tagName === 'META' && node.attrs.name === 'theme-color';
    const attr = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    return attr ? node.attrs[attr[1]] === attr[2] : false;
  }
  function node(tagName, attrs, parentElement = null) {
    const handlers = new Map(), classes = new Set((attrs.class || '').split(/\s+/));
    const n = {
      tagName: tagName.toUpperCase(), attrs: {...attrs}, parentElement, children: [], dataset: {},
      hidden: 'hidden' in attrs, tabIndex: attrs.tabindex !== undefined ? Number(attrs.tabindex) : (['BUTTON','INPUT','SELECT','TEXTAREA'].includes(tagName.toUpperCase()) || (tagName.toUpperCase()==='A' && attrs.href) ? 0 : -1), innerHTML: '', textContent: '',
      _value: attrs.value, extraOptions: [], content: attrs.content,
      get value() { return this._value ?? this.options.find(o => 'selected' in (o.attrs || {}))?.value ?? this.options[0]?.value ?? ''; },
      set value(value) { this._value = String(value); },
      get options() { return this.children.filter(c => c.tagName === 'OPTION').concat(this.extraOptions); },
      add(option) { this.extraOptions.push(option); },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      getAttribute(name) { return this.attrs[name] ?? null; },
      classList: {toggle(name, force) { const yes = force ?? !classes.has(name); yes ? classes.add(name) : classes.delete(name); return yes; }},
      addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(callback); },
      fire(type, extra = {}) { const event = {target: this, preventDefault() { this.defaultPrevented = true; }, ...extra}; for (const fn of handlers.get(type) || []) fn(event); return event; },
      closest(selector) { for (let candidate = this; candidate; candidate = candidate.parentElement) if (matches(candidate, selector)) return candidate; return null; },
      focus() { document.activeElement = this; },
      scrollIntoView() { this.scrolled = true; },
    };
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) n.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    return n;
  }
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<\/?([A-Za-z][\w:-]*)([^>]*)>/g)) {
    if (!token[1]) continue;
    const tag = token[1].toLowerCase();
    if (token[0].startsWith('</')) {
      const index = stack.map(n => n.tagName).lastIndexOf(tag.toUpperCase());
      if (index >= 0) stack.length = index;
      continue;
    }
    const attrs = {};
    for (const attr of token[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[attr[1]] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
    const n = node(tag, attrs, stack.at(-1) || null);
    nodes.push(n); n.parentElement?.children.push(n); if (attrs.id) byId.set(attrs.id, n);
    if (!['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'].includes(tag) && !token[0].endsWith('/>')) stack.push(n);
  }
  document = {
    activeElement: null, documentElement: nodes.find(n => n.tagName === 'HTML'),
    getElementById(id) { return byId.get(id) || null; },
    querySelectorAll(selector) { return nodes.filter(n => matches(n, selector)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, callback) { if (!documentEvents.has(type)) documentEvents.set(type, []); documentEvents.get(type).push(callback); },
  };
  function dispatch(type) { for (const callback of windowEvents.get(type) || []) callback({type}); }
  const location = {};
  for (const key of ['href','pathname','search','hash']) Object.defineProperty(location, key, {get: () => current[key]});
  const history = {
    pushState(_state, _title, url) { current = new URL(url, current); historyEntries.splice(++historyIndex); historyEntries.push(current.href); },
    replaceState(_state, _title, url) { current = new URL(url, current); historyEntries[historyIndex] = current.href; },
    back() { if (historyIndex > 0) { current = new URL(historyEntries[--historyIndex]); dispatch('popstate'); } },
    forward() { if (historyIndex + 1 < historyEntries.length) { current = new URL(historyEntries[++historyIndex]); dispatch('popstate'); } },
  };
  const context = vm.createContext({
    URL, URLSearchParams, Intl, Date, console, document, location, history, setTimeout,
    window: {addEventListener(type, callback) { if (!windowEvents.has(type)) windowEvents.set(type, []); windowEvents.get(type).push(callback); }},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    Option: function(text, value) { this.text = text; this.value = value; },
    fetch: async url => ({ok: true, json: async () => url.includes('feed.json') ? {items: [], sources: [], updatedAt: new Date().toISOString()} : []}),
  });
  vm.runInContext(script, context, {filename: 'site/hub.js'});
  await vm.runInContext('load()', context);
  return {
    document, history, location,
    section: () => vm.runInContext('activeSection', context),
    kind: () => vm.runInContext('kind', context),
    tab: section => byId.get(`tab-${section}`),
    clickTab(section) { assert.ok(this.tab(section), `Tab ${section} exists`); this.tab(section).fire('click'); },
    historyLength: () => historyEntries.length,
    clickAnchor(href, extra = {}) {
      const link = nodes.find(n => n.tagName === 'A' && n.attrs.href === href);
      assert.ok(link, `Anchor ${href} exists`);
      const event = {target: link, button: 0, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...extra};
      for (const callback of documentEvents.get('click') || []) callback(event);
      if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        history.pushState(null, '', href); dispatch('hashchange');
      }
      return event;
    },
    assertSection(section) {
      assert.equal(this.section(), section);
      const selected = document.querySelectorAll('[data-section]').filter(n => n.attrs['aria-selected'] === 'true');
      assert.deepEqual(selected.map(n => n.dataset.section), [section]);
      assert.deepEqual(document.querySelectorAll('[data-panel]').filter(n => !n.hidden).map(n => n.dataset.panel), [section]);
      assert.equal(selected[0].tabIndex, 0);
      assert.ok(document.querySelectorAll('[data-section]').filter(n => n !== selected[0]).every(n => n.tabIndex === -1));
    },
  };
}

test('bare URL opens Overview with one selected and visible panel', async () => {
  const b = await browser(); b.assertSection('overview');
});

test('explicit legacy Highlights links preserve their filters', async () => {
  const b = await browser('?section=highlights&view=research');
  b.assertSection('highlights'); assert.equal(b.kind(), 'research');
});

test('legacy filter-only links still open Highlights', async () => {
  for (const query of ['?view=research', '?q=aphid', '?area=Biological%20control', '?region=uk', '?selection=curated', '?sort=oldest', '?size=18', '?page=2']) {
    const b = await browser(query); b.assertSection('highlights');
  }
});

test('explicit Overview takes precedence over retained highlight filters', async () => {
  const b = await browser('?section=overview&view=research'); b.assertSection('overview');
});

test('legacy fragment links reveal their destination panel', async () => {
  const b = await browser('#courses-undergraduate'); b.assertSection('courses');
  assert.equal(b.document.getElementById('courses-undergraduate').scrolled, true);
  b.clickTab('overview'); b.assertSection('overview'); assert.equal(b.location.hash, '');
});

test('in-page course anchor reveals its hidden panel and survives reload', async () => {
  const b = await browser(); b.clickAnchor('#courses-undergraduate'); b.assertSection('courses');
  const restored = await browser(b.location.href); restored.assertSection('courses');
});

test('tab navigation survives reload and browser Back/Forward with retained filters', async () => {
  const b = await browser('?view=research');
  b.clickTab('overview'); b.assertSection('overview');
  const overviewReload = await browser(b.location.href); overviewReload.assertSection('overview');
  b.clickTab('highlights'); b.assertSection('highlights');
  const highlightReload = await browser(b.location.href); highlightReload.assertSection('highlights');
  b.history.back(); b.assertSection('overview');
  b.history.back(); b.assertSection('highlights'); assert.equal(b.kind(), 'research');
  b.history.forward(); b.assertSection('overview');
});

test('keyboard Home/End and arrows use tab order, keep Research last and update ARIA', async () => {
  const b = await browser();
  b.tab('overview').fire('keydown', {key: 'End'}); b.assertSection('research');
  assert.equal(b.document.activeElement, b.tab('research'));
  b.tab('research').fire('keydown', {key: 'ArrowRight'}); b.assertSection('overview');
  b.tab('overview').fire('keydown', {key: 'ArrowLeft'}); b.assertSection('research');
  b.tab('research').fire('keydown', {key: 'Home'}); b.assertSection('overview');
});

test('guide anchor navigation is synchronous and cannot undo a following tab click', async () => {
  const b = await browser();
  const event = b.clickAnchor('#highlights');
  assert.equal(event.defaultPrevented, true);
  b.assertSection('highlights');
  assert.equal(b.historyLength(), 2);
  assert.equal(b.document.activeElement, b.document.getElementById('highlights'));
  b.clickTab('overview');
  await Promise.resolve();
  b.assertSection('overview'); assert.equal(b.location.hash, '');
  assert.equal(b.historyLength(), 3);
  b.history.back(); b.assertSection('highlights'); assert.equal(b.location.hash, '#highlights');
});

test('modified anchor clicks leave native new-tab behaviour and current panel alone', async () => {
  const b = await browser();
  for (const extra of [{ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {altKey: true}, {button: 1}]) {
    const event = b.clickAnchor('#courses-undergraduate', extra);
    assert.equal(event.defaultPrevented, false);
    b.assertSection('overview'); assert.equal(b.historyLength(), 1);
  }
});

test('repeating the same in-panel anchor does not create duplicate history entries', async () => {
  const b = await browser();
  b.clickAnchor('#courses-undergraduate'); b.clickAnchor('#courses-undergraduate');
  b.assertSection('courses'); assert.equal(b.historyLength(), 2);
});
