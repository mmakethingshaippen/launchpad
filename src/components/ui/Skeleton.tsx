import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-slate-200/80', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export function RoleCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg flex-shrink-0" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-5 w-5 rounded" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>

      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>

      <div className="mt-auto flex items-center justify-between pt-4">
        <Skeleton className="h-3 w-24" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-16 rounded-md" />
          <Skeleton className="h-7 w-14 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function RoleDetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 inline-flex items-center gap-1">
        <Skeleton className="h-4 w-28" />
      </div>

      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="mt-2 h-4 w-1/3" />

        <div className="mt-4 flex flex-wrap gap-1.5">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Skeleton className="h-10 w-48 rounded-lg" />
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
      </header>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </section>
    </div>
  );
}

export function CompanyProfileSkeleton() {
  return (
    <div>
      <div className="mb-4 inline-flex items-center gap-1">
        <Skeleton className="h-4 w-32" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <Skeleton className="h-16 w-16 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <div className="flex gap-2 pt-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <Skeleton className="h-6 w-48 mb-4" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <RoleCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
