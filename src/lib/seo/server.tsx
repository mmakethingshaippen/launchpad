import { renderToStaticMarkup } from 'react-dom/server';
import { AboutContent, ABOUT_DESCRIPTION, ABOUT_TITLE } from '../../components/about/AboutContent';
import { GUIDES } from '../../data/resources';
import { freshnessCutoff, isFreshlyVerified } from '../freshness';
import { visibleCompanyDescription } from '../companyDisplay';
import { SITE_ORIGIN, aboutStructuredData } from './identity';
import { himalayasSourceUrl } from '../../components/ui/JobSource';

export { SITE_ORIGIN } from './identity';
const PAGE_SIZE = 1000;
const PRIVATE = new Set(['/admin', '/applications', '/signin', '/reset-password', '/submit']);
const STATIC = ['/', '/about', '/browse', '/map', '/resources'];
const SLUG = '[a-zA-Z0-9][a-zA-Z0-9_-]{0,220}';
type Row = Record<string, unknown>;
export interface SeoOptions {
  shell: string;
  supabaseUrl?: string;
  anonKey?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}
export interface SeoResponse { status: number; headers: Record<string, string>; body: string }
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const text = (value: unknown) => String(value ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
const url = (path: string) => `${SITE_ORIGIN}${path}`;
const slugPath = (prefix: string, slug: unknown) => `${prefix}/${encodeURIComponent(String(slug))}`;
const companyOf = (row: Row): Row => (Array.isArray(row.companies) ? row.companies[0] : row.companies) as Row ?? {};
const safeHref = (value: unknown): string | null => {
  try { const u = new URL(String(value)); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; }
};

function layout(content: string): string {
  return `<div class="flex min-h-screen flex-col bg-slate-50 text-slate-700"><header class="border-b border-slate-200 bg-white"><nav aria-label="Main" class="mx-auto flex max-w-7xl flex-wrap items-center gap-6 px-4 py-5"><a class="text-xl font-bold text-navy" href="/">Launchpad</a><a href="/browse">Browse</a><a href="/map">Map</a><a href="/resources">Resources</a><a href="/about">Our mission &amp; creator</a><a href="/signin">Sign in</a></nav></header><main id="main" class="mx-auto w-full max-w-7xl flex-1 px-4 py-8">${content}</main><footer class="mx-auto w-full max-w-7xl border-t border-slate-200 px-4 py-8 text-sm"><a href="/about">Built by Maxim Culbeaux · Our mission</a><p class="mt-2">We check listings against available sources. Listings awaiting verification are temporarily hidden.</p></footer></div>`;
}

export function renderSeoHtml(shell: string, path: string, title: string, description: string, content: string, noindex = false, schema?: unknown): string {
  let html = shell.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b(?=[^>]*(?:name|property)=["'](?:description|robots|og:title|og:description|og:url|twitter:title|twitter:description)["'])[^>]*>/gi, '')
    .replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/gi, '');
  const head = `<title>${escape(title)}</title><meta data-rh="true" name="description" content="${escape(description)}"><link data-rh="true" rel="canonical" href="${escape(url(path))}"><meta data-rh="true" property="og:title" content="${escape(title)}"><meta data-rh="true" property="og:description" content="${escape(description)}"><meta data-rh="true" property="og:url" content="${escape(url(path))}"><meta data-rh="true" name="twitter:title" content="${escape(title)}"><meta data-rh="true" name="twitter:description" content="${escape(description)}">${noindex ? '<meta data-rh="true" name="robots" content="noindex,follow">' : ''}${schema ? `<script data-rh="true" type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>` : ''}`;
  html = html.replace('</head>', `${head}</head>`);
  const start = html.indexOf('<div id="root">');
  const end = html.lastIndexOf('</div>', html.lastIndexOf('</body>'));
  if (start < 0 || end < start) throw new Error('Missing app root in HTML template');
  return `${html.slice(0, start)}<div id="root">${layout(content)}</div>${html.slice(end + 6)}`;
}

function links(rows: Row[]): string {
  return `<ul class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${rows.map(row => {
    const company = companyOf(row);
    const source = himalayasSourceUrl(typeof row.source_url === 'string' ? row.source_url : undefined);
    const location = [row.city, row.state, row.country].filter(Boolean).join(', ');
    return `<li class="rounded-xl border border-slate-200 bg-white p-5"><h2 class="text-lg font-semibold text-navy"><a href="${escape(slugPath('/roles', row.slug))}">${escape(row.title)}</a></h2><p>${escape(company.name)}</p><p>${escape(location)}</p>${source ? `<p class="mt-3 text-sm">Source: <a class="underline" href="${escape(source)}">Himalayas</a></p>` : ''}${company.slug ? `<a class="mt-3 inline-block underline" href="${escape(slugPath('/companies', company.slug))}">More from ${escape(company.name)}</a>` : ''}</li>`;
  }).join('')}</ul>`;
}

function staticContent(path: string): { title: string; description: string; content: string; schema?: unknown } | null {
  if (path === '/about') return {
    title: ABOUT_TITLE, description: ABOUT_DESCRIPTION, content: renderToStaticMarkup(<AboutContent />),
    schema: aboutStructuredData(),
  };
  if (path === '/resources') return { title: 'Career Resources — Launchpad', description: 'Practical guides for internship resumes, interviews and evaluating offers.',
    content: `<h1 class="text-3xl font-bold text-navy">Career Resources</h1><p class="mt-3">Practical guides to help you find and choose the right opportunity.</p><ul class="mt-6 space-y-6">${GUIDES.map(g => `<li><h2 class="text-xl font-semibold"><a href="${slugPath('/resources', g.slug)}">${escape(g.title)}</a></h2><p>${escape(g.summary)}</p></li>`).join('')}</ul>` };
  const guide = GUIDES.find(g => path === `/resources/${g.slug}`);
  if (guide) return { title: `${guide.title} — Launchpad`, description: guide.summary,
    content: `<article class="mx-auto max-w-2xl"><a href="/resources">All resources</a><h1 class="mt-5 text-3xl font-bold text-navy">${escape(guide.title)}</h1><p class="mt-3">${escape(guide.summary)}</p>${guide.sections.map(s => `<section class="mt-8"><h2 class="text-xl font-semibold">${escape(s.heading)}</h2>${s.body.map(p => `<p class="mt-3">${escape(p)}</p>`).join('')}${s.bullets ? `<ul class="mt-3 list-disc pl-6">${s.bullets.map(b => `<li>${escape(b)}</li>`).join('')}</ul>` : ''}</section>`).join('')}</article>` };
  return null;
}

/** All database reads use the browser's public key and public_roles view, never roles/service credentials. */
export async function handleSeoRequest(rawPath: string, options: SeoOptions): Promise<SeoResponse> {
  const requestUrl = new URL(rawPath, SITE_ORIGIN);
  const requestedPath = requestUrl.searchParams.get('__path') ?? requestUrl.pathname;
  const path = requestedPath.replace(/\/+$/, '') || '/';
  const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=60' };
  const page = (status: number, title: string, description: string, content: string, noindex = false, schema?: unknown): SeoResponse => ({
    status, headers: { ...headers, ...(noindex ? { 'X-Robots-Tag': 'noindex, follow', 'Cache-Control': 'no-store' } : {}) },
    body: renderSeoHtml(options.shell, path, title, description, content, noindex, schema),
  });
  const notFound = () => page(404, 'Page unavailable — Launchpad', 'This page is unavailable.', '<h1 class="text-3xl font-bold text-navy">Page unavailable</h1><p class="mt-4">This listing or page may be unavailable while we verify it.</p><a class="mt-4 inline-block underline" href="/browse">Back to Browse</a>', true);
  if (requestedPath !== path) return { status: 308, headers: { Location: path, 'Cache-Control': 'no-store' }, body: '' };
  const publicStatic = staticContent(path);
  if (publicStatic) return page(200, publicStatic.title, publicStatic.description, publicStatic.content, false, publicStatic.schema);
  if (PRIVATE.has(path)) return page(200, 'Your account — Launchpad', 'Manage your Launchpad account.', '<h1 class="text-2xl font-bold text-navy">Launchpad</h1><p class="mt-4">Continue in the app to manage your account or submit an opportunity.</p>', true);

  const jobMatch = new RegExp(`^/roles/(${SLUG})$`).exec(path);
  const companyMatch = new RegExp(`^/companies/(${SLUG})$`).exec(path);
  const sitemapMatch = /^\/sitemaps\/(jobs|companies)-([1-9]\d{0,4})\.xml$/.exec(path);
  const isSitemap = path === '/sitemap.xml' || path === '/sitemap-pages.xml' || Boolean(sitemapMatch);
  if (!jobMatch && !companyMatch && !isSitemap && !['/', '/browse', '/map'].includes(path)) return notFound();
  const now = options.now ?? new Date();
  const roleFilters = { listing_status: 'eq.Active', last_verified_at: `gte.${freshnessCutoff(now).toISOString()}` };
  const rest = async (table: 'public_roles' | 'companies', params: Record<string, string>, count = false) => {
    if (!options.supabaseUrl || !options.anonKey) throw new Error('Public data connection unavailable');
    const response = await (options.fetchImpl ?? fetch)(`${options.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?${new URLSearchParams(params)}`, {
      headers: { apikey: options.anonKey, Authorization: `Bearer ${options.anonKey}`, ...(count ? { Prefer: 'count=exact' } : {}) }, signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('Public data request failed');
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid public data response');
    const total = Number(response.headers.get('content-range')?.split('/')[1]);
    if (count && (!Number.isSafeInteger(total) || total < 0)) throw new Error('Public data count missing');
    return { rows: rows as Row[], total };
  };
  const xml = (body: string): SeoResponse => ({ status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' }, body: `<?xml version="1.0" encoding="UTF-8"?>${body}` });
  const xmlUrls = (paths: string[]) => xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p => `<url><loc>${escape(url(p))}</loc></url>`).join('')}</urlset>`);
  try {
    if (path === '/sitemap-pages.xml') return xmlUrls([...STATIC, ...GUIDES.map(g => `/resources/${g.slug}`)]);
    if (path === '/sitemap.xml') {
      const [roles, companies] = await Promise.all([rest('public_roles', { select: 'id', ...roleFilters, limit: '1' }, true), rest('companies', { select: 'id', limit: '1' }, true)]);
      const paths = ['/sitemap-pages.xml'];
      for (const [type, total] of [['jobs', roles.total], ['companies', companies.total]] as const) {
        const pages = Math.ceil(total / PAGE_SIZE);
        if (pages > 49000) throw new Error('Sitemap index limit exceeded');
        for (let i = 1; i <= pages; i++) paths.push(`/sitemaps/${type}-${i}.xml`);
      }
      return xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p => `<sitemap><loc>${escape(url(p))}</loc></sitemap>`).join('')}</sitemapindex>`);
    }
    if (sitemapMatch) {
      const [, type, n] = sitemapMatch;
      const offset = (Number(n) - 1) * PAGE_SIZE;
      const result = await rest(type === 'jobs' ? 'public_roles' : 'companies', { select: 'id,slug', order: 'id.asc', limit: String(PAGE_SIZE), offset: String(offset), ...(type === 'jobs' ? roleFilters : {}) });
      if (!result.rows.length) return notFound();
      return xmlUrls(result.rows.map(row => slugPath(type === 'jobs' ? '/roles' : '/companies', row.slug)));
    }
    if (jobMatch) {
      const { rows } = await rest('public_roles', { select: 'id,slug,title,description,apply_url,source_url,city,state,country,opportunity_type,work_arrangement,application_deadline,last_verified_at,companies(name,slug)', slug: `eq.${jobMatch[1]}`, ...roleFilters, limit: '1' });
      const job = rows[0];
      if (!job || !isFreshlyVerified(typeof job.last_verified_at === 'string' ? job.last_verified_at : null, now) ||
          (typeof job.application_deadline === 'string' && job.application_deadline.slice(0, 10) < now.toISOString().slice(0, 10))) return notFound();
      const company = companyOf(job);
      const title = `${job.title} at ${company.name ?? 'Employer'} — Launchpad`;
      const description = [job.opportunity_type, company.name, job.city, job.state, job.country].filter(Boolean).join(' · ');
      const source = himalayasSourceUrl(typeof job.source_url === 'string' ? job.source_url : undefined);
      const apply = source || safeHref(job.apply_url);
      const details = text(job.description);
      return page(200, title, description, `<article class="mx-auto max-w-3xl"><a href="/browse">Back to Browse</a><h1 class="mt-5 text-3xl font-bold text-navy">${escape(job.title)}</h1><p class="mt-3 text-lg">${escape(company.name)}</p><p class="mt-3">${escape(description)}</p><p class="mt-3">${escape(job.work_arrangement)}</p>${job.application_deadline ? `<p class="mt-3">Application deadline: ${escape(job.application_deadline)}</p>` : ''}<h2 class="mt-6 text-xl font-semibold">About this opportunity</h2><p class="mt-3 whitespace-pre-line leading-relaxed">${escape(details || 'See the employer’s posting for the full description, requirements and application details.')}</p>${apply ? `<a class="mt-6 inline-flex rounded-lg bg-navy px-5 py-3 font-semibold text-white" href="${escape(apply)}" rel="noopener noreferrer">${source ? 'Apply via Himalayas' : 'Apply on the employer’s site'}</a>` : ''}${source ? `<p class="mt-3 text-sm">Source: <a class="underline" href="${escape(source)}">Himalayas</a></p>` : ''}${company.slug ? `<p class="mt-6"><a class="underline" href="${escape(slugPath('/companies', company.slug))}">More opportunities at ${escape(company.name)}</a></p>` : ''}</article>`);
    }
    if (companyMatch) {
      const { rows } = await rest('companies', { select: 'id,slug,name,description', slug: `eq.${companyMatch[1]}`, limit: '1' });
      const company = rows[0];
      if (!company) return notFound();
      const jobs = await rest('public_roles', { select: 'slug,title,source_url,city,state,country,companies(name,slug)', company_id: `eq.${company.id}`, ...roleFilters, order: 'last_verified_at.desc,id.asc', limit: '21' });
      const description = visibleCompanyDescription(typeof company.description === 'string' ? company.description : null);
      return page(200, `${company.name} internships & early-career roles — Launchpad`, `Explore opportunities at ${company.name}.`, `<h1 class="text-3xl font-bold text-navy">${escape(company.name)}</h1>${description ? `<p class="mt-4 leading-relaxed">${escape(text(description))}</p>` : ''}<h2 class="mt-8 text-2xl font-semibold">Current opportunities</h2>${jobs.rows.length ? links(jobs.rows) : '<p class="mt-4">No verified opportunities are currently listed for this company.</p>'}`);
    }
    const jobs = await rest('public_roles', { select: 'slug,title,source_url,city,state,country,companies(name,slug)', ...roleFilters, order: 'last_verified_at.desc,id.asc', limit: '21' });
    const title = path === '/' ? 'Launchpad — Your career starts somewhere' : path === '/map' ? 'Explore opportunities on the map — Launchpad' : 'Browse internships, co-ops & early-career jobs — Launchpad';
    const heading = path === '/' ? 'Your career starts somewhere. Find your Launchpad.' : path === '/map' ? 'Explore opportunities by location' : 'Browse opportunities';
    const description = 'Discover internships, co-ops and early-career opportunities. Explore openings by location and organize your application search.';
    return page(200, title, description, `<h1 class="text-3xl font-bold text-navy">${heading}</h1><p class="mt-4 max-w-3xl text-lg">${description}</p><p class="mt-4"><a class="underline" href="/about">Our mission — created by Maxim Culbeaux</a></p><h2 class="mt-8 text-2xl font-semibold">Recently verified opportunities</h2>${links(jobs.rows)}<p class="mt-6"><a class="underline" href="/browse">Search and filter all opportunities</a></p>`, (path === '/browse' || path === '/map') && Boolean(requestUrl.searchParams.size - Number(requestUrl.searchParams.has('__path'))));
  } catch {
    const result = page(503, 'Temporarily unavailable — Launchpad', 'Please try again shortly.', '<h1 class="text-2xl font-bold text-navy">Temporarily unavailable</h1><p class="mt-4">Please try again shortly. You can also continue in the app.</p>', true);
    result.headers['Retry-After'] = '300';
    return result;
  }
}
