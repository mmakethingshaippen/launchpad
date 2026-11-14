/**
 * Server-side only. Keyset paging for verification loaders.
 *
 * A short page is NOT the last page: PostgREST max-rows (or any project-level
 * cap) can return fewer rows than requested. Only an empty page ends the scan.
 * A page whose last id did not advance means the filter or cursor is not being
 * honoured, and the scan stops with a reason instead of looping forever.
 */
export interface PageResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

export interface PagedLoad<T> {
  rows: T[];
  pages: number;
  /** True only when an empty page was reached. */
  complete: boolean;
  /** Why the scan ended. Anything but an empty final page means rows may be missing. */
  stopReason: string;
}

export async function loadAllPages<T extends { id: string }>(
  fetchPage: (after: string) => PromiseLike<PageResult>,
): Promise<PagedLoad<T>> {
  const out: PagedLoad<T> = { rows: [], pages: 0, complete: false, stopReason: 'not started' };
  let after = '';
  for (;;) {
    const { data, error } = await fetchPage(after);
    if (error) {
      out.stopReason = `database error after ${out.pages} page(s): ${error.message}`;
      return out;
    }
    const page = (data ?? []) as T[];
    if (page.length === 0) {
      out.complete = true;
      out.stopReason = 'empty page reached';
      return out;
    }
    const last = String(page[page.length - 1].id);
    if (last === after) {
      out.stopReason = `no cursor progress at page ${out.pages + 1}`;
      return out;
    }
    out.pages += 1;
    out.rows.push(...page);
    after = last;
  }
}