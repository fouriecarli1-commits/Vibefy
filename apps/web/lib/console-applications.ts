import { readAsUser } from './sql.ts';
import { whatComesNext, type NextStep } from './what-comes-next.ts';

/**
 * The customer's own applications, and the step each one is on.
 *
 * One query, read as the caller, used by the console's front door and by the
 * assistant that answers questions about it. Two readings of the same facts is
 * how the page and the chat beside it come to say different things about the
 * same application, and that difference is the one a customer would report.
 */
export interface ConsoleApplicationRow {
  readonly id: string;
  readonly name: string;
  readonly primary_url: string;
  readonly screening_status: string;
  readonly authorisation: string | null;
  readonly authorised: boolean;
  readonly open_request: string | null;
  readonly latest_assessment: string | null;
  readonly latest_assessment_id: string | null;
  readonly latest_score: string | null;
}

export interface ConsoleApplication extends ConsoleApplicationRow {
  readonly next: NextStep;
}

export async function readConsoleApplications(userId: string): Promise<ConsoleApplication[]> {
  const rows = await readAsUser(userId, async (client) => {
    const { rows } = await client.query<ConsoleApplicationRow>(
      `select a.id, a.name, a.primary_url, a.screening_status::text as screening_status,
              (select c.status::text from public.current_authorisation(a.id) c) as authorisation,
              public.app_is_authorised_for_testing(a.id) as authorised,
              (select r.status::text from public.assessment_requests r
                where r.app_id = a.id and r.status in ('queued', 'claimed')
                order by r.created_at desc limit 1) as open_request,
              (select s.status::text from public.assessments s
                where s.app_id = a.id order by s.created_at desc limit 1) as latest_assessment,
              (select s.id::text from public.assessments s
                where s.app_id = a.id order by s.created_at desc limit 1) as latest_assessment_id,
              (select s.overall_score::text from public.assessments s
                where s.app_id = a.id and s.status in ('approved', 'published')
                order by s.created_at desc limit 1) as latest_score
         from public.apps a
        where a.archived_at is null
        order by a.created_at desc`,
    );
    return rows;
  });

  return rows.map((row) => ({
    ...row,
    next: whatComesNext({
      appId: row.id,
      screening: row.screening_status,
      authorisation: row.authorisation,
      authorisedForTesting: row.authorised === true,
      openRequest: row.open_request,
      latestAssessment: row.latest_assessment,
      latestAssessmentId: row.latest_assessment_id,
    }),
  }));
}
