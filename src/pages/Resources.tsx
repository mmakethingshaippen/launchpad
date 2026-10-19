import { Helmet } from 'react-helmet-async';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Clock } from 'lucide-react';
import { GUIDES, getGuide } from '../data/resources';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';

export function Resources() {
  return (
    <div>
      <Helmet>
        <title>Career Resources — Launchpad</title>
        <meta name="description" content="Actionable guides for internship resumes, interviews, finding unlisted roles, and evaluating offers." />
      </Helmet>
      <h1 className="mb-2 text-2xl font-bold text-navy">Career Resources</h1>
      <p className="mb-6 text-slate-500">Practical, no-fluff guides to help you land and choose the right opportunity.</p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {GUIDES.map((g) => (
          <Card key={g.slug} className="flex h-full flex-col">
            <div className="flex items-center gap-2 text-cyan">
              <BookOpen className="h-5 w-5" aria-hidden="true" />
              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                <Clock className="h-3 w-3" aria-hidden="true" /> {g.readMinutes} min read
              </span>
            </div>
            <h2 className="mt-2 text-lg font-semibold text-navy">
              <Link to={`/resources/${g.slug}`} className="hover:text-cyan">
                {g.title}
              </Link>
            </h2>
            <p className="mt-1 flex-1 text-sm text-slate-600">{g.summary}</p>
            <Link to={`/resources/${g.slug}`} className="mt-4">
              <Button variant="outline" size="sm">
                Read guide
              </Button>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ResourceGuide() {
  const { slug = '' } = useParams();
  const guide = getGuide(slug);

  if (!guide)
    return (
      <EmptyState
        title="Guide not found"
        action={
          <Link to="/resources">
            <Button variant="outline">All resources</Button>
          </Link>
        }
      />
    );

  return (
    <article className="mx-auto max-w-2xl">
      <Helmet>
        <title>{`${guide.title} — Launchpad`}</title>
        <meta name="description" content={guide.summary} />
        <meta property="og:title" content={guide.title} />
      </Helmet>

      <Link to="/resources" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All resources
      </Link>

      <header className="mb-6">
        <h1 className="text-3xl font-bold text-navy">{guide.title}</h1>
        <p className="mt-2 text-slate-600">{guide.summary}</p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-400">
          <Clock className="h-3 w-3" aria-hidden="true" /> {guide.readMinutes} min read
        </p>
      </header>

      <div className="space-y-8">
        {guide.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="mb-2 text-xl font-semibold text-navy">{section.heading}</h2>
            {section.body.map((p, i) => (
              <p key={i} className="mb-2 text-slate-700">
                {p}
              </p>
            ))}
            {section.bullets && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
                {section.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="mt-10 rounded-xl bg-navy p-6 text-center text-white">
        <p className="font-semibold">Ready to put this into practice?</p>
        <Link to="/browse" className="mt-3 inline-block">
          <Button>Browse live opportunities</Button>
        </Link>
      </div>
    </article>
  );
}
