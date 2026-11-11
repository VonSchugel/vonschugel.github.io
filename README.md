# marqicci.github.io

A dependency-free portfolio built with HTML, CSS, JavaScript, and a small Node.js content builder. Projects, writing, and the CV are readable without JavaScript.

## Design direction

Keep the fixed header and its small Moroccan teapot-and-glass logo. There is no large hero illustration. The glass fills in proportion to the **entire document’s scroll progress**: empty at the top and full at the page bottom, regardless of the hero’s height. Preserve the Moroccan silhouette, comfortable type, rounded cards, and short supporting copy. Reduced motion uses a static logo. The CV stays directly in the page.

Match the supplied silhouette: a solid round belly, tiered pointed lid and finial, curved spout on the left, and curled handle on the right, with the glass to the left for pouring.

## Edit and preview

Use Node.js 22 or newer; deployment uses Node.js 24. No package installation is needed.

```sh
npm run build
npm run dev
```

Open the local address printed by the preview command. After editing content or the template, rebuild and refresh. `npm run preview` serves the exact `dist/` artifact; `npm run dev -- --port 4174` changes the preview port. `npm run check` runs the focused tests and production build.

| File | Content |
| --- | --- |
| `data/profile.json` | Name, role, biography, site URL, social links, and Substack publication/name |
| `data/projects.json` | Projects, in display order |
| `data/connections.json` | Project inventory, work areas, source visibility, and compatibility links |
| `data/articles.json` | Cached Substack articles or manually curated writing |
| `data/cv.json` | On-page CV: experience, tools explored, and current interests |
| `data/experience.json` | Additional timeline data for the `EXPERIENCE` template marker |
| `site.template.html` | Page structure and section order |
| `assets/tea-logo.svg` | Small inline header logo |
| `assets/js/teapot.js` | Header logo’s scroll behavior |
| `assets/css/styles.css` | Layout and appearance |
| `scripts/build.mjs` | Data validation and section rendering |

The build replaces `index.html` and recreates `dist/`. Edit the template and data files rather than generated HTML. Public assets and legacy `about.html`, `make.html`, and `shop.html` routes are included in `dist/`; authoring data and scripts are excluded.

## Update content

**Projects:** each entry needs a unique lowercase `id`, `title`, one-sentence `description`, `year`, and `tags` array. Set `github` and `demo` to complete URLs or `null`. The decorative `visual` treatments include `tea`, `pilot`, `data`, and `browser`. Set `map` to the matching project-map ID. Every entry is displayed; `featured` is reserved metadata.

**Project map:** use `lane` for Capture, Review & data, or Experience. Set `visibility` to public, private, or local. Only public projects can include a `repo` URL. A newly initialized private repository can use `repoState: "initialized"` so the map says README only. `paths` describe work inside a project or a public integration. Each `relations` entry uses a target ID (`to`), status, title, and explanation. Add a `contract` with `artifact`, `transfer`, `result`, `boundary`, and optional `evidence` to show the exchange in the network and compatibility table. The upstream and downstream views follow directed arrows in the current filters. A route containing any proposed adapter is marked Proposed.

**CV:** edit `summary`, `experience`, `skills`, and `now` in `data/cv.json`. Experience entries use `period`, `title`, and optional `description`. An optional `education` array uses the same shape and adds an education card when populated. Add verified facts only; the tools list describes project exposure rather than professional expertise.

**Writing:** the configured publication is `https://marqicci.substack.com`, with `substackName` set to “Marqicci Take.” Refresh the six most recent public entries with `npm run update:feed`, then rebuild. Articles appear newest first with title and date. For manual curation, set `profile.substack` to `null` and edit articles with `title`, `url`, `date` (`YYYY-MM-DD`), and optional `description`.

Feed requests happen during builds, with a 15-second timeout and 2 MB limit. Failed or malformed responses preserve the source cache. Scheduled refreshes require fresh data and stop before deployment on failure, preserving the live site; pushes and manual runs can use cached articles. Successful scheduled refreshes do not commit data back to the repository, so refresh and commit the cache locally when desired.

**Logo:** the build embeds `assets/tea-logo.svg` through `{{TEA_LOGO}}`, making it visible before JavaScript runs. Keep the element IDs used by the animation script. Measure fill progress against document scroll height minus viewport height, not the first section. The build stops if the required SVG is missing or incomplete.

For another repeated section, add a JSON file and renderer in `scripts/build.mjs`, then register its template marker. Keep content static and interactions optional.

## Optional local drafting

With the shared local Ollama service running at `http://127.0.0.1:11434` and the active default `qwen3:0.6b` installed, run `npm run enrich:local`. This model passed an integration smoke test; that does not establish factual reliability. `qwen3:1.7b-q4_K_M` remains a recommended candidate pending its download and evaluation. Set `LOCAL_LLM_MODEL` to that tag only after installing and evaluating it, or to another installed local model when needed. Keep cloud features disabled on the service (`OLLAMA_NO_CLOUD=1`); the authoring task rejects cloud-labeled models and HTTP redirects and has no cloud fallback or automatic model download.

This optional task reads the current `data/articles.json` snapshot and suggests short descriptions and topic tags. It uses cached titles and excerpts, not full articles. Suggestions are marked for review in ignored `local-drafts/article-enrichment.json`, alongside the unchanged source fields, model, time, and source hash. Review factual accuracy before manually copying wording into authoring data. The draft directory is excluded from `dist/`, and no suggestions are automatically published.

Run it after `npm run update:feed` when fresh articles are wanted, or independently of ingestion and builds when the existing cache is sufficient. Each run has a two-minute timeout, a 32 KB source-file limit, a 2,800-byte prompt limit including messages and schema, a 64 KB response limit, and strict output validation. The prompt limit reserves room for output in the model's 4K context; oversized snapshots fail with a request to split or batch the input, without silently truncating article text. A failed request preserves the prior cache and draft. The normal build and GitHub Pages workflow do not require Ollama. The task uses Ollama's [chat API](https://docs.ollama.com/api/chat) and [structured outputs](https://docs.ollama.com/capabilities/structured-outputs).

## Publish

The source repository is `VonSchugel/marqicci.github.io`. To publish from it, enable Actions for the fork if prompted, then choose **GitHub Actions** in **Settings → Pages → Build and deployment**. Push reviewed changes to `main` or run the workflow manually.

The included workflow refreshes articles, verifies content, builds `dist/`, and deploys with GitHub’s official Pages actions. It runs on pushes, manual dispatch, and daily at 07:17 UTC while Substack is configured. The default Pages address for this repository is `https://vonschugel.github.io/marqicci.github.io/` once Pages is enabled. Any static host can also serve `dist/`.

See [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [publishing-source settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Maintain

`npm test` covers content escaping, URL/date validation, CV rendering, inline logo output, production packaging, RSS parsing, and cache retention. Review external links and factual accuracy separately. After layout edits, check phone and desktop widths, keyboard focus, fixed-header anchors, reduced motion, and glass fill at the page top and bottom. Keep bundled font and asset license notices.

Keep the original outlined browser tab icon (`assets/favicon.svg`) separate from the solid reference silhouette used in the page header.

The project map covers work developed in these Codex projects. Evidence is based on the local READMEs, implemented workflows, and checked GitHub repository visibility. Private URLs, credentials, customer records, draft data, and local paths are excluded from the map.
