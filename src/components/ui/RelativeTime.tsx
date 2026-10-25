export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Not yet verified';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Not yet verified';
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Verified live" only for a check within the last day. Older checks stay visible, but do not claim the job was just confirmed. */
export function verificationLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Not yet verified';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Not yet verified';
  const age = Math.max(0, now - then);
  const when = formatRelativeTime(iso, now);
  if (age < DAY_MS) return `Verified live ${when}`;
  if (age < 7 * DAY_MS) return `Checked ${when}`;
  return `Not rechecked · ${when}`;
}

export function RelativeTime({ iso }: { iso: string | null | undefined }) {
  return <span>{verificationLabel(iso)}</span>;
}