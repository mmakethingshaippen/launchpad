import type { NormalizedPosting } from './types';
import type { FieldType, DegreeLevel, OpportunityType } from '../adapter/types';

// ─────────────────────────────────────────────────────────────────────────────
// Strict TITLE-LEVEL early-career filter.
//
// Historically we matched on title OR body OR employmentType, which let two
// classes of false positives through:
//   1. Workday's `searchText:"intern"` body search surfaced senior roles whose
//      descriptions merely said "internal" / "international".
//   2. Full-time HR/recruiting roles that *recruit* students ("Head of Early
//      Career Recruiting", "University Recruiter") contain "early career" /
//      "university" / "campus" and were mistaken for jobs *for* students.
//
// The filter below is evaluated strictly on the role TITLE and applies three
// rules in order: A1 (hard seniority blocklist), A2 (recruiter/HR meta-role
// guard), then B (require a positive early-career pattern). It is the single
// gate every connector funnels through.
// ─────────────────────────────────────────────────────────────────────────────

/** Explicit intern/co-op/fellowship signal — the only thing that overrides A1/A2. */
export const EXPLICIT_INTERN_RE = /\b(intern|interns|internship|internships|co-?op|fellow|fellows|fellowship)\b/i;

/**
 * Rule A1 — hard seniority / leadership blocklist. Any match rejects the title
 * unless it is explicitly an internship (EXPLICIT_INTERN_RE) AND carries none of
 * the unambiguous senior tokens in SENIORITY_HARD_RE below.
 *
 * Note the Roman-numeral seniority tokens (ii, iii, iv, v) and single-letter
 * exec abbreviations (vp/avp/svp/evp, md) require word boundaries so they never
 * clip real words ("video", "medical", etc.).
 */
export const SENIOR_RE =
  /\b(vice president|avp|vp|svp|evp|director|executive|chief|head of|head|principal|staff|sr\.?|senior|lead|manager|management|architect|partner|counsel|md|managing director|ii|iii|iv|v)\b/i;

/**
 * The subset of A1 tokens that can NEVER be rescued by an intern keyword. This
 * lets "Executive Office Intern" through while still rejecting "Head of Early
 * Career Recruiting" or "VP Intern Programs".
 */
export const SENIORITY_HARD_RE =
  /\b(vice president|avp|vp|svp|evp|director|chief|head of|head|senior|sr\.?|principal|staff|managing director|md)\b/i;

/**
 * Rule A2 — recruiter / HR meta-role guard. A title describing someone who
 * *recruits* early-career talent is a full-time role, not an early-career role.
 * Reject on any of these unless the title is explicitly an internship.
 */
export const RECRUITER_RE =
  /\b(recruiter|recruiting|recruitment|talent acquisition|sourcer|talent partner|people partner|hrbp|program manager|coordinator)\b/i;

/** Rule B — positive internship / co-op patterns. */
export const INTERNSHIP_TITLE_RE =
  /\b(intern|interns|internship|internships|co-?op|summer analyst|winter analyst|spring analyst|fall analyst|extern|externship|apprentice|apprenticeship|fellow|fellows|fellowship|undergraduate intern|phd intern|mba intern)\b/i;

/**
 * Rule B — positive entry-level / new-grad patterns.
 *
 * NOTE: the ambiguous "level I" tokens (`engineer i`, `analyst i`, `associate i`,
 * `developer i`) and bare `junior`/`jr` were REMOVED. Real postings like
 * "Software Engineer I, Backend (Collections)" are ordinary full-time roles, not
 * early-career-only roles, and were cluttering results. A title now qualifies as
 * new-grad only via an unambiguous signal below. If a posting genuinely is an
 * internship/new-grad it will also carry one of these explicit words (or an
 * INTERNSHIP_TITLE_RE word), so nothing real is lost.
 */
export const NEWGRAD_TITLE_RE =
  /\b(new grad|new graduate|recent grad|early career|entry[- ]level|university grad|graduate engineer|graduate analyst|graduate software|rotational program|rotational|leadership development program|ldp|analyst development program)\b/i;

/**
 * Strict, title-only early-career gate. Returns the matched opportunity type
 * (so callers never hardcode 'Internship'), or null when the title fails any
 * rule. This is the authoritative filter for every connector.
 */
export function matchEarlyCareerType(title: string | null | undefined): OpportunityType | null {
  if (!title) return null;
  const t = title.trim();
  if (!t) return null;

  const explicitIntern = EXPLICIT_INTERN_RE.test(t);

  // Rule A1 — hard seniority blocklist. Only an explicit internship with no
  // unambiguous senior token survives.
  if (SENIOR_RE.test(t)) {
    if (!(explicitIntern && !SENIORITY_HARD_RE.test(t))) return null;
  }

  // Rule A2 — recruiter/HR meta-role guard. Full-time recruiter titles are
  // rejected unless the title is itself explicitly an internship.
  if (RECRUITER_RE.test(t) && !explicitIntern) return null;

  // Rule B — require a positive early-career pattern.
  if (INTERNSHIP_TITLE_RE.test(t)) {
    return /\bco-?op\b/i.test(t) ? 'Co-op' : 'Internship';
  }
  if (NEWGRAD_TITLE_RE.test(t)) {
    return 'Entry-level / New-grad';
  }
  return null;
}

/** Boolean form of the strict title gate. */
export function isEarlyCareerTitle(title: string | null | undefined): boolean {
  return matchEarlyCareerType(title) !== null;
}

