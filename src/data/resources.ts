export interface GuideSection {
  heading: string;
  body: string[];
  bullets?: string[];
}

export interface Guide {
  slug: string;
  title: string;
  summary: string;
  readMinutes: number;
  sections: GuideSection[];
}

export const GUIDES: Guide[] = [
  {
    slug: 'internship-resume-tips',
    title: 'Internship Resume Tips',
    summary: 'Build a one-page resume that gets past screeners and lands interviews, even with limited experience.',
    readMinutes: 6,
    sections: [
      {
        heading: 'Lead with impact, not duties',
        body: [
          'Recruiters skim resumes in seconds. Every bullet should show a result, not just a responsibility.',
          'Use the pattern: action verb + what you did + measurable outcome.',
        ],
        bullets: [
          'Weak: "Responsible for a class project website."',
          'Strong: "Built a React site for a 30-person class project, cutting sign-up time by 40%."',
          'Quantify whenever you can: users, hours saved, percent improvement, dollars.',
        ],
      },
      {
        heading: 'Keep it to one page',
        body: [
          'For internships and new-grad roles, one page is the expectation. Trim older high-school content and anything not relevant to the role.',
        ],
        bullets: [
          'Order sections by relevance: Education, Projects/Experience, Skills.',
          'List relevant coursework only when it maps to the role.',
          'Put your strongest, most relevant bullet first in each entry.',
        ],
      },
      {
        heading: 'Make it ATS-friendly',
        body: [
          'Most employers screen resumes through an Applicant Tracking System. Simple formatting parses cleanly.',
        ],
        bullets: [
          'Use a standard, single-column layout and common section headings.',
          'Mirror the language in the job description for key skills.',
          'Export as PDF unless the posting requests another format.',
        ],
      },
      {
        heading: 'Projects count as experience',
        body: [
          'No internship yet? Personal, class, hackathon, and open-source projects demonstrate real skills. Treat them like jobs: what you built, the stack, and the outcome.',
        ],
      },
    ],
  },
  {
    slug: 'interview-preparation',
    title: 'Internship Interview Preparation',
    summary: 'A practical playbook for behavioral and technical interviews, from research to follow-up.',
    readMinutes: 7,
    sections: [
      {
        heading: 'Research before you prep answers',
        body: [
          'Understand the company\u2019s product, recent news, and the team you\u2019d join. Interviewers notice candidates who clearly know what the company does.',
        ],
        bullets: [
          'Read the product/docs and try the product if you can.',
          'Prepare two or three specific reasons you want this role.',
          'Write down thoughtful questions to ask them.',
        ],
      },
      {
        heading: 'Structure behavioral answers with STAR',
        body: [
          'Situation, Task, Action, Result. Keep it concise and center your own contribution.',
        ],
        bullets: [
          'Prepare five or six stories covering teamwork, conflict, failure, and initiative.',
          'Lead with the result when it is strong.',
          'Practice out loud; aim for 90 seconds per answer.',
        ],
      },
      {
        heading: 'Technical interviews: think out loud',
        body: [
          'For coding or case questions, communication matters as much as the answer. Narrate your approach, state assumptions, and check edge cases.',
        ],
        bullets: [
          'Restate the problem and confirm constraints before coding.',
          'Start with a brute-force idea, then optimize.',
          'Test your solution with a small example.',
        ],
      },
      {
        heading: 'Follow up',
        body: [
          'Send a short, specific thank-you within 24 hours referencing something concrete from the conversation.',
        ],
      },
    ],
  },
  {
    slug: 'finding-unlisted-internships',
    title: 'Finding Unlisted Internships',
    summary: 'How to discover opportunities at startups and during off-cycle Fall, Winter, and Spring terms that never hit the big job boards.',
    readMinutes: 8,
    sections: [
      {
        heading: 'Not every opportunity is posted',
        body: [
          'Many startups hire interns without a formal program. Roles appear briefly, fill through referrals, or exist only as "we\u2019d make room for the right person."',
          'That is exactly why Launchpad pulls directly from live employer feeds and surfaces smaller companies alongside big names.',
        ],
      },
      {
        heading: 'Target startups directly',
        body: [
          'Early-stage companies move fast and value initiative. A concise, specific outreach note can create a role that was never advertised.',
        ],
        bullets: [
          'Filter Launchpad to Startups and browse by your field and stage.',
          'Visit a company\u2019s careers page even when it shows zero open roles, then reach out.',
          'Reference something specific about their product in your message.',
        ],
      },
      {
        heading: 'Work the off-cycle terms',
        body: [
          'Summer is the most crowded season. Fall, Winter, and Spring (and co-op terms) have far less competition and plenty of real openings.',
        ],
        bullets: [
          'Use the Season filter for Fall, Winter, and Spring to find off-cycle roles.',
          'Co-ops often span two terms (for example, Fall/Winter) and are easier to land.',
          'Apply early; smaller cohorts fill quickly.',
        ],
      },
      {
        heading: 'Build a referral surface',
        body: [
          'Professors, alumni, past teammates, and student clubs are the fastest path to unlisted roles. Make it easy for people to help by being specific about what you want.',
        ],
      },
    ],
  },
  {
    slug: 'evaluating-an-offer',
    title: 'Evaluating an Internship Offer',
    summary: 'Look past the headline pay. A framework for comparing offers on growth, mentorship, and fit.',
    readMinutes: 6,
    sections: [
      {
        heading: 'Compensation in context',
        body: [
          'Compare total value, not just the hourly or monthly rate: housing stipends, relocation, and cost of living can change the picture significantly.',
        ],
        bullets: [
          'Normalize pay to a common period (for example, monthly).',
          'Factor in housing and commute costs for onsite roles.',
          'Unpaid or low-paid roles can still be worth it for exceptional learning \u2014 weigh it deliberately.',
        ],
      },
      {
        heading: 'Growth and mentorship',
        body: [
          'The best internship is one where you learn quickly and have someone invested in your growth. Ask how interns are supported.',
        ],
        bullets: [
          'Will you have a dedicated manager or mentor?',
          'What did past interns go on to do? Any return offers?',
          'Will you own real, shippable work?',
        ],
      },
      {
        heading: 'Team, scope, and conversion',
        body: [
          'Understand the actual work, the team you\u2019ll join, and whether a full-time offer is possible afterward.',
        ],
        bullets: [
          'Ask for a sketch of a typical week.',
          'Clarify return-offer or conversion rates if that matters to you.',
          'Trust your read on the people \u2014 you\u2019ll work with them daily.',
        ],
      },
      {
        heading: 'Negotiate respectfully',
        body: [
          'It is usually fine to ask whether there is flexibility, especially with competing offers. Be polite, specific, and grateful regardless of the answer.',
        ],
      },
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
