# Search indexing release and verification

The Mission & About page lives at `/about` and uses the owner-approved copy and
polo portrait. The shared content component supplies both the interactive page
and the initial server-rendered HTML, including the creator's name and image.
Nothing requires a new migration or private database credential.

## Public rendering

Vercel routes public documents through `api/seo.js`. Everyone receives the same
initial HTML; there is no bot-specific rendering. The interactive app then loads
normally. Job details and listings read only `public_roles` with the public anon
key, retaining the existing approval, deadline and seven-day freshness policy.
Company reads use the same publicly readable company fields as the browser.
No server-side query reads `roles`, verification failures, users or applications.

Each public page gets a distinct title, description and canonical URL. Unknown
and unavailable job URLs return 404 with noindex; transient database failures
return 503 with Retry-After, rather than pretending the job was deleted. Account,
admin and submission routes are noindex. Filter/query variants of Browse and Map
are noindex and canonicalize to their main page. Verification HTML/XML files,
robots.txt, images, assets and API functions are served through filesystem routes.

`npm run build` bundles the SEO function with the just-built Vite HTML and only
the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. It rejects a JWT whose
role is not anon. It never embeds service credentials. Keep both public variables
configured in Vercel as they already are for the client app.

## Sitemaps

`/sitemap.xml` is now a live sitemap index. It references `/sitemap-pages.xml`
for the mission, main public pages and every resource guide, plus paginated
`/sitemaps/jobs-N.xml` and `/sitemaps/companies-N.xml` documents. Each data sitemap
contains at most 1,000 URLs, so project response caps cannot silently limit the
site to its first 1,000 records. Fresh public jobs are included; private pages,
unavailable jobs and search-filter variants are excluded. No fabricated lastmod
dates or JobPosting fields are added. Basic page indexing does not require
JobPosting rich-result markup; some imported records lack the original posting
date or full description required for an accurate job-rich-result submission.

## Review before publishing

Review the local About page and public rendering first. No push, deployment or
Search Console submission is performed automatically by these changes.

After deployment:

1. Open `/about` and View Source. Confirm the approved mission, Maxim Culbeaux,
   portrait, title, canonical and Person/AboutPage data are in the initial HTML.
2. Open `/sitemap.xml`, a jobs sitemap and a company sitemap. Confirm XML rather
   than the app shell is returned. Confirm a real job URL has its own title and
   visible job details in View Source, and a nonexistent URL returns 404.
3. In the correct Google Search Console property for
   `https://launchpad-careers.vercel.app/`, use Sitemaps to submit `sitemap.xml`.
   If the same sitemap URL was previously submitted, Google can reread it.
4. Use URL Inspection → Test live URL on `/`, `/about`, a current job and a
   company. Inspect the rendered HTML, then Request indexing for those samples.
   The sitemap supplies all eligible public URLs; do not manually submit every job.
5. In Bing Webmaster Tools submit the same sitemap and inspect sample URLs.
6. Review Page indexing → Why pages aren't indexed and indexing/crawl errors.
   A submitted sitemap and verified ownership do not guarantee indexing or rank.

Google references:
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
