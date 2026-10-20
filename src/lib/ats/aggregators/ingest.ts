import type { SupabaseClient } from '@supabase/supabase-js';
import type { AggregatedPosting, AggregatorClient } from './types';
import { createTheMuseClient } from './themuse';
import { createRemotiveClient } from './remotive';
import { createAdzunaClient } from './adzuna';
import { createUsaJobsClient } from './usajobs';
import { createSimplifyClient } from '../simplify';
import { enrich } from '../normalize';
import { isEarlyCareer, classifyField } from '../classify';
import { resolveRoleCoords, isRemoteLocation } from '../cityCoords';
import { isValidHttpUrl, normalizeApplyUrl } from '../util';
import { roleConcluded } from '../seasons';

export interface AggregatorResult {
  source: string;
  companiesUpserted: number;
  rolesUpserted: number;
  errors: string[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Ingest keyless aggregator feeds (The Muse, Remotive) into Supabase.
 *
 * Each distinct company name becomes (or matches) a company row; roles attach
 * to it with the shared early-career + field classification and resolved
 * coordinates. Nothing is fabricated — all data comes from the live feed.
 */
export async function ingestAggregators(
  db: SupabaseClient,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<AggregatorResult[]> {
  const clients: AggregatorClient[] = [
    createSimplifyClient(opts.fetchImpl), // keyless GitHub JSON — largest source
    createTheMuseClient(opts.fetchImpl),
    createRemotiveClient(opts.fetchImpl),
    createAdzunaClient(opts.fetchImpl), // safe no-op when env vars are absent
    createUsaJobsClient(opts.fetchImpl), // safe no-op when USAJOBS_API_KEY is absent
  ];
  const now = opts.now ?? new Date();
  const results: AggregatorResult[] = [];

  // Dedup across all connectors by normalized apply URL, and never duplicate a
  // direct ATS role already in the DB (also matched by normalized apply URL).
  const seenUrls = new Set<string>();
  {
    const { data: existingRoles } = await db.from('roles').select('apply_url');
    for (const r of (existingRoles ?? []) as Array<{ apply_url: string }>) {
      seenUrls.add(normalizeApplyUrl(r.apply_url));
    }
  }

  for (const client of clients) {
    const result: AggregatorResult = {
      source: client.source,
      companiesUpserted: 0,
      rolesUpserted: 0,
      errors: [],
    };
    let postings: AggregatedPosting[] = [];
    try {
      postings = await client.fetchEarlyCareer(AbortSignal.timeout(60_000));
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
      results.push(result);
      continue;
    }

    // Cache company slug -> id within this run to avoid duplicate upserts.
    const companyIdByName = new Map<string, string>();

    for (const p of postings) {
      try {
        if (!isValidHttpUrl(p.applyUrl)) continue;
        if (!isEarlyCareer({ title: p.title, employmentTypeRaw: p.employmentTypeRaw })) continue;

        // Strict dedup by normalized apply URL (strips utm_*, etc.). Skips both
        // intra-run duplicates and any role already present from a direct ATS feed.
        const normUrl = normalizeApplyUrl(p.applyUrl);
        if (seenUrls.has(normUrl)) continue;
        seenUrls.add(normUrl);

        const enriched = enrich(p);
        if (roleConcluded(enriched.seasons, enriched.cohortYear, now)) continue;

        // Resolve or create the company (matched by name).
        const slug = slugify(p.companyName);
        let companyId = companyIdByName.get(slug);
        if (!companyId) {
          const { data: existing } = await db
            .from('companies')
            .select('id')
            .eq('slug', slug)
            .maybeSingle();
          if (existing) {
            companyId = (existing as { id: string }).id;
          } else {
            const { data: created, error: cErr } = await db
              .from('companies')
              .upsert(
                {
                  slug,
                  name: p.companyName,
                  website_url: p.companyWebsite ?? null,
                  description: `Opportunities aggregated from ${client.source}.`,
                  fields: [classifyField(p.title)],
                  company_type: 'Other / Unknown',
                  degree_levels: [],
                  ats_provider: 'none',
                  source: 'aggregator',
                  moderation_status: 'Approved',
                  last_verified_at: now.toISOString(),
                },
                { onConflict: 'slug' },
              )
              .select('id')
              .single();
            if (cErr) throw new Error(`company ${p.companyName}: ${cErr.message}`);
            companyId = (created as { id: string }).id;
            result.companiesUpserted++;
          }
          companyIdByName.set(slug, companyId);
        }

        // Resolve coordinates (Remote → null; known city → coords).
        const locationString = [p.city, p.state, p.country].filter(Boolean).join(', ');
        const remote = p.workArrangement === 'Remote' || isRemoteLocation(locationString);
        let latitude: number | null = null;
        let longitude: number | null = null;
        if (!remote) {
          const resolved = resolveRoleCoords(locationString || p.city || null);
          if (resolved) {
            latitude = resolved.latitude;
            longitude = resolved.longitude;
          }
        }

        const roleRow = {
          company_id: companyId,
          external_job_id: enriched.externalJobId,
          slug: `${slug}-${enriched.externalJobId}`.slice(0, 80),
          title: enriched.title,
          field: enriched.field !== 'Other' ? enriched.field : classifyField(enriched.title),
          opportunity_type: enriched.opportunityType,
          degree_levels: enriched.degreeLevels,
          seasons: enriched.seasons,
          cohort_year: enriched.cohortYear,
          city: p.city ?? null,
          state: p.state ?? null,
          country: p.country ?? null,
          latitude,
          longitude,
          work_arrangement: p.workArrangement ?? 'Remote',
          apply_url: p.applyUrl,
          description: enriched.descriptionHtml,
          source: 'aggregator',
          source_url: p.applyUrl,
          moderation_status: 'Approved',
          listing_status: 'Active',
          last_verified_at: now.toISOString(),
        };

        let { error: rErr } = await db
          .from('roles')
          .upsert(roleRow, { onConflict: 'company_id,external_job_id' });
        if (rErr && /latitude|longitude/.test(rErr.message) && /column/i.test(rErr.message)) {
          const { latitude: _la, longitude: _lo, ...rest } = roleRow;
          void _la;
          void _lo;
          ({ error: rErr } = await db
            .from('roles')
            .upsert(rest, { onConflict: 'company_id,external_job_id' }));
        }
        if (rErr) throw new Error(`role ${enriched.externalJobId}: ${rErr.message}`);
        result.rolesUpserted++;
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    results.push(result);
  }

  return results;
}
