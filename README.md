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

The public frontend does not itself enforce access to protected research-centre information; that remains the responsibility of the external service.

## Preview and check

Python 3.12 is used in GitHub Actions. No third-party Python packages are required.

```sh
python -m http.server 8000 --directory site
```

Open http://localhost:8000/.

```sh
python -m unittest discover -s tests -v
python scripts/refresh_hub.py
```

The tests work offline. Refreshing requires access to the configured public feeds and Crossref API.

## Publishing and daily refresh

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The workflow runs on pushes to `main`, manually through the Actions tab, and daily at **05:17 UTC** (06:17 during British Summer Time).

Each run tests the collector, refreshes `site/data/feed.json`, commits that file only, and publishes `site/`. If `main` changes during collection or persistence, the run skips publication so the newer workflow can publish. A second branch check precedes deployment. The persistence script uses bounded requests and never force-pushes, resets or rebases editorial changes. GitHub's workflow token needs permission to write repository contents; deployment uses Pages and OIDC permissions.

## Maintaining highlights

Edit `site/data/curated.json` to add, amend or remove an authored highlight. Keep its stable `id`, exact `published` date (`YYYY-MM-DD`), original article `url`, `kind` (`news` or `research`), and topic `areas`. Write a short original `summary` and `why` after reading the source. `region` is `uk` or `global`, describing the subject's coverage rather than the publisher's location. A DOI helps deduplicate research links. Curated entries remain until removed and take priority over automatically discovered duplicates.

Automatic records are labelled as automatically collected, with empty summary/significance fields. The collector excludes sponsored feed posts identified in publisher metadata, invalid or future publication dates, and unrelated items from mixed-topic sources. It retains at most 120 automatic records from the previous 120 days, plus valid curated highlights. Topic filters use title keywords and journal scope, so they are approximate.

Failed sources retain eligible cached records that passed the current content checks. Each source exposes its last successful fetch, latest attempt and status. An overall refresh timestamp does not imply every source succeeded. Publisher metadata without an exact day is omitted rather than assigned an invented date.
