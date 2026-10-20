import type { SupabaseClient } from '@supabase/supabase-js';
import type { AggregatedPosting, AggregatorClient } from './types';
import { createTheMuseClient } from './themuse';
import { createRemotiveClient } from './remotive';
import { createAdzunaClient } from './adzuna';
import { createUsaJobsClient } from './usajobs';
import { createSimplifyClient } from '../simplify';
import { enrich, isDeadlinePassed } from '../normalize';
import { isEarlyCareer, classifyField } from '../classify';
import { resolveRoleCoords, isRemoteLocation } from '../cityCoords';
import { isValidHttpUrl, normalizeApplyUrl } from '../util';
import { roleConcluded, isExpiredTerm } from '../seasons';
import { isUsableCity } from '../supabaseSink';
import { canonicalCompanySlug, INTERNSHIP_ONLY_SLUGS } from '../companyMatch';
import { classifyCompanyByName } from '../classifyCompany';
import { createAmazonClient } from './amazon';

export interface AggregatorResult {
  source: string;
  companiesUpserted: number;
  rolesUpserted: number;
  errors: string[];
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
    createAmazonClient(opts.fetchImpl), // keyless Amazon public JSON
    createTheMuseClient(opts.fetchImpl),
    createRemotiveClient(opts.fetchImpl),
    createAdzunaClient(opts.fetchImpl), // targeted employer queries; no-op without keys
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
        // Req 7.1 — reject roles whose explicit application deadline has passed.
        if (isDeadlinePassed(p.deadline, now)) continue;
        // Req 7.2 — reject roles whose title targets an expired past term/year.
        if (isExpiredTerm(enriched.title, now)) continue;

        // Resolve or create the company. canonicalCompanySlug maps big-employer
        // aliases (e.g. "Amazon.com Services LLC", "Google LLC") onto the seeded
        // official slug so roles attach to the real company page / map pin.
        const slug = canonicalCompanySlug(p.companyName);

        // Req 6 — Google/Amazon/Tesla/SpaceX are internship/co-op only.
        if (
          INTERNSHIP_ONLY_SLUGS.has(slug) &&
          enriched.opportunityType !== 'Internship' &&
          enriched.opportunityType !== 'Co-op'
        ) {
          continue;
        }
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
            // Classify a newly-discovered company by name so it never renders as
            // "Other / Unknown" (Req 4). Known brands get a mapped industry +
            // Established Company + 501+; otherwise default to the role's field
            // and Established Company (we never fabricate a startup stage).
            const brand = classifyCompanyByName(p.companyName);
            const fields = brand?.fields ?? [classifyField(p.title)];
            const companyType = brand?.companyType ?? 'Established Company';
            const employeeRange = brand?.employeeRange ?? '501+';
            const { data: created, error: cErr } = await db
              .from('companies')
              .upsert(
                {
                  slug,
                  name: p.companyName,
                  website_url: p.companyWebsite ?? null,
                  description: `Opportunities aggregated from ${client.source}.`,
                  fields,
                  company_type: companyType,
                  employee_count_range: employeeRange,
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

        // Resolve coordinates (Remote → null; known city → coords). Drop junk
        // city text ("N/A", "2 Locations") so we never persist "Location N/A".
        const displayCity = isUsableCity(p.city) ? p.city! : null;
        const displayState = displayCity ? (p.state ?? null) : null;
        const displayCountry = displayCity ? (p.country ?? null) : null;
        const locationString = [displayCity, displayState, displayCountry].filter(Boolean).join(', ');
        // Req 2 — a role is only Remote when EXPLICITLY tagged Remote or its
        // location text says so. A real (even international) city must never be
        // mislabeled Remote just because it's unknown to our coord lookup.
        const remote = p.workArrangement === 'Remote' || isRemoteLocation(locationString);
        let latitude: number | null = null;
        let longitude: number | null = null;
        if (!remote) {
          const resolved = resolveRoleCoords(locationString || displayCity || null);
          if (resolved) {
            latitude = resolved.latitude;
            longitude = resolved.longitude;
          }
        }
        // Persisted work_arrangement: honor an explicit value; otherwise infer
        // Remote ONLY from the location text, else Onsite (never default a
        // physical-city role to Remote).
        const workArrangement = p.workArrangement ?? (remote ? 'Remote' : 'Onsite');

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
          city: displayCity,
          state: displayState,
          country: displayCountry,
          latitude,
          longitude,
          work_arrangement: workArrangement,
          application_deadline: p.deadline ? p.deadline.slice(0, 10) : null,
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
