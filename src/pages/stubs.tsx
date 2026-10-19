import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';

export function NotFound() {
  return (
    <div>
      <Helmet>
        <title>Not found — Launchpad</title>
      </Helmet>
      <EmptyState
        title="Page not found"
        description="The page you're looking for doesn't exist."
        action={
          <Link to="/">
            <Button variant="outline">Go home</Button>
          </Link>
        }
      />
    </div>
  );
}
