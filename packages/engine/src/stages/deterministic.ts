/**
 * Deterministic checks.
 *
 * No model runs in this stage. Every finding here is produced by code that would
 * give the same answer twice, which is what makes it cheap to run continuously
 * and impossible to argue with. The model-driven stages build on top of it.
 *
 * Each check names the rubric rule it evidences, so a score can be traced back
 * from the published number to the exact HTTP exchange that moved it.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { ScopedHttp, type ScopedResponse } from '../runtime/http.ts';
import { BrowserSession, MOBILE_VIEWPORT } from '../runtime/browser.ts';
import type { RawFinding, Stage, StageContext, StageResult } from './types.ts';

/** Paths that should never be reachable, and what it means when they are. */
const EXPOSED_PATHS: readonly { path: string; title: string; severity: RawFinding['severity'] }[] =
  [
    { path: '/.env', title: 'Environment file is publicly readable', severity: 'critical' },
    {
      path: '/.env.local',
      title: 'Local environment file is publicly readable',
      severity: 'critical',
    },
    { path: '/.git/config', title: 'Git configuration is publicly readable', severity: 'critical' },
    { path: '/.git/HEAD', title: 'Git repository is exposed', severity: 'critical' },
    { path: '/config.json', title: 'Configuration file is publicly readable', severity: 'high' },
    {
      path: '/.aws/credentials',
      title: 'Cloud credentials path is reachable',
      severity: 'critical',
    },
    {
      path: '/server-status',
      title: 'Server status page is publicly readable',
      severity: 'medium',
    },
  ];

const ADMIN_PATHS = ['/admin', '/administrator', '/dashboard/admin', '/wp-admin'] as const;

