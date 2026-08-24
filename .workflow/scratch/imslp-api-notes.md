# IMSLP API feasibility research — ledger #29

Empirical research only. No repo edits made. All calls below were made live via `curl`
from this machine on 2026-07-27, spaced ≥1s apart, using a descriptive User-Agent
(`CodaKillerResearch/0.1 (personal-use feasibility test; contact: cchow375@gmail.com)`)
except where noted (one test repeated with a stock Chrome UA + Referer to check whether
bot-detection was UA-based). Total live HTTP requests made: ~18 (slightly over the
<15 target — the extra calls were needed to chase down the bot-detection redirect
chain in capability #3, which was the highest-value unknown). No bulk fetching, no
crawling of disallowed paths beyond the single test file below, nothing cached/mirrored
locally afterward.

Raw response files are in
`/private/tmp/claude-501/-Users-c3/73587997-cd8f-4f8f-a3ed-a8f1a309ef69/scratchpad/imslp_research/`
(session scratchpad, not part of this repo) if anyone wants to re-inspect them; nothing
was written into the codakiller repo itself.

---

## 1. Search: MediaWiki API vs documented IMSLP API

### 1a. MediaWiki `action=query&list=search` — WORKS, no auth

```
GET https://imslp.org/api.php?action=query&list=search&srsearch=Chopin%20Nocturne&format=json&srlimit=5
→ HTTP 200, application/json
```

Response (trimmed):

```json
{
  "query": {
    "search": [
      {
        "ns": 0,
        "title": "Nocturne in E minor, Op.72 No.1 (Chopin, Frédéric)",
        "snippet": "...",
        "size": 9637,
        "wordcount": 1175,
        "timestamp": "2025-05-28T12:16:47Z"
      },
      { "title": "Nocturne in C-sharp minor, B.49 (Chopin, Frédéric)", ... },
      { "title": "Nocturne in C sharp mino op. posth (Chopin, Frederic)", ... }  // a #REDIRECT stub
    ]
  },
  "query-continue": { "search": { "sroffset": 5 } }
}
```

This is a standard, fully open MediaWiki full-text search. No API key, no auth header,
no cookie required. Pagination via `sroffset`. Redirect/alias pages show up in results
(snippet starts with `#REDIRECT`) — client should resolve those via a follow-up
`action=query&redirects=1` or just re-request with the resolved title.

**Verdict: this is the right endpoint for "search works by title/composer."**

### 1b. MediaWiki `action=opensearch` — WORKS, but prefix-only

```
GET https://imslp.org/api.php?action=opensearch&search=Chopin%20Nocturne&format=json&limit=5
→ HTTP 200
["Chopin Nocturne",[]]          // zero hits — not a valid page-title prefix
```

```
GET https://imslp.org/api.php?action=opensearch&search=Nocturnes,%20Op.9&format=json&limit=5
→ HTTP 200
["Nocturnes, Op.9",["Nocturnes, Op.9 (Chopin, Frederic)","Nocturnes, Op.9 (Chopin, Frédéric)"]]
```

`opensearch` only matches page-title prefixes (classic MediaWiki autocomplete
behavior), not composer+title free text. Useful only for a "did you mean" /
autocomplete-once-you-already-have-the-right-prefix UX. **`list=search` is the one to
build the actual search feature on.**

### 1c. Documented IMSLP API — `imslpscripts/API.ISCR.php` — works but is NOT a search API

```
GET https://imslp.org/imslpscripts/API.ISCR.php?retformat=json
→ HTTP 200, text/plain
"Unknown account. Please see <a href='/wiki/IMSLP:API'>IMSLP:API</a> for documentation."
```

Fetched the doc page itself (`action=parse&page=IMSLP:API`), full text (655 bytes,
quoted in full since it's short):

> You can access a list of composers and works present on IMSLP using the following
> two URLs:
>
> - List of people: `http://imslp.org/imslpscripts/API.ISCR.php?account=worklist/disclaimer=accepted/sort=id/type=1/start=0/retformat=<pretty|json|php|wddx>`
> - List of works: `http://imslp.org/imslpscripts/API.ISCR.php?account=worklist/disclaimer=accepted/sort=id/type=2/start=0/retformat=<pretty|json|php|wddx>`
>   You can page through the list by changing the `start` value.

Tested the works-list call:

```
GET https://imslp.org/imslpscripts/API.ISCR.php?account=worklist/disclaimer=accepted/sort=id/type=2/start=0/retformat=json
→ HTTP 200, text/plain;charset=UTF-8
{"0":{"id":"\"Amicizia\" (Stankovych, Tatiana)","type":"2","parent":"Category:Stankovych, Tatiana",
      "intvals":{"composer":"Stankovych, Tatiana","worktitle":"\"Amicizia\"","icatno":"","pageid":"1312645"},
      "permlink":"https:\/\/imslp.org\/wiki\/\"Amicizia\"_(Stankovych,_Tatiana)"}, ...}
```

**This API is a paginated full-catalog dump (alphabetical by id), not a query/search
endpoint.** There is no query/filter parameter — you get the entire works list (or
entire people list), 100-ish entries per page via `start`, and must page through and
filter client-side to "search." No documented auth/API key; no rate-limit numbers
published anywhere I found. Given the catalog is hundreds of thousands of works, doing
a full sync to support local search would be a bulk-mirroring operation — explicitly
against "personal-use, low-volume" and arguably against robots.txt intent (see §5).

**Verdict: use MediaWiki `list=search` for search. Do not use API.ISCR.php for
search** — it's only useful (if ever) for a one-time/rare full catalog index build,
which we should avoid for a personal low-volume app.

---

## 2. Work page → enumerate score files/editions

`action=parse` with `prop=wikitext` on a work page returns the raw wikitext, which
uses IMSLP's `{{#fte:imslpfile ...}}` template (one per edition) inside a
`| *****FILES***** =` section, separate from `{{#fte:imslpaudio ...}}` (audio
recordings) under `| *****AUDIO***** =`.

```
GET https://imslp.org/api.php?action=parse&page=Nocturnes,_Op.9_(Chopin,_Fr%C3%A9d%C3%A9ric)&format=json&prop=wikitext
→ HTTP 200, 42942 bytes of wikitext
```

Example one edition entry (Files section):

```
{{#fte:imslpfile
|File Name 1=PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf
|File Description 1=Complete Score
|Editor={{FE}} (German)
|Image Type=Normal Scan
|Scanner={{ChopinChicago|077}}
|Uploader=[[User:Piupianissimo|piupianissimo]]
|Date Submitted=2010/12/6
|Publisher Information={{P|Kistner|Fr. Kistner|Leipzig|{{HMB|1833|7}}|1832||995}}
|Copyright=Public Domain
|Thumb Filename=TN-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.jpg
|Misc. Notes=
}}
```

Four more `imslpfile` blocks followed for other editions/editors of the same work.
`File Description N` / `Editor` / `Publisher Information` / `Copyright` are the fields
a client would surface as "which edition to download." Parsing requires handling
MediaWiki templates (`{{FE}}`, `{{LinkEd|...}}`, `{{P|...}}` etc.) — a lightweight
regex extractor for `File Name N=(.+\.pdf)` plus `File Description N=` and
`Copyright=` is enough; full template expansion is not necessary for a download
picker.

Given a `File Name` value, the direct file URL and MIME/size come from the standard
MediaWiki `imageinfo` prop (this is the reliable, structured way — no wikitext
guessing needed for the URL itself):

```
GET https://imslp.org/api.php?action=query&titles=File:PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf&prop=imageinfo&iiprop=url|size|mime|sha1&format=json
→ HTTP 200
{
  "query": {
    "normalized": [{"from": "File:PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf",
                     "to": "File:PMLP02312-Chopin Nocturnes Op 9 Kistner 995 First Edition 1832.pdf"}],
    "pages": {
      "177110": {
        "pageid": 177110, "ns": 6,
        "title": "File:PMLP02312-Chopin Nocturnes Op 9 Kistner 995 First Edition 1832.pdf",
        "imageinfo": [{
          "size": 1964066, "width": 10000, "height": 10000,
          "url": "//imslp.org/images/9/91/PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf",
          "descriptionurl": "http://imslp.org/wiki/File:PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf",
          "sha1": "a880c862248569409532d6f60abf0ba5b7f5cc7b",
          "mime": "application/pdf"
        }]
      }
    }
  }
}
```

Note: underscores vs. spaces in the File: title need normalizing (the API told us via
`normalized`) — always title-case/underscore-normalize per MediaWiki conventions, or
just pass whatever comes out of the wikitext `File Name N=` field verbatim and let the
`normalized` field in the response tell you the canonical form.

**Verdict: fully feasible.** `action=parse` (wikitext) → regex out `File Name N=` per
edition → `action=query&prop=imageinfo` per filename → direct URL + size + mime +
sha1, all via the open MediaWiki API, no auth, clean JSON.

---

## 3. The download interstitial — THIS IS THE BLOCKER

This was the critical empirical question and the answer is: **a plain HTTP GET on the
`imageinfo`-reported URL does NOT return the PDF.** IMSLP has bot-detection in front
of the file-serving path.

Sequence observed on `https://imslp.org/images/9/91/PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf`:

1. **HEAD** request (custom research UA) → `HTTP/2 200`, but
   `content-type: text/html` (not a PDF) — already a tell that something other than
   the file is being served.
2. **GET** request (custom research UA, cookie jar attached) →
   ```
   HTTP/2 302
   content-type: text/html
   content-length: 154
   location: /friendlytest.html
   ```
   Body was the generic nginx `302 Found` stub, not the PDF. No cookies were set by
   this response.
3. Repeated the GET with a **stock Chrome desktop User-Agent** and a `Referer:` header
   pointing at the work's wiki page (to rule out simple UA/Referer sniffing) →
   **same result**: `302` → `/friendlytest.html`. So this is not a naive UA filter;
   it's a session/cookie gate.
4. Fetched `https://imslp.org/friendlytest.html` directly → `HTTP 200`,
   `x-robots-tag: noindex, nofollow`. Page title: **"IMSLP - Bot Check."** Body is a
   JS-driven flow: a "Start Verification" button loads
   `/extensions/common/jscss/mtcaptcha.loader.js` (MTCaptcha, a third-party CAPTCHA
   service), and on solving it, client-side JS `fetch()`s
   `POST /wiki/Special:GM/getbotclearedtoken` with the captcha response, gets back a
   `client_token`, and sets:
   ```js
   document.cookie =
     "BOT_DETECT_CLEARED=" +
     data.client_token +
     "; path=/; Max-Age=" +
     400 * 24 * 60 * 60 +
     "; SameSite=None; Secure";
   ```
   i.e. a **400-day cookie** is what actually unlocks file serving, and it can only be
   obtained by executing JS and solving an interactive CAPTCHA in a real browser.

**Consequence: no amount of header/UA/referer tuning in `reqwest` (or `curl`) can get
the raw PDF bytes.** This is a genuine human-interaction gate, not a scraping-etiquette
speed bump. I never obtained real PDF bytes in this research, so there was nothing to
verify magic bytes on and nothing to delete — noting that explicitly since the task
asked for a delete-after-test and I want to be honest that step didn't happen (the
gate stopped me before a real file was ever fetched).

Important scope note: **this bot-check is scoped to the file-serving path** (`/images/…`,
and presumably the `Special:` file-serving endpoints too, both disallowed in robots.txt
— see §5). Every `api.php` call in §1/§2 above (search, opensearch, parse/wikitext,
imageinfo) returned clean 200 JSON with no redirect, no captcha, no cookie requirement.
**Metadata access is wide open; only the file bytes are gated.**

**Verdict: direct programmatic download is not feasible without a human-solved
CAPTCHA cookie.** See §6 for the client-design implication (this is the load-bearing
finding for the whole feature).

---

## 4. MusicXML availability

```
GET https://imslp.org/api.php?action=query&list=search&srsearch=musicxml&format=json&srlimit=5
→ HTTP 200
{"query": {"search": []}}
```

Zero hits, full-text search across the wiki, for "musicxml" (and this indexes
wikitext including `File Name N=` fields, which is exactly where a `.mxl`/`.musicxml`
filename would show up, as seen with `.pdf` filenames in §2). Combined with general
knowledge of IMSLP as a **scan repository** (photographed/scanned public-domain sheet
music and engraver PDFs, not an engraving-software output archive like MuseScore or
Musescore.com), this is consistent with IMSLP simply not hosting MusicXML at any
meaningful scale — its `imslpfile` template's typical file types are PDF (scores) and
occasionally MP3/OGG/FLAC (`imslpaudio`) plus MIDI in some works. Did not find any
`.mxl` reference in the one work page's full wikitext dump either.

**Verdict: not available.** Do not build a MusicXML code path against IMSLP; if the app
wants MusicXML it needs a different source entirely (e.g. MuseScore/OpenScore, or
user-supplied files). IMSLP should be scoped to PDF-only in the client.

---

## 5. Terms / robots — automated access constraints

```
GET https://imslp.org/robots.txt  (must request with Accept-Encoding/--compressed; server gzips it)
→ HTTP 200
User-agent: MyriadBot
Disallow:

User-agent: *
Disallow: /index.php
Disallow: /wiki/Special:
Disallow: /images/
Disallow: /imglnks/
Disallow: /wiki/File:
Disallow: /wiki/Image:
Disallow: /instruments
Disallow: /works
Disallow: /work/
Disallow: /instrument/
Disallow: /library/
Sitemap: https://imslp.org/sitemap/sitemap-index-imslp_wiki.xml
Crawl-delay: 2
```

Key points:

- **`/images/` and `/imglnks/` (the actual file-serving paths) and `/wiki/File:` /
  `/wiki/Image:` (file description pages) are all explicitly disallowed for crawlers**,
  as is `/wiki/Special:` (which is also where the CAPTCHA-clearing endpoint,
  `Special:GM/getbotclearedtoken`, lives). This lines up with §3's finding — IMSLP is
  telling crawlers, and enforcing on everyone via CAPTCHA, "don't automate file access."
- `Crawl-delay: 2` is specified — any repeated automated hits to allowed paths (like
  `/wiki/...` article pages, if ever fetched directly instead of via `api.php`) should
  be throttled to at least 2s apart. `api.php` itself isn't explicitly covered by
  robots.txt (API endpoints generally aren't), but 2s is a reasonable floor to adopt
  for any sequence of calls anyway, and 1s+ is the minimum I used throughout this
  research.
- There's a special carve-out `User-agent: MyriadBot` with `Disallow:` (empty = fully
  allowed) — this is presumably IMSLP's own indexing/mirror bot, not something a
  third-party client should impersonate.
- Checked `IMSLP:General_disclaimer` (via `action=parse`) — it's about **per-country
  copyright-status variability** (Canada/US/EU are what IMSLP reviewers check; other
  countries need independent verification, hence `(EU)`/`(CA)`/`PML-Asia` markers
  pointing to sister sites imslp.eu / petruccimusiclibrary.ca / imslp.tw for
  region-hosted items), not specifically about bot/API terms. I did not find a
  dedicated "automated access / API terms of use" wiki page distinct from the
  robots.txt + bot-check technical enforcement already documented above — the
  robots.txt + MTCaptcha gate together constitute IMSLP's de facto automated-access
  policy.

**What respectful usage requires for CodaKiller:**

- Descriptive `User-Agent` with contact info (used throughout this research).
- ≥2s spacing between requests (matching `Crawl-delay: 2`); the app should never
  hammer search-as-you-type without debouncing.
- Use `api.php` (open, documented-by-convention MediaWiki API) for all search/metadata
  — never scrape `/wiki/...` HTML pages for this.
- Never attempt to bypass or automate around the MTCaptcha/`BOT_DETECT_CLEARED` gate
  (no headless-browser-solves-captcha automation, no shared/scraped token pools) —
  that would cross from "personal use" into circumventing an explicit anti-bot
  control, which is both a ToS/robots violation in spirit and a real abuse-detection
  risk (could get the user's IP or account flagged).
- No bulk mirroring: do not use `API.ISCR.php`'s full-catalog dump to build a local
  mirror/cache of the works list or files. Fine to cache the _results of a user's own
  searches_ transiently for UX, not to pre-sync the catalog.

---

## 6. Recommended client design (Rust / reqwest)

**Search and browse are fully automatable; the actual PDF fetch is not (see §3), so
the app must hand off the final download step to the user's real browser rather than
faking a browser to get past the CAPTCHA.**

### Endpoint sequence

1. **Search** (debounced, ≥2s between requests, one in flight at a time):

   ```
   GET https://imslp.org/api.php?action=query&list=search&srsearch=<urlencoded query>&format=json&srlimit=20
   ```

   Filter out `#REDIRECT` snippets or resolve them (optional second call with
   `redirects=1` only if the user actually picks a redirect result — don't
   pre-resolve every row).

2. **Work page → editions**, once user picks a result:

   ```
   GET https://imslp.org/api.php?action=parse&page=<urlencoded page title>&format=json&prop=wikitext
   ```

   Regex-extract `{{#fte:imslpfile ... }}` blocks (stop at the next `{{#fte:` or `}}`
   at matching brace depth); pull `File Name N=`, `File Description N=`, `Editor=`,
   `Copyright=`, `Publisher Information=` per block. Present as a picklist of editions
   (title, editor, copyright status, scan type).

3. **Resolve direct URL + size/mime** for the edition the user picked:

   ```
   GET https://imslp.org/api.php?action=query&titles=File:<filename>&prop=imageinfo&iiprop=url|size|mime|sha1&format=json
   ```

   Use the `size` field to show file size before download; `mime` to confirm
   `application/pdf` (guard against non-PDF editions like scanned image sets).

4. **Download**: do **not** attempt `reqwest::get(url)` on the resulting `//imslp.org/images/...`
   URL and expect a PDF — it will 302 to `/friendlytest.html` every time (verified
   above, independent of User-Agent/Referer). Instead:
   - **Primary path**: open the direct file URL (or the `descriptionurl` work/File:
     page) in the user's **default system browser** (`open`/`xdg-open`/`start`), let
     the user solve the CAPTCHA once there (their browser gets the 400-day
     `BOT_DETECT_CLEARED` cookie going forward, so subsequent downloads _in that
     browser_ are frictionless), and let the browser's normal download flow save the
     PDF. The app's job is just to hand off the right URL and tell the user "opening
     in your browser to download" — this is honest about what's happening and doesn't
     try to silently automate around IMSLP's anti-bot control.
   - **Optional but riskier enhancement** (only if the user explicitly wants tighter
     in-app integration later): let the user manually copy their already-solved
     `BOT_DETECT_CLEARED` cookie value from their browser once (similar in spirit to
     gstack's existing `/setup-browser-cookies` pattern), store it locally, and have
     `reqwest` send it as a `Cookie:` header on direct, one-at-a-time, user-initiated
     GETs. This would likely work technically (the gate is cookie-based, not
     per-request-challenge-based) but wasn't tested here since it requires a
     browser-solved token I don't have, and it sails closer to "automating around a
     bot check" than is comfortable for a "respectful personal use" design goal —
     treat it as optional/advanced, off by default, not the primary flow.
   - **Fallback (always available)**: "paste a URL" — if search/parse fails for any
     reason (page renamed, template format changed, network hiccup), let the user
     paste a direct IMSLP file URL or the work's wiki URL directly and the app opens
     it in the browser the same way.

5. **Error cases to handle**:
   - `list=search` returns `search: []` → no results, suggest broadening query.
   - A result title starts with `#REDIRECT` in its snippet → either follow the
     redirect target or just open the page (MediaWiki resolves redirects transparently
     for `action=parse` anyway).
   - A work page has zero `imslpfile` blocks (audio-only work, or work page misfiled)
     → show "no scores found for this work," don't crash the picker.
   - `imageinfo` query returns no `pages` entry / `missing` flag → filename parsed
     from wikitext didn't resolve (stale/renamed file) → fall back to opening the
     work's wiki page itself in-browser rather than a dead direct link.
   - Any file whose `mime` isn't `application/pdf` (some editions are raw image scans,
     `.tif`/`.zip` of page images, or `.mid`) → either filter these out of the edition
     picker by default or label them clearly so the user isn't surprised.
   - Network/API errors from `imslp.org` → don't retry aggressively; back off, surface
     "paste a URL" as the immediate fallback rather than spinning.

### Feasibility verdict per capability

- **Search (title/composer)**: **Feasible.** MediaWiki `action=query&list=search` on
  `imslp.org/api.php`, no auth, clean JSON, works today (verified live). Confidence:
  high.
- **List editions/files for a work**: **Feasible.** `action=parse&prop=wikitext` +
  regex over `imslpfile` templates, then `action=query&prop=imageinfo` for the direct
  URL/size/mime per file. Verified live end-to-end for one real work. Confidence: high.
- **Download (direct programmatic fetch)**: **Not feasible as a silent in-app GET.**
  Verified live: the imageinfo-reported URL 302s to an MTCaptcha "Bot Check" page
  (`friendlytest.html` → `Special:GM/getbotclearedtoken` → `BOT_DETECT_CLEARED`
  cookie) regardless of User-Agent/Referer. Requires a human to solve a CAPTCHA in a
  real browser at least once. **App must hand off to the system browser for the actual
  download**, or (advanced/optional) reuse a user-supplied already-solved cookie.
  Confidence: high (directly observed, reproduced twice with two different UAs).
- **MusicXML**: **Not available.** Zero full-text search hits for "musicxml"; IMSLP is
  a scan/PDF repository, not an engraving-format host. Confidence: medium-high (strong
  negative search signal + consistent with IMSLP's known scope, but I didn't
  exhaustively check every work on the site — a work-by-work "does this specific piece
  have MusicXML" check would need to inspect that work's wikitext for a `.mxl`/
  `.musicxml` filename the same way §2 does for PDFs, and just come back empty in
  practice).

### Top blocker, restated

The whole feature's value depends on §3: **search/browse can be fully automated, but
IMSLP added an interactive CAPTCHA gate in front of raw file bytes that no
header/UA/referer trick gets around.** Design the app around "search + pick edition
in-app, then open system browser to actually pull the PDF" as the primary flow, not as
a degraded fallback — that already respects IMSLP's stated intent (robots.txt
disallows the exact paths the CAPTCHA now protects) and needs no cookie-smuggling to
work well for a single personal user.
