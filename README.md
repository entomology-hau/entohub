# Harper Adams Entomology Hub

Student landing page for entomology news, research highlights, teaching resources and opportunities.

**Public address:** https://entomology-hau.github.io/entohub/

The site lives at the root of this repository's GitHub Pages deployment. The opportunities board remains at its existing address, and research-centre features continue to use the existing external service.

## Structure

- `site/`: static website, assets and public JSON.
- `site/data/curated.json`: staff-selected news and research highlights.
- `site/data/sources.json`: RSS/Atom and Crossref sources, with reader-facing homepage links.
- `site/data/feed.json`: generated combined feed.
- `scripts/refresh_hub.py`: collects metadata, validates dates and links, assigns topic tags and deduplicates.
- `scripts/persist_feed.py`: commits only the generated feed, preserving newer edits on `main`.
- `tests/test_hub_feed.py`: offline collection and persistence checks.
- `tests/test_hub_navigation.cjs`: offline navigation, deep-link and keyboard checks (Node.js 20+).
- `tests/test_biodiversity.cjs`: shared fetching, safe record previews and failure/retry checks.

The public frontend does not itself enforce access to protected research-centre information; that remains the responsibility of the external service.

## Preview and check

Python 3.12 is used in GitHub Actions. No third-party Python packages are required.

```sh
python -m http.server 8000 --directory site
```

Open http://localhost:8000/.

```sh
python -m unittest discover -s tests -v
node --test tests/test_*.cjs
python scripts/refresh_hub.py
```

The tests work offline. Refreshing requires access to the configured public feeds and Crossref API.

## Publishing and daily refresh

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The workflow runs on pushes to `main`, manually through the Actions tab, and daily at **05:17 UTC** (06:17 during British Summer Time).

Each run tests the collector, refreshes `site/data/feed.json`, commits that file only, and publishes `site/`. If `main` changes during collection or persistence, the run skips publication so the newer workflow can publish. A second branch check precedes deployment. The persistence script uses bounded requests and never force-pushes, resets or rebases editorial changes. GitHub's workflow token needs permission to write repository contents; deployment uses Pages and OIDC permissions.

## Maintaining highlights

Edit `site/data/curated.json` to add, amend or remove an authored highlight. Keep its stable `id`, exact `published` date (`YYYY-MM-DD`), original article `url`, `kind` (`news` or `research`), and topic `areas`. Write a short original `summary` and `why` after reading the source. `region` is `uk` or `global`, describing the subject's coverage rather than the publisher's location. A DOI helps deduplicate research links. Curated entries remain until removed and take priority over automatically discovered duplicates.

Automatic records are labelled as automatically collected, with empty summary/significance fields. The collector excludes sponsored feed posts identified in publisher metadata, invalid or future publication dates, and unrelated items from mixed-topic sources. It retains at most 120 automatic records from the previous 120 days, plus valid curated highlights. Automatic places are shared between sources one newest unique item at a time, with unused capacity passed on when quieter sources run out; the combined selection is then displayed chronologically. Mixed-topic sources can set `matchTitleOnly: true` to require an entomological subject in the headline rather than incidental references elsewhere in the feed text. Topic filters use title keywords and journal scope, so they are approximate.

Failed sources retain eligible cached records that passed the current content checks. Each source exposes its last successful fetch, latest attempt and status. An overall refresh timestamp does not imply every source succeeded. Publisher metadata without an exact day is omitted rather than assigned an invented date.

## Overview and Instagram

The bare site URL opens the Overview, which introduces the hub and links to every section. Explicit `?section=` links and older feed-filter-only links remain supported. Research toolkit stays last in the tab order.

The Overview includes Instagram’s native profile preview for `hau_entomology`. It loads `https://www.instagram.com/embed.js` only after the visitor selects **Show Instagram preview**; no account token is stored in the repository. A permanent profile link remains available if Instagram cannot load. The embedded content is controlled by Instagram and depends on the profile remaining public and embeddable. It is a profile preview, not a separate configurable media feed. The native embed was verified with recent posts on 21 October 2026.

## HAU Biodiversity records

Overview and Practical toolkit show three and six recent observations respectively from [Harper Adams University Biodiversity Data](https://www.inaturalist.org/projects/harper-adams-university-biodiversity-data), iNaturalist project `168313`. `site/biodiversity.js` makes one shared, unauthenticated request to the public v1 observations API when either preview approaches the viewport. Records are ordered by observation date, descending; later identification changes remain on the original record. Refreshing the page retrieves current API results (subject to iNaturalist caching).

Photographs come from each observation, with the supplied attribution and a link to the photo and licence. Only recognised Creative Commons or CC0 licences are displayed; hidden/flagged images and unlicensed photos get a text link instead. Medium-size derivatives use iNaturalist’s supported `square` → `medium` URL convention and are displayed without cropping. No precise locations are shown or stored. A failed request shows a retry button, and the project link is always available, including without JavaScript.
