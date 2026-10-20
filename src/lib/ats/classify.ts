import type { NormalizedPosting } from './types';
import type { FieldType, DegreeLevel, OpportunityType } from '../adapter/types';

// Req 18.1 — early-career inclusion.
export const EARLY_CAREER_RE =
  /\b(intern|internship|co-?op|fellow|apprentice|new ?grad|early career|university grad|campus|entry[ -]?level)\b/i;

// Req 18.2 — senior/mid-level exclusion (exclusion wins).
export const SENIOR_RE = /\b(senior|staff|principal|director|manager|lead|sr\.?)\b/i;

/**
 * Decide whether a normalized posting is an early-career opportunity.
 * The senior-exclusion check runs first so "Senior Intern" style titles drop out.
 */
export function isEarlyCareer(p: Pick<NormalizedPosting, 'title' | 'employmentTypeRaw'>): boolean {
  if (SENIOR_RE.test(p.title)) return false;
  if (p.employmentTypeRaw && p.employmentTypeRaw.trim().toLowerCase() === 'intern') return true;
  return EARLY_CAREER_RE.test(p.title) || EARLY_CAREER_RE.test(p.employmentTypeRaw ?? '');
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
 * Infer the opportunity type from the title / employment type.
 */
export function classifyOpportunityType(
  title: string,
  employmentTypeRaw?: string,
): OpportunityType {
  const text = `${title} ${employmentTypeRaw ?? ''}`.toLowerCase();
  if (/\bco-?op\b/.test(text)) return 'Co-op';
  if (/\b(new ?grad|entry[- ]?level|university grad|campus|associate)\b/.test(text)) {
    // "intern" still wins if both appear (e.g. "New Grad Internship").
    if (/\bintern/.test(text)) return 'Internship';
    return 'Entry-level / New-grad';
  }
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
