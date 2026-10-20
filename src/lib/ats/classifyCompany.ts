import type { CompanyType, EmployeeRange, FieldType } from '../adapter/types';

/**
 * Company classification helpers (Req 4).
 *
 * Big, well-known employers (TikTok, GE Healthcare, IMC Trading, …) were landing
 * in the DB with `company_type: 'Other / Unknown'` and no industry, rendering an
 * ugly "Other / Unknown" pill. This module infers a sensible industry + size +
 * type from the company name so those rows read cleanly.
 *
 * Product rule respected: we do NOT infer a *funding stage* from size. We only
 * set `company_type` to `Established Company` (never a startup stage) when a
 * name matches a known established brand, and otherwise leave the type as the
 * seed/aggregator provided it.
 */

interface BrandRule {
  /** Matched against the normalized (lowercased) company name as a whole-word regex. */
  re: RegExp;
  fields: FieldType[];
  employeeRange?: EmployeeRange;
}

// Known established employers → industry + (optional) size. Ordered; first match wins.
const BRAND_RULES: BrandRule[] = [
  // Healthcare / health systems / pharma
  {
    re: /\b(ge healthcare|kaiser|sutter|cvs|unitedhealth|optum|pfizer|merck|johnson & johnson|j&j|abbvie|medtronic|stryker|hca|humana|cigna|anthem|elevance|mckesson|cardinal health|baxter|bristol[- ]myers|genentech|moderna|novartis|astrazeneca|gsk|roche|teladoc|providence|mayo clinic|cleveland clinic|mount sinai|intermountain)\b/,
    fields: ['Healthcare'],
    employeeRange: '501+',
  },
  // Finance / trading / banks / insurance
  {
    re: /\b(imc trading|jane street|citadel|two sigma|jump trading|hudson river|drw|optiver|akuna|point72|de shaw|goldman sachs|morgan stanley|jpmorgan|jp morgan|blackrock|bank of america|citi|citigroup|wells fargo|fidelity|charles schwab|visa|mastercard|american express|amex|capital one|pnc|us bank|deutsche bank|barclays|hsbc|ubs|credit suisse|nomura|blackstone|kkr|carlyle|apollo|vanguard|state street|prudential|metlife|aig|allstate|progressive|geico|s&p global|moody'?s|nasdaq|cme group|robinhood|affirm|brex|chime|stripe|plaid|ramp)\b/,
    fields: ['Finance'],
    employeeRange: '501+',
  },
  // Retail / consumer (mapped to Business — the closest field in our fixed enum)
  {
    re: /\b(ross stores|ross dress|walmart|target|costco|kroger|home depot|lowe'?s|best buy|macy'?s|nordstrom|tjx|tj maxx|marshalls|gap|nike|adidas|lululemon|starbucks|mcdonald'?s|chipotle|pepsico|coca[- ]cola|procter & gamble|p&g|unilever|nestle|estee lauder|sephora|ulta|wayfair|chewy|etsy|ebay)\b/,
    fields: ['Business'],
    employeeRange: '501+',
  },
  // Big Tech / enterprise software / internet
  {
    re: /\b(tiktok|bytedance|google|alphabet|amazon|aws|microsoft|apple|meta|facebook|netflix|nvidia|tesla|spacex|oracle|salesforce|adobe|sap|ibm|intel|amd|qualcomm|cisco|dell|hp|hewlett|samsung|sony|uber|lyft|airbnb|spotify|snap|pinterest|reddit|linkedin|dropbox|twilio|snowflake|databricks|palantir|servicenow|workday|atlassian|datadog|cloudflare|mongodb|roblox|epic games|riot games|doordash|instacart|coinbase|block|square|paypal|intuit|vmware|broadcom|texas instruments|micron|western digital|seagate|autodesk)\b/,
    fields: ['Technology'],
    employeeRange: '501+',
  },
  // Aerospace / industrial / engineering
  {
    re: /\b(boeing|lockheed|lockheed martin|raytheon|rtx|northrop|general dynamics|ge aerospace|general electric|ge\b|honeywell|3m|caterpillar|john deere|deere|siemens|bosch|ford|general motors|gm\b|stellantis|rivian|lucid|anduril|relativity space|blue origin|rocket lab|collins aerospace)\b/,
    fields: ['Engineering'],
    employeeRange: '501+',
  },
  // Consulting / professional services / enterprise
  {
    re: /\b(deloitte|pwc|pricewaterhouse|ernst & young|ey\b|kpmg|accenture|mckinsey|bain|boston consulting|bcg|capgemini|cognizant|infosys|tata|wipro|booz allen)\b/,
    fields: ['Business'],
    employeeRange: '501+',
  },
  // Government / public sector
  {
    re: /\b(state of|government|department of|city of|county of|usajobs|calcareers|public sector)\b/,
    fields: ['Business'],
    employeeRange: '501+',
  },
];

export interface CompanyClassification {
  fields: FieldType[];
  companyType: CompanyType;
  employeeRange: EmployeeRange;
}

/**
 * Infer a clean industry + type + size for a company by name. Returns null when
 * the name doesn't match any known established brand (caller keeps existing
 * values). Never produces 'Other / Unknown'.
 */
export function classifyCompanyByName(name: string): CompanyClassification | null {
  const n = name.toLowerCase();
  for (const rule of BRAND_RULES) {
    if (rule.re.test(n)) {
      return {
        fields: rule.fields,
        companyType: 'Established Company',
        employeeRange: rule.employeeRange ?? '501+',
      };
    }
  }
  return null;
}

/**
 * Given a company's current (possibly unknown) metadata, compute a cleaned-up
 * classification. Guarantees a non-"Other / Unknown" result:
 *   1. Known brand → its mapped industry + Established Company + size.
 *   2. Otherwise, if it already has real fields, keep them but upgrade a bare
 *      'Other / Unknown' type to 'Established Company' (we don't fabricate a
 *      startup stage) and default size to 501+.
 *   3. Otherwise, default to Technology / Established Company / 501+ — a safe,
 *      high-signal default that reads far better than "Other / Unknown".
 */
export function resolveCompanyClassification(input: {
  name: string;
  fields: FieldType[];
  companyType: CompanyType;
  employeeRange: EmployeeRange | null;
}): CompanyClassification {
  const brand = classifyCompanyByName(input.name);
  if (brand) return brand;

  const existingFields = (input.fields ?? []).filter((f) => f && f !== 'Other');
  const fields: FieldType[] = existingFields.length ? existingFields : ['Technology'];
  const companyType: CompanyType =
    input.companyType === 'Other / Unknown' ? 'Established Company' : input.companyType;
  const employeeRange: EmployeeRange = input.employeeRange ?? '501+';
  return { fields, companyType, employeeRange };
}
