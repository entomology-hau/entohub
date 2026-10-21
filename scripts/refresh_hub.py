#!/usr/bin/env python3
"""Build the public entomology hub from curated links and dated source metadata.

Automatic entries are explicitly uncurated. No abstract, finding, or significance
statement is generated from a headline. All network work is bounded and failed
sources keep their previously fetched entries, subject to the age limit.
"""
from __future__ import annotations

import argparse
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
from html import unescape
import ipaddress
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'site' / 'data'
USER_AGENT = 'HAUEntomologyHub/1.0 (public journal metadata and RSS reader)'
MAX_BYTES = 3_000_000
MAX_AGE_DAYS = 120
MAX_AUTOMATIC_ITEMS = 120
TIMEOUT_SECONDS = 8
ATTEMPTS = 2
WORKERS = 4
CONTENT_CHECKS_VERSION = 2
AREAS = (
    'Insect biology & behaviour', 'Crop protection & IPM', 'Biological control',
    'Ecology & conservation', 'Pollination & beneficial insects',
    'Taxonomy & biodiversity recording', 'Vectors & veterinary entomology',
    'Monitoring & environmental risk',
)
AREA_PATTERNS = {
    AREAS[0]: r'\b(?:behavio[ur]|physiolog|molecular|genom|genetic|metaboli|developmen|reproduct|olfact|sensory|pheromon|temperatur|thermal|nutrition)',
    AREAS[1]: r'\b(?:pest|crop|aphid|whitefl|thrips|insecticid|resistance|integrated pest|ipm\b|agricultur|forestr|fruit fly|leafhopper|planthopper|herbivor)',
    AREAS[2]: r'\b(?:biological control|biocontrol|parasitoid|natural enem|entomopathogen|beauveria|metarhizium|predat|ladybird|lacewing)',
    AREAS[3]: r'\b(?:ecolog|conserv|habitat|decline|climate|landscape|restorat|extinct|endanger|fragment|community|assemblage|urban|grassland|forest)',
    AREAS[4]: r'\b(?:pollinat|bees?\b|bumblebee|honeybee|hoverfl|beneficial (?:insects?|arthropods?)|ecosystem service)',
    AREAS[5]: r'\b(?:taxonom|systematic(?!\s+review)|new species|biodivers|biological recording|citizen science|barcod|phylogen|species richness|species diversity|museum|(?:insect|specimen|natural history) collections?)',
    AREAS[6]: r'\b(?:mosquito|vector|veterinary|malaria|dengue|ticks?\b|zoono|livestock|tsetse|leishmania|sandfl|arbovir)',
    AREAS[7]: r'\b(?:monitor|surveill|environmental risk|pesticid|ecotoxic|non[- ]target|light pollution|trapping|bioindicator|remote sensing)',
}
SPONSORED_CONTENT = re.compile(
    r'\b(?:sponsored\s+(?:content|posts?|articles?|stories|features?)|'
    r'paid\s+(?:content|posts?|articles?)|advertorials?)\b', re.I)
ENTOMOLOGY = re.compile(
    r'\b(?:insect\w*|entomolog\w*|arthropod\w*|aphid\w*|parasitoid\w*|'
    r'entomopathogen\w*|beauveria|metarhizium|pollinat\w*|bee|bees|bumblebee\w*|'
    r'honeybee\w*|beetle\w*|butterfl\w*|moth\w*|ant|ants|wasp\w*|'
    r'fruit[- ]?fl(?:y|ies)|housefl(?:y|ies)|tsetse|sand[- ]?fl(?:y|ies)|'
    r'blowfl(?:y|ies)|blackfl(?:y|ies)|soldier[- ]?fl(?:y|ies)|'
    r'hoverfl\w*|mosquito\w*|whitefl\w*|thrips|leafhopper\w*|planthopper\w*|'
    r'caterpillar\w*|locust\w*|grasshopper\w*|ladybird\w*|ladybug\w*|lacewing\w*|'
    r'weevil\w*|mealybug\w*|termite\w*|dragonfl\w*|damselfl\w*|lepidoptera|'
    r'coleoptera|hymenoptera|diptera|hemiptera|spider\w*|mite|mites|tick|ticks)\b', re.I)
