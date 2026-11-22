import { Helmet } from 'react-helmet-async';
import { AboutContent, ABOUT_TITLE, ABOUT_DESCRIPTION } from '../components/about/AboutContent';

export function About() {
  return <>
    <Helmet>
      <title>{ABOUT_TITLE}</title>
      <meta name="description" content={ABOUT_DESCRIPTION} />
    </Helmet>
    <AboutContent />
  </>;
}
