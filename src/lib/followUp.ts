export type FollowUpState = 'none' | 'overdue' | 'today' | 'upcoming';

/** Classify a follow-up date relative to today (local date). */
export function followUpState(date: string | null, now: Date = new Date()): FollowUpState {
  if (!date) return 'none';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(date).getTime();
  const dueDay = new Date(new Date(date).getFullYear(), new Date(date).getMonth(), new Date(date).getDate()).getTime();
  if (Number.isNaN(due)) return 'none';
  if (dueDay < today) return 'overdue';
  if (dueDay === today) return 'today';
  return 'upcoming';
}