UK_TITLE = re.compile(r'\b(?:UK|U\.K\.|United Kingdom|Britain|British|England|English|Scotland|Scottish|Wales|Welsh|Northern Ireland)\b', re.I)


def clean_text(value):
    return re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', str(value or '')))).strip()


def canonical_url(value):
    """Allow public HTTP(S) links only and remove common tracking parameters."""
    if not isinstance(value, str) or re.search(r'[\x00-\x20]', value):
        return None
    try:
        p = urlsplit(value)
        host = p.hostname
        if p.scheme.lower() not in {'http', 'https'} or not host or p.username or p.password:
            return None
        if host.lower() == 'localhost' or '.' not in host or host.lower().endswith('.local'):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            pass
        port = p.port  # Validate malformed ports too.
        netloc = host.lower() + (f':{port}' if port and port not in {80, 443} else '')
        query = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
                 if not k.lower().startswith('utm_') and k.lower() not in {'fbclid', 'gclid', 'from_rss'}]
        return urlunsplit((p.scheme.lower(), netloc, p.path.rstrip('/') or '/', urlencode(sorted(query)), ''))
    except (ValueError, TypeError):
        return None


def normalise_doi(value):
    value = str(value or '').strip()
    value = re.sub(r'^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)', '', value, flags=re.I)
    return value.lower() if re.fullmatch(r'10\.\d{4,9}/\S+', value, re.I) else None


def parse_date(value):
    """Return an actual calendar date; never manufacture a missing month/day."""
    if not isinstance(value, str):
        return None
    try:
        if re.match(r'^\d{4}-\d{2}-\d{2}(?:$|T| )', value):
            return date.fromisoformat(value[:10])
        return parsedate_to_datetime(value).date()
    except (ValueError, TypeError, OverflowError):
        return None


def crossref_date(record, today):
    dates = []
    for key in ('published-online', 'published', 'published-print'):
        parts = record.get(key, {}).get('date-parts', [[]])[0]
        if len(parts) == 3:
            try:
                candidate = date(*parts)
                if candidate <= today:
                    dates.append(candidate)
            except (TypeError, ValueError):
                pass
    return min(dates) if dates else None


def topic_areas(title, source):
    found = [area for area, pattern in AREA_PATTERNS.items() if re.search(pattern, title, re.I)]
    return found or [area for area in source.get('defaultAreas', [AREAS[0]]) if area in AREAS]


def make_item(title, url, published, source, today, relevance_text='', doi=None):
    title, url = clean_text(title), canonical_url(url)
    published = parse_date(published) if isinstance(published, str) else published
    if not title or not url or not isinstance(published, date) or published > today:
        return None
    if published < today - timedelta(days=MAX_AGE_DAYS):
        return None
    matching_text = title if source.get('matchTitleOnly') else title + ' ' + relevance_text
    if source.get('scope') != 'entomology' and not ENTOMOLOGY.search(matching_text):
        return None
    doi = normalise_doi(doi) or normalise_doi(url)
    identity = doi or url
    item = {
        'id': 'auto-' + hashlib.sha256(identity.encode()).hexdigest()[:16],
        'kind': source['kind'], 'title': title, 'url': url,
        'source': source['name'], 'sourceId': source['id'],
        'published': published.isoformat(), 'areas': topic_areas(title, source),
        'region': 'uk' if UK_TITLE.search(title) else 'global',
        'curated': False, 'summary': '', 'why': '',
        'tagMethod': 'automatic-keywords',
        'contentChecksVersion': CONTENT_CHECKS_VERSION,
    }
    if doi:
        item['doi'] = doi
    return item


def local_name(tag):
    return tag.rsplit('}', 1)[-1]


def child_text(element, names):
    for child in element:
        if local_name(child.tag) in names:
            return ''.join(child.itertext()).strip()
    return ''


def parse_xml(data, source, today):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('XML entities and document types are not accepted')
    root = ET.fromstring(data)
    if local_name(root.tag) not in {'rss', 'feed', 'RDF'}:
        raise ValueError('Expected RSS or Atom XML')
    items = []
    for entry in root.iter():
        kind = local_name(entry.tag)
        if kind not in {'item', 'entry'}:
            continue
        title = child_text(entry, {'title'})
        link = ''
        for child in entry:
            if local_name(child.tag) == 'link' and child.get('rel', 'alternate') == 'alternate':
                link = child.get('href') or (child.text or '').strip()
                if link:
                    break
        # An Atom updated timestamp is a modification date, not publication evidence.
        raw_date = child_text(entry, {'published'} if kind == 'entry' else {'pubDate', 'date'})
        relevance = clean_text(' '.join(''.join(child.itertext()) for child in entry
            if local_name(child.tag) in {'description', 'summary', 'encoded', 'content'}))
        categories = [clean_text(child.get('term') or ''.join(child.itertext())) for child in entry
                      if local_name(child.tag) == 'category']
        if (any(category.lower() == 'sponsored' for category in categories)
                or SPONSORED_CONTENT.search(' '.join([clean_text(title), relevance] + categories))):
            continue
        item = make_item(title, urljoin(source['url'], link) if link else '', raw_date,
                         source, today, relevance_text=relevance)
        if item:
            items.append(item)
    return items


def parse_crossref(data, source, today):
    result = json.loads(data)
    records = result.get('message', {}).get('items')
    if not isinstance(records, list):
        raise ValueError('Expected a Crossref works response')
    items = []
    for record in records:
        if record.get('type') != 'journal-article':
            continue
        titles = record.get('title') or []
        doi = normalise_doi(record.get('DOI'))
        item = make_item(titles[0] if titles else '', 'https://doi.org/' + doi if doi else record.get('URL', ''),
                         crossref_date(record, today), source, today, doi=doi)
        if item:
            items.append(item)
    return items


def request_url(source, today):
    if source['format'] == 'crossref':
        params = {
            'rows': 35, 'sort': 'published', 'order': 'desc',
            'filter': f'type:journal-article,from-pub-date:{today - timedelta(days=MAX_AGE_DAYS)},until-pub-date:{today}',
            'select': 'DOI,title,published,published-online,published-print,URL,type',
        }
        return source['url'] + '?' + urlencode(params)
    return source['url']


def fetch_bytes(url):
    """Two short attempts, with no retry for permanent HTTP failures."""
    if not canonical_url(url):
        raise ValueError('Invalid source URL')
    last_error = None
    for attempt in range(ATTEMPTS):
        try:
            req = Request(url, headers={'User-Agent': USER_AGENT,
                'Accept': 'application/json,application/rss+xml,application/atom+xml,application/xml;q=0.9'})
            with urlopen(req, timeout=TIMEOUT_SECONDS) as response:
                data = response.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    raise ValueError('Response exceeds 3 MB')
                return data
        except HTTPError as error:
            last_error = error
            if error.code not in {408, 429, 500, 502, 503, 504}:
                raise
        except (OSError, TimeoutError) as error:
            last_error = error
        if attempt + 1 < ATTEMPTS:
            time.sleep(0.4)
    raise last_error


def collect_source(source, today, fetcher=fetch_bytes):
    try:
        payload = fetcher(request_url(source, today))
        parser = parse_crossref if source['format'] == 'crossref' else parse_xml
        return parser(payload, source, today), None
    except Exception as error:
        # Keep details short and remove line breaks; never expose response bodies.
        return [], f'{type(error).__name__}: {clean_text(str(error))[:180]}'


def identity_keys(item):
    keys = set()
    url = canonical_url(item.get('url'))
    doi = normalise_doi(item.get('doi')) or normalise_doi(url)
    if url:
        parts = urlsplit(url)
        keys.add('url:' + parts.netloc + parts.path + ('?' + parts.query if parts.query else ''))
    if doi:
        keys.add('doi:' + doi)
    return keys


def valid_item(item, today, curated=False):
    published = parse_date(item.get('published'))
    return (item.get('kind') in {'news', 'research'} and clean_text(item.get('title'))
            and canonical_url(item.get('url')) and published and published <= today
            and (curated or published >= today - timedelta(days=MAX_AGE_DAYS)))


def build_feed(sources, curated, previous=None, now=None, fetcher=fetch_bytes):
    now = now or datetime.now(timezone.utc)
    today, timestamp = now.date(), now.isoformat(timespec='seconds').replace('+00:00', 'Z')
    previous = previous or {}
    previous_status = {s['id']: s for s in previous.get('sources', [])}
    statuses, automatic = [], []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda s: collect_source(s, today, fetcher), sources))
    any_success = False
    for source, (items, error) in zip(sources, results):
        previous_source = previous_status.get(source['id'], {})
        if error:
            items = [i for i in previous.get('items', []) if i.get('sourceId') == source['id']
                     and not i.get('curated') and valid_item(i, today)
                     and i.get('contentChecksVersion') == CONTENT_CHECKS_VERSION]
            # Reapply current topic patterns to eligible cached metadata.
            items = [dict(i, areas=topic_areas(i['title'], source)) for i in items]
        else:
            any_success = True
        status = {
            'id': source['id'], 'name': source['name'], 'url': source['url'],
            'homepage': source.get('homepage', source['url']),
            'status': 'cached' if error and items else 'error' if error else 'ok',
            'lastAttempt': timestamp,
            'lastSuccess': previous_source.get('lastSuccess') if error else timestamp,
            'count': len(items),
        }
        if error:
            status['error'] = error
        statuses.append(status)
        automatic.extend(items)
    # Curated editorial records win over metadata discoveries of the same work.
    ordered_curated = sorted((dict(i, curated=True) for i in curated if valid_item(i, today, True)),
                             key=lambda i: i['published'], reverse=True)
    items, seen, auto_count = [], set(), 0
    for item in ordered_curated:
        keys = identity_keys(item)
        if not keys or seen.intersection(keys):
            continue
        seen.update(keys)
        items.append(item)

    # Give each source one newest unique item per round. Quiet sources release
    # their spare capacity naturally, while duplicates do not consume a turn.
    # Stable source/item ordering makes retention independent of config order.
    buckets = {}
    for item in automatic:
        buckets.setdefault(item['sourceId'], []).append(item)
    queues = {source_id: deque(sorted(buckets[source_id],
              key=lambda i: (i['published'], i['id'], i['url']), reverse=True))
              for source_id in sorted(buckets)}
    while queues and auto_count < MAX_AUTOMATIC_ITEMS:
        for source_id in list(queues):
            queue = queues[source_id]
            while queue:
                item = queue.popleft()
                keys = identity_keys(item)
                if not keys or seen.intersection(keys):
                    continue
                seen.update(keys)
                items.append(item)
                auto_count += 1
                break
            if not queue:
                del queues[source_id]
            if auto_count >= MAX_AUTOMATIC_ITEMS:
                break
    items.sort(key=lambda i: i['published'], reverse=True)
    return {
        'updatedAt': timestamp,
        'lastSuccessfulUpdate': timestamp if any_success else previous.get('lastSuccessfulUpdate'),
        'items': items, 'sources': statuses,
    }


def read_json(path, default):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=DATA)
    args = parser.parse_args()
    sources = read_json(args.data_dir / 'sources.json', [])
    curated = read_json(args.data_dir / 'curated.json', [])
    if not isinstance(curated, list) or not isinstance(sources, list):
        raise ValueError('curated.json and sources.json must each contain an array')
    previous = read_json(args.data_dir / 'feed.json', {})
    feed = build_feed(sources, curated, previous)
    args.data_dir.mkdir(parents=True, exist_ok=True)
    output = args.data_dir / 'feed.json'
    temporary = output.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(output)
    for source in feed['sources']:
        print(f"{source['id']}: {source['status']} ({source['count']} eligible entries)")
    print(f"Hub feed: {len(feed['items'])} entries; updated {feed['updatedAt']}")


if __name__ == '__main__':
    main()
