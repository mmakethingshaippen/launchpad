import { z } from 'zod';
import {
  FIELDS,
  DEGREE_LEVELS,
  SEASONS,
  OPPORTUNITY_TYPES,
  WORK_ARRANGEMENTS,
  WORK_SCHEDULES,
  COMPENSATION_STATUSES,
} from './adapter/types';

const url = z.string().url('Enter a valid URL');
const optionalUrl = z.string().url('Enter a valid URL').or(z.literal('')).optional();

// Shared honeypot: must be empty. A filled value signals a bot (Req 14.5).
export const honeypot = z.string().max(0, 'bot').optional();

// ── Form A: Suggest a Company ──
export const companyFormSchema = z.object({
  name: z.string().min(2, 'Company name is required'),
  websiteUrl: url,
  careersUrl: url,
  description: z.string().min(10, 'Add a short description (10+ characters)'),
  fields: z.array(z.enum(FIELDS as unknown as [string, ...string[]])).min(1, 'Choose at least one field'),
  companyType: z.enum(['Startup', 'Established Company', 'Other / Unknown']),
  degreeLevels: z.array(z.enum(DEGREE_LEVELS as unknown as [string, ...string[]])).min(1, 'Choose eligibility'),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  atsProvider: z.enum(['greenhouse', 'lever', 'ashby', 'none']).optional(),
  atsBoardToken: z.string().optional(),
  startupStage: z.string().optional(),
  employeeCountRange: z.string().optional(),
  foundingYear: z
    .union([z.coerce.number().int().min(1800).max(new Date().getFullYear() + 1), z.literal('')])
    .optional(),
  sourceUrl: optionalUrl,
  website_hp: honeypot, // honeypot
});

export type CompanyFormValues = z.infer<typeof companyFormSchema>;

// ── Form B: Post a Role ──
export const roleFormSchema = z.object({
  companyId: z.string().optional(),
  companyName: z.string().optional(),
  title: z.string().min(3, 'Job title is required'),
  field: z.enum(FIELDS as unknown as [string, ...string[]]),
  seasons: z.array(z.enum(SEASONS as unknown as [string, ...string[]])).min(1, 'Choose at least one term'),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  workArrangement: z.enum(WORK_ARRANGEMENTS as unknown as [string, ...string[]]),
  degreeLevels: z.array(z.enum(DEGREE_LEVELS as unknown as [string, ...string[]])).min(1, 'Choose degree levels'),
  opportunityType: z.enum(OPPORTUNITY_TYPES as unknown as [string, ...string[]]),
  workSchedule: z.enum(WORK_SCHEDULES as unknown as [string, ...string[]]),
  compensationStatus: z.enum(COMPENSATION_STATUSES as unknown as [string, ...string[]]),
  payMin: z.union([z.coerce.number().min(0), z.literal('')]).optional(),
  payMax: z.union([z.coerce.number().min(0), z.literal('')]).optional(),
  payCurrency: z.string().optional(),
  payPeriod: z.string().optional(),
  duration: z.string().optional(),
  applicationDeadline: z.string().optional(),
  applyUrl: url,
  description: z.string().min(20, 'Add a description (20+ characters)'),
  sourceUrl: optionalUrl,
  role_hp: honeypot, // honeypot
}).refine((v) => v.companyId || v.companyName, {
  message: 'Select a company or provide a new company name',
  path: ['companyName'],
});

export type RoleFormValues = z.infer<typeof roleFormSchema>;