export const deterministicChecksStage: Stage = {
  id: 'deterministic_checks',

  appliesTo(context) {
    return Boolean(context.target.primaryUrl);
  },

  async run(context): Promise<StageResult> {
    const url = context.target.primaryUrl;
    if (!url) {
      return {
        stage: 'deterministic_checks',
        status: 'skipped',
        findings: [],
        notes: ['No hosted URL was submitted, so there was nothing to check over HTTP.'],
      };
    }

    const startedAt = Date.now();
    const http = new ScopedHttp(context.guard, context.evidence);
    const findings: RawFinding[] = [];
    const notes: string[] = [];

    let root: ScopedResponse;
    try {
      root = await http.request(url, { summary: 'Initial page load' });
    } catch (error) {
      return {
        stage: 'deterministic_checks',
        status: 'failed',
        findings: [],
        notes: [`The application did not respond at ${url}.`],
        error: error instanceof Error ? error.message : String(error),
      };
    }

    findings.push(...transportChecks(url, root));
    findings.push(...headerChecks(root));
    findings.push(...cookieChecks(root));
    findings.push(...corsChecks(root));
    findings.push(...bodyChecks(root));

    for (const candidate of EXPOSED_PATHS) {
      const response = await http.probe(url, candidate.path);
      if (response && response.status === 200 && response.body.trim().length > 0) {
        findings.push({
          ruleId: 'SEC-08',
          dimension: 'security_posture',
          severity: candidate.severity,
          confidence: 'high',
          title: candidate.title,
          description: `A request to ${candidate.path} returned HTTP 200 with a non-empty body. Anything reachable at this path is readable by anyone on the internet, including whatever it contains.`,
          remediation: `Stop serving ${candidate.path}. Exclude dotfiles and configuration from the deployed bundle, and confirm the host does not serve them by default.`,
          evidenceIds: [response.evidenceId],
        });
      }
    }

    for (const adminPath of ADMIN_PATHS) {
      const response = await http.probe(url, adminPath);
      if (
        response &&
        response.status === 200 &&
        !/sign[- ]?in|log[- ]?in|password/i.test(response.body)
      ) {
        findings.push({
          ruleId: 'SEC-05',
          dimension: 'security_posture',
          severity: 'high',
          confidence: 'medium',
          title: `Administrative route ${adminPath} served content without prompting for authentication`,
          description: `An unauthenticated request to ${adminPath} returned HTTP 200 and the response contained no sign-in prompt. This is consistent with authorisation being enforced only after the page loads, in the browser, which does not protect the data the page fetches.`,
          remediation: `Enforce authorisation on the server for ${adminPath} and for every endpoint it calls. Return 401 or 404 to an unauthenticated request rather than rendering the page and hiding it.`,
          evidenceIds: [response.evidenceId],
        });
      }
    }

    const robots = await http.probe(url, '/robots.txt');
    if (!robots || robots.status !== 200) {
      notes.push(
        'No robots.txt was served. That is not a defect, but it is worth adding before launch.',
      );
    }

    // --- Browser pass: accessibility, viewport, console -----------------------
    const session = new BrowserSession(context.guard, context.evidence);
    try {
      await session.open();
      await session.goto(url, 'networkidle');
      const desktopShot = await session.screenshot('Landing page, desktop viewport');

      const axe = await new AxeBuilder({ page: session.page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const axeEvidence = context.evidence.capture({
        kind: 'accessibility_scan',
        summary: 'axe-core WCAG 2.2 AA scan of the landing page',
        body: {
          url,
          violations: axe.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            nodes: violation.nodes.length,
            targets: violation.nodes.slice(0, 5).map((node) => node.target),
          })),
          passes: axe.passes.length,
        },
      });

      const serious = axe.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      if (serious.length > 0) {
        findings.push({
          ruleId: 'UX-03',
          dimension: 'practicality_ux',
          severity: serious.some((v) => v.impact === 'critical') ? 'high' : 'medium',
          confidence: 'high',
          title: `${serious.length} serious or critical accessibility violation${serious.length === 1 ? '' : 's'} on the landing page`,
          description: `An automated WCAG 2.2 AA scan found: ${serious
            .slice(0, 5)
            .map((v) => `${v.id} (${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'})`)
            .join(
              ', ',
            )}. Automated scanning finds a subset of accessibility problems; it does not certify the page as accessible.`,
          remediation: `Fix the reported violations, starting with ${serious[0]!.id}: ${serious[0]!.help}. Then re-run an automated scan and follow it with a keyboard-only pass, which catches what automation cannot.`,
          evidenceIds: [axeEvidence.id, desktopShot],
        });
      } else {
        notes.push(
          'The landing page passed the automated WCAG 2.2 AA checks with no serious violations.',
        );
      }

      await session.setViewport(MOBILE_VIEWPORT);
      await session.goto(url, 'networkidle');
      const mobileShot = await session.screenshot('Landing page, 390px mobile viewport');
      const overflow = await session.page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2,
      );
      const hasViewportMeta = await session.page.evaluate(() =>
        Boolean(document.querySelector('meta[name="viewport"]')),
      );

      if (!hasViewportMeta) {
        findings.push({
          ruleId: 'UX-02',
          dimension: 'practicality_ux',
          severity: 'medium',
          confidence: 'high',
          title: 'No viewport meta tag, so the page is not laid out for phones',
          description:
            'The document has no <meta name="viewport">. Mobile browsers fall back to rendering at desktop width and scaling down, which makes text small and touch targets hard to hit.',
          remediation:
            'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the document head.',
          evidenceIds: [mobileShot],
        });
      }
      if (overflow) {
        findings.push({
          ruleId: 'UX-02',
          dimension: 'practicality_ux',
          severity: 'medium',
          confidence: 'high',
          title: 'The page scrolls horizontally at 390px',
          description:
            'At a 390px-wide viewport the document is wider than the window, so the page scrolls sideways. On a phone this reads as broken.',
          remediation:
            'Find the element wider than its container — usually a fixed width, a wide table or an unconstrained image — and give it max-width: 100%.',
          evidenceIds: [mobileShot],
        });
      }

      const consoleEvidence = await session.captureConsole(
        'Console output during the deterministic pass',
      );
      const errors = session.consoleEntries.filter((entry) => entry.type === 'error');
      if (errors.length > 0 || session.pageErrors.length > 0) {
        findings.push({
          ruleId: 'PRD-02',
          dimension: 'production_readiness',
          severity: 'low',
          confidence: 'high',
          title: `${errors.length + session.pageErrors.length} console error${errors.length + session.pageErrors.length === 1 ? '' : 's'} on page load`,
          description: `Loading the page produced console errors, the first being: ${(session.pageErrors[0] ?? errors[0]?.text ?? '').slice(0, 300)}. Errors on a first page load usually mean something is failing silently for real users.`,
          remediation:
            'Open the browser console on a fresh load and fix each error. Add error monitoring so the ones that only happen in production are visible.',
          evidenceIds: [consoleEvidence],
        });
      }

      if (session.blockedRequests.length > 0) {
        notes.push(
          `${session.blockedRequests.length} request(s) from the page were blocked as out of scope; that is the authorisation boundary working, not a defect in the application.`,
        );
      }
    } catch (error) {
      notes.push(
        `The browser pass did not complete: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await session.close();
    }

    context.meter.recordCompute(
      'deterministic_checks',
      (Date.now() - startedAt) / 1000,
      context.evidence.totalBytes,
      context.guard.requestsMade,
    );

    return { stage: 'deterministic_checks', status: 'succeeded', findings, notes };
  },
};

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function transportChecks(requestedUrl: string, response: ScopedResponse): RawFinding[] {
  const findings: RawFinding[] = [];
  const isHttps = new URL(response.url).protocol === 'https:';

  if (!isHttps) {
    findings.push({
      ruleId: 'SEC-01',
      dimension: 'security_posture',
      severity: 'critical',
      confidence: 'high',
      title: 'The application is served over plain HTTP',
      description: `${requestedUrl} resolved to ${response.url}, which is not encrypted. Everything a user sends — including their password — travels in the clear and can be read or altered by anyone on the network path.`,
      remediation:
        'Serve the application over HTTPS only, and redirect HTTP to HTTPS with a 301. Most hosts issue a certificate automatically.',
      evidenceIds: [response.evidenceId],
    });
    return findings;
  }

  const hsts = response.headers['strict-transport-security'];
  if (!hsts) {
    findings.push({
      ruleId: 'SEC-01',
      dimension: 'security_posture',
      severity: 'medium',
      confidence: 'high',
      title: 'No Strict-Transport-Security header',
      description:
        'The response carries no HSTS header, so a browser that has never visited the site before can still be talked into a first request over plain HTTP.',
      remediation:
        'Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` once you are confident every subdomain serves HTTPS.',
      evidenceIds: [response.evidenceId],
    });
  }

  return findings;
}

function headerChecks(response: ScopedResponse): RawFinding[] {
  const findings: RawFinding[] = [];
  const headers = response.headers;
  const missing: string[] = [];

  if (!headers['content-security-policy']) missing.push('Content-Security-Policy');
  if (headers['x-content-type-options']?.toLowerCase() !== 'nosniff')
    missing.push('X-Content-Type-Options: nosniff');
  if (!headers['referrer-policy']) missing.push('Referrer-Policy');

  const framingProtected =
    Boolean(headers['x-frame-options']) ||
    (headers['content-security-policy'] ?? '').includes('frame-ancestors');
  if (!framingProtected) missing.push('frame-ancestors or X-Frame-Options');

  if (missing.length > 0) {
    findings.push({
      ruleId: 'SEC-02',
      dimension: 'security_posture',
      severity: missing.includes('Content-Security-Policy') ? 'medium' : 'low',
      confidence: 'high',
      title: `${missing.length} security header${missing.length === 1 ? '' : 's'} missing`,
      description: `The response is missing: ${missing.join(', ')}. Each of these closes off a class of browser-side attack that is otherwise available against your users.`,
      remediation:
        'Set the missing headers at the edge or in the framework config. Start the Content-Security-Policy in report-only mode, watch what it would have blocked, then enforce it.',
      evidenceIds: [response.evidenceId],
    });
  }

  const server = headers['x-powered-by'] ?? headers['server'];
  if (server && /\d+\.\d+/.test(server)) {
    findings.push({
      ruleId: 'PRD-04',
      dimension: 'production_readiness',
      severity: 'low',
      confidence: 'high',
      title: 'The server advertises its exact software version',
      description: `The response carries "${server}", which tells an attacker precisely which published vulnerabilities to try first.`,
      remediation: 'Suppress the Server and X-Powered-By headers at the edge.',
      evidenceIds: [response.evidenceId],
    });
  }

  return findings;
}

function cookieChecks(response: ScopedResponse): RawFinding[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];

  const problems: string[] = [];
  const lower = raw.toLowerCase();
  // vibefy-copy-lint-allow: "Secure" here is the cookie attribute name, not a claim about the application
  if (!lower.includes('secure')) problems.push('Secure');
  if (!lower.includes('httponly')) problems.push('HttpOnly');
  if (!lower.includes('samesite')) problems.push('SameSite');

  if (problems.length === 0) return [];

  return [
    {
      ruleId: 'SEC-03',
      dimension: 'security_posture',
      severity: problems.includes('HttpOnly') ? 'high' : 'medium',
      confidence: 'high',
      title: `Session cookie is missing ${problems.join(', ')}`,
      description: `A cookie was set without ${problems.join(', ')}. Without HttpOnly any script on the page can read the session; without Secure it can travel over plain HTTP; without SameSite it is sent on cross-site requests.`,
      remediation: `Set the cookie with ${problems.map((flag) => (flag === 'SameSite' ? 'SameSite=Lax' : flag)).join('; ')}.`,
      evidenceIds: [response.evidenceId],
    },
  ];
}

function corsChecks(response: ScopedResponse): RawFinding[] {
  const origin = response.headers['access-control-allow-origin'];
  const credentials = response.headers['access-control-allow-credentials'];
  if (origin !== '*' || credentials?.toLowerCase() !== 'true') return [];

  return [
    {
      ruleId: 'SEC-11',
      dimension: 'security_posture',
      severity: 'high',
      confidence: 'high',
      title: 'CORS allows any origin while also allowing credentials',
      description:
        'The response sets Access-Control-Allow-Origin: * together with Access-Control-Allow-Credentials: true. Any website a signed-in user visits can read authenticated responses from this application.',
      remediation:
        'Replace the wildcard with an explicit list of origins you control, and only send Access-Control-Allow-Credentials for those.',
      evidenceIds: [response.evidenceId],
    },
  ];
}

function bodyChecks(response: ScopedResponse): RawFinding[] {
  const findings: RawFinding[] = [];
  const body = response.body;

  const sourceMap = /\/\/[#@]\s*sourceMappingURL=/.test(body);
  if (sourceMap) {
    findings.push({
      ruleId: 'SEC-08',
      dimension: 'security_posture',
      severity: 'low',
      confidence: 'high',
      title: 'Source maps are referenced from the production bundle',
      description:
        'The page references a sourceMappingURL, which publishes your original source, including comments and file structure, to anyone who opens developer tools.',
      remediation:
        'Stop emitting source maps in production builds, or upload them to your error monitor privately instead of serving them.',
      evidenceIds: [response.evidenceId],
    });
  }

  // Credential shapes in a page a browser can fetch. Deliberately narrow: these
  // patterns are specific enough that a match is a live key, not a false alarm.
  const credentialPatterns: readonly { pattern: RegExp; label: string }[] = [
    { pattern: /sk-ant-[A-Za-z0-9_-]{16,}/, label: 'an Anthropic API key' },
    { pattern: /\bsk_live_[A-Za-z0-9]{12,}\b/, label: 'a Stripe live secret key' },
    { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: 'an AWS access key id' },
    { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, label: 'a Google API key' },
    { pattern: /\bghp_[A-Za-z0-9]{16,}\b/, label: 'a GitHub token' },
    {
      pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s:@/]{6,}@/,
      label: 'a database connection string with a password',
    },
  ];
  for (const { pattern, label } of credentialPatterns) {
    if (pattern.test(body)) {
      findings.push({
        ruleId: 'SEC-04',
        dimension: 'security_posture',
        severity: 'critical',
        confidence: 'high',
        title: `What appears to be ${label} is served to the browser`,
        description: `The HTML or script served at ${response.url} contains a string matching ${label}. Anything sent to a browser is public — treat this credential as compromised.`,
        remediation: `Rotate the credential now, before changing any code. Then move the call that needs it to a server route, so the key never reaches the client.`,
        evidenceIds: [response.evidenceId],
      });
    }
  }

  if (/\b(?:localhost|127\.0\.0\.1)[:/]/.test(body) || /\bstaging\.[a-z0-9-]+\./i.test(body)) {
    findings.push({
      ruleId: 'PRD-04',
      dimension: 'production_readiness',
      severity: 'low',
      confidence: 'medium',
      title: 'The production page references a local or staging endpoint',
      description:
        'The served page contains a localhost or staging URL. Either a developer build shipped, or the application calls an environment that will not exist for real users.',
      remediation:
        'Move environment-specific URLs into configuration and confirm the production build uses production values.',
      evidenceIds: [response.evidenceId],
    });
  }

  const hasPrivacyLink = /href=["'][^"']*privacy/i.test(body);
  if (!hasPrivacyLink) {
    findings.push({
      ruleId: 'PRI-01',
      dimension: 'data_privacy_practice',
      severity: 'medium',
      confidence: 'medium',
      title: 'No link to a privacy policy on the landing page',
      description:
        'The landing page contains no link whose target mentions privacy. A reachable privacy policy is a requirement of both app stores and of most data-protection regimes wherever personal data is collected.',
      remediation:
        'Publish a privacy policy specific to this application and link it from the footer and from any sign-up form.',
      evidenceIds: [response.evidenceId],
    });
  }

  return findings;
}
