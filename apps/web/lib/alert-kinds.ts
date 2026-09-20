/**
 * What each kind of alert is called on screen.
 *
 * Its own module so a test can import it without pulling in a React page, and
 * so the answer lives somewhere a person adding an alert kind might actually
 * look. `tests/monitoring.test.ts` asks the database for every `alert_kind` it
 * knows and insists each one has a name here: three kinds had quietly been
 * added to the enum without one, and the inbox's fallback meant they reached
 * customers as `rubric_superseded`. The sort of thing that is obvious the
 * moment somebody asks, and that nobody ever asks.
 */
export const KIND_LABEL: Record<string, string> = {
  assessment_completed: 'Assessment finished',
  drift_detected: 'Change since last time',
  material_regression: 'Material change',
  badge_issued: 'Badge issued',
  badge_suspended: 'Badge suspended',
  badge_expiring: 'Badge expiring',
  rubric_superseded: 'Standard has moved on',
  application_unreachable: 'Not responding',
  application_recovered: 'Responding again',
  monitoring_blocked: 'Check not made',
  subscription_problem: 'Subscription',
};