/**
 * Decide whether a normalized posting is an early-career opportunity.
 *
 * The decision is made STRICTLY on the title via isEarlyCareerTitle. We no
 * longer trust `employmentTypeRaw` or body text on its own, because providers
 * like Workday match "intern" inside descriptions ("internal", "international")
 * and surface senior roles. employmentTypeRaw is only consulted to disambiguate
 * a title that is already an accepted early-career title.
 */
export function isEarlyCareer(p: Pick<NormalizedPosting, 'title' | 'employmentTypeRaw'>): boolean {
  return isEarlyCareerTitle(p.title);
}

/**
 * Classify a role into the fixed `field_type` enum from its title (+ optional
 * category text). Ordered most-specific first; falls back to a company's own
 * field, then 'Other'. This replaces the previous "everything is Other" behavior.
 */
const FIELD_RULES: Array<{ field: FieldType; re: RegExp }> = [
  // Finance first — "financial analyst" should beat the generic "analyst"/"data" rules.
  {
    field: 'Finance',
    re: /\b(financ\w*|accounting|accountant|audit|tax|treasury|investment|equity research|trading|trader|quant\w*|actuar\w*|underwrit\w*|fp&a|banking|fintech)\b/i,
  },
  // Specific Business phrases that would otherwise be grabbed by the generic
  // Technology "analyst" keyword (e.g. "Business Analyst" is a Business role,
  // while "Data Analyst" stays Technology below).
  {
    field: 'Business',
    re: /\b(business analyst|business operations|business development|bizops|sales operations|revenue operations|program management|project management|product management|product manager)\b/i,
  },
  {
    field: 'Healthcare',
    re: /\b(health\w*|clinical|medical|biotech|pharma\w*|biolog\w*|life science|genomics|patient|nurs\w*|care delivery|epidemiolog\w*)\b/i,
  },
  {
    field: 'Marketing',
    re: /\b(marketing|growth|brand|content|social media|seo|communications|pr\b|public relations|demand gen|lifecycle|community)\b/i,
  },
  {
    field: 'Engineering',
    re: /\b(mechanical|electrical|hardware|firmware|robotics|aerospace|manufactur\w*|civil|structural|materials|systems engineer|test engineer|quality engineer|controls|propulsion|avionics)\b/i,
  },
  {
    field: 'Technology',
    re: /\b(software|engineer\w*|developer|programming|data|analytics|analyst|machine learning|ml\b|ai\b|artificial intelligence|security|infra\w*|devops|cloud|backend|back-end|frontend|front-end|full[- ]?stack|mobile|ios|android|web|platform|sre|qa\b|technical|it\b|information technology|database|sde)\b/i,
  },
  {
    field: 'Business',
    re: /\b(business|operations|ops\b|strategy|consult\w*|product manage|product\b|project manage|program manage|sales|account executive|account manager|customer success|partnerships|people|recruit\w*|hr\b|human resources|legal|supply chain|logistics|procurement)\b/i,
  },
];

export function classifyField(title: string, companyFallback?: FieldType, extra?: string): FieldType {
  const text = `${title} ${extra ?? ''}`;
  for (const rule of FIELD_RULES) {
    if (rule.re.test(text)) return rule.field;
  }
  return companyFallback && companyFallback !== 'Other' ? companyFallback : 'Other';
}

/**
 * Infer the opportunity type. Prefer the strict title match (so recruiter and
 * senior titles never slip through here either); fall back to the title-only
 * co-op/intern heuristic for already-accepted roles. Never silently defaults a
 * non-intern title to 'Internship'.
 */
export function classifyOpportunityType(
  title: string,
  employmentTypeRaw?: string,
): OpportunityType {
  const matched = matchEarlyCareerType(title);
  if (matched) return matched;
  // Title didn't match (should be rare post-filter). Use employmentType as a
  // last hint, else default to Internship for the legacy callers.
  const raw = (employmentTypeRaw ?? '').toLowerCase();
  if (/\bco-?op\b/.test(raw)) return 'Co-op';
  if (/\b(new ?grad|entry[- ]?level)\b/.test(raw)) return 'Entry-level / New-grad';
  return 'Internship';
}

/**
 * Infer accepted degree levels. Internships default to Undergraduate; new-grad
 * roles to New Grad; explicit graduate/PhD/MBA signals add Graduate. Returns a
 * non-empty array so cards never render the vague "Any level".
 */
export function classifyDegreeLevels(
  title: string,
  opportunityType: OpportunityType,
  descriptionHtml?: string,
): DegreeLevel[] {
  const text = `${title} ${descriptionHtml ?? ''}`.toLowerCase();
  const levels = new Set<DegreeLevel>();

  if (/\b(phd|ph\.d|master'?s|graduate student|mba|m\.s\.|ms\b|grad program)\b/.test(text)) {
    levels.add('Graduate');
  }
  if (opportunityType === 'Entry-level / New-grad' || /\bnew ?grad\b/.test(text)) {
    levels.add('New Grad');
  }
  // Internships and co-ops are undergraduate by default (unless explicitly grad-only).
  if (opportunityType === 'Internship' || opportunityType === 'Co-op') {
    if (!/\b(phd|master'?s only|graduate only)\b/.test(text)) levels.add('Undergraduate');
  }
  // Guarantee a sensible default.
  if (levels.size === 0) {
    levels.add(opportunityType === 'Entry-level / New-grad' ? 'New Grad' : 'Undergraduate');
  }
  return Array.from(levels);
}
