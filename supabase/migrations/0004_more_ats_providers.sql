-- ============================================================================
-- Launchpad — 0004_more_ats_providers.sql
-- Extend the ats_provider enum with SmartRecruiters and Workable so the
-- expanded ingestion pipeline can store companies on those public JSON feeds.
-- (Postgres enum values cannot be added inside a transaction block with
-- IF NOT EXISTS prior to PG12; Supabase runs PG14+, so this is safe.)
-- ============================================================================

alter type ats_provider add value if not exists 'smartrecruiters';
alter type ats_provider add value if not exists 'workable';
alter type ats_provider add value if not exists 'workday';
