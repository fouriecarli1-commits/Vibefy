-- =============================================================================
-- 0014 — Publish rubric 1.0.0
--
-- The rubric has existed as JSON in the repository since M2 and as a table in
-- the database since M1, and nothing ever put the one into the other. Every
-- assessment stamps the version it was scored against, and
-- `assessments.rubric_version` references this table, so on a database where
-- no version has been published *every* assessment fails to persist:
--
--     insert or update on table "assessments" violates foreign key
--     constraint "assessments_rubric_version_fkey"
--
-- Which is exactly what the first real run did, after paying for the work.
-- The test fixture seeded this row, so the gap was invisible to 800-odd
-- passing tests: the tests proved the schema worked, not that the schema was
-- populated.
--
-- The definition and checksum below are generated from
-- `packages/rubric/versions/1.0.0.json` — the same bytes the scoring code
-- loads, canonicalised the same way. `tests/rubric-published.test.ts` fails if
-- they ever drift apart.
--
-- Published on insert, which freezes it: `rubric_versions_frozen_once_published`
-- refuses any later edit to the definition or the checksum. That is the point.
-- A score is only meaningful if the rubric it was measured against cannot be
-- rewritten afterwards.
-- =============================================================================

insert into public.rubric_versions
  (version, definition, checksum, changelog, published_at, effective_from)
values (
  '1.0.0',
  $rubric${
  "version": "1.0.0",
  "name": "VibefyCode Rubric",
  "status": "draft",
  "changelog": "First rubric. Six weighted dimensions, severity-and-confidence penalties, and hard gates that no arithmetic can outvote.",
  "certification": {
    "overallThreshold": 70,
    "dimensionFloors": {
      "security_posture": 65,
      "data_privacy_practice": 60,
      "functional_integrity": 60
    },
    "maximumBadgeValidityMonths": 12
  },
  "scoring": {
    "method": "Each dimension starts at 100. Every published finding subtracts its severity penalty, scaled by the confidence multiplier. Dimension scores are clamped to 0–100 and combined by weight. Gates are applied last and can only lower a result.",
    "severityPenalties": {
      "critical": 45,
      "high": 22,
      "medium": 9,
      "low": 3,
      "info": 0
    },
    "confidenceMultipliers": {
      "high": 1,
      "medium": 0.7,
      "low": 0.4
    },
    "roundingDecimals": 2
  },
  "bands": [
    {
      "min": 90,
      "max": 100,
      "label": "Exemplary",
      "meaning": "No material findings within the assessed scope."
    },
    {
      "min": 75,
      "max": 89.99,
      "label": "Strong",
      "meaning": "Minor findings only; remediation is straightforward."
    },
    {
      "min": 60,
      "max": 74.99,
      "label": "Adequate",
      "meaning": "Working, with findings that a real user would eventually meet."
    },
    {
      "min": 40,
      "max": 59.99,
      "label": "Weak",
      "meaning": "Findings that would frustrate users or fail store review."
    },
    {
      "min": 0,
      "max": 39.99,
      "label": "Not ready",
      "meaning": "Findings that block usable release within the assessed scope."
    }
  ],
  "gates": [
    {
      "id": "GATE-CRITICAL-SECURITY",
      "label": "Critical security or privacy finding",
      "appliesToDimensions": [
        "security_posture",
        "data_privacy_practice"
      ],
      "triggerSeverity": "critical",
      "capOverallAt": 49,
      "blocksCertification": true,
      "rationale": "A single critical exposure makes the rest of the score irrelevant. Encoded as a gate rather than as arithmetic so that no combination of strong dimensions can outvote it."
    },
    {
      "id": "GATE-EXPOSED-SECRET",
      "label": "Live credential exposed in client code or repository",
      "appliesToRules": [
        "SEC-04"
      ],
      "capOverallAt": 39,
      "blocksCertification": true,
      "rationale": "The most common serious defect in AI-built apps, and the one with the fastest path to real-world harm."
    },
    {
      "id": "GATE-NO-AUTHORISATION-COVERAGE",
      "label": "Core flows unreachable within the authorised scope",
      "blocksCertification": true,
      "rationale": "If the authorised scope did not permit exercising the core flows, we did not assess the product and must not certify it."
    }
  ],
  "dimensions": [
    {
      "id": "functional_integrity",
      "label": "Functional integrity",
      "weight": 0.25,
      "question": "Do the core flows actually complete, and does the app behave when they do not?",
      "criteria": [
        {
          "id": "FI-01",
          "label": "Primary user journey completes end to end",
          "requiredEvidence": [
            "playwright_trace",
            "screenshot"
          ]
        },
        {
          "id": "FI-02",
          "label": "Sign-up and sign-in succeed and persist across refresh",
          "requiredEvidence": [
            "playwright_trace"
          ]
        },
        {
          "id": "FI-03",
          "label": "Form validation rejects bad input with a usable message",
          "requiredEvidence": [
            "screenshot"
          ]
        },
        {
          "id": "FI-04",
          "label": "Error states are handled rather than crashing or hanging",
          "requiredEvidence": [
            "console_log",
            "screenshot"
          ]
        },
        {
          "id": "FI-05",
          "label": "Empty states are designed rather than blank",
          "requiredEvidence": [
            "screenshot"
          ]
        },
        {
          "id": "FI-06",
          "label": "Browser back button and deep links behave correctly",
          "requiredEvidence": [
            "playwright_trace"
          ]
        },
        {
          "id": "FI-07",
          "label": "State survives reload; logout clears session",
          "requiredEvidence": [
            "playwright_trace"
          ]
        }
      ]
    },
    {
      "id": "security_posture",
      "label": "Security posture",
      "weight": 0.25,
      "question": "What is observably exposed, and does authorisation hold on the server?",
      "note": "Posture, never a statement that an application is secure. This dimension reports what was observable within the authorised scope using non-destructive methods.",
      "criteria": [
        {
          "id": "SEC-01",
          "label": "HTTPS enforced, HSTS present, no mixed content",
          "requiredEvidence": [
            "header_scan"
          ]
        },
        {
          "id": "SEC-02",
          "label": "Security headers present and sane (CSP, X-Content-Type-Options, Referrer-Policy, frame ancestors)",
          "requiredEvidence": [
            "header_scan"
          ]
        },
        {
          "id": "SEC-03",
          "label": "Session cookies carry Secure, HttpOnly and a sane SameSite",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "SEC-04",
          "label": "No live credential in client bundles, source maps or repository history",
          "requiredEvidence": [
            "dependency_report",
            "http_exchange"
          ]
        },
        {
          "id": "SEC-05",
          "label": "Authorisation is enforced server-side, not only in the UI",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "SEC-06",
          "label": "Object references are not guessable in a way that exposes other tenants",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "SEC-07",
          "label": "API endpoints require authentication where the UI implies they do",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "SEC-08",
          "label": "No .env, .git, admin route or source map exposed",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "SEC-09",
          "label": "Rate limiting exists on authentication and expensive endpoints",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "SEC-10",
          "label": "Dependencies carry no known-critical advisories",
          "requiredEvidence": [
            "dependency_report"
          ]
        },
        {
          "id": "SEC-11",
          "label": "CORS policy is not a wildcard on credentialed endpoints",
          "requiredEvidence": [
            "header_scan"
          ]
        }
      ]
    },
    {
      "id": "data_privacy_practice",
      "label": "Data & privacy practice",
      "weight": 0.15,
      "question": "What is collected, is it disclosed, and can a user get out?",
      "criteria": [
        {
          "id": "PRI-01",
          "label": "Privacy policy present, reachable and specific to this app",
          "requiredEvidence": [
            "screenshot"
          ]
        },
        {
          "id": "PRI-02",
          "label": "Data collection disclosed and matches observed network behaviour",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "PRI-03",
          "label": "Account deletion path exists and is reachable by a user",
          "requiredEvidence": [
            "playwright_trace"
          ]
        },
        {
          "id": "PRI-04",
          "label": "Third-party transfers disclosed; no undisclosed trackers",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "PRI-05",
          "label": "Consent obtained before non-essential tracking",
          "requiredEvidence": [
            "screenshot",
            "http_exchange"
          ]
        },
        {
          "id": "PRI-06",
          "label": "No personal data in URLs, logs or client-side storage without cause",
          "requiredEvidence": [
            "http_exchange"
          ]
        }
      ]
    },
    {
      "id": "practicality_ux",
      "label": "Practicality & UX",
      "weight": 0.15,
      "question": "Can a first-time user get to value, on the device they actually own?",
      "criteria": [
        {
          "id": "UX-01",
          "label": "First-run path to value is clear without instruction",
          "requiredEvidence": [
            "screenshot"
          ]
        },
        {
          "id": "UX-02",
          "label": "Layout works at 360px width and does not scroll horizontally",
          "requiredEvidence": [
            "screenshot"
          ]
        },
        {
          "id": "UX-03",
          "label": "WCAG 2.2 AA automated pass with no critical violations",
          "requiredEvidence": [
            "accessibility_scan"
          ]
        },
        {
          "id": "UX-04",
          "label": "Keyboard navigation reaches every interactive element with a visible focus indicator",
          "requiredEvidence": [
            "accessibility_scan",
            "playwright_trace"
          ]
        },
        {
          "id": "UX-05",
          "label": "Loading and error feedback exists for slow operations",
          "requiredEvidence": [
            "screenshot"
          ]
        },
        {
          "id": "UX-06",
          "label": "Copy is legible and free of placeholder text",
          "requiredEvidence": [
            "screenshot"
          ]
        }
      ]
    },
    {
      "id": "production_readiness",
      "label": "Production readiness",
      "weight": 0.1,
      "question": "Would this survive contact with real traffic and a bad day?",
      "criteria": [
        {
          "id": "PRD-01",
          "label": "Lighthouse performance within an acceptable band on a mid-tier device",
          "requiredEvidence": [
            "lighthouse_report"
          ]
        },
        {
          "id": "PRD-02",
          "label": "No console errors on core flows",
          "requiredEvidence": [
            "console_log"
          ]
        },
        {
          "id": "PRD-03",
          "label": "Error monitoring is present",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "PRD-04",
          "label": "Environment hygiene: no debug flags, test data or staging endpoints in production",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "PRD-05",
          "label": "No obvious scalability red flags in observable behaviour",
          "requiredEvidence": [
            "http_exchange"
          ]
        }
      ]
    },
    {
      "id": "store_distribution_readiness",
      "label": "Store & distribution readiness",
      "weight": 0.1,
      "question": "Would this pass the published submission requirements on first attempt?",
      "note": "Assessed against publicly documented App Store and Play submission requirements. Store review outcomes are the stores' decision, never ours.",
      "criteria": [
        {
          "id": "STR-01",
          "label": "Privacy policy URL present and reachable",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "STR-02",
          "label": "Data-collection disclosure matches observed behaviour",
          "requiredEvidence": [
            "http_exchange"
          ]
        },
        {
          "id": "STR-03",
          "label": "In-app account deletion path exists",
          "requiredEvidence": [
            "playwright_trace"
          ]
        },
        {
          "id": "STR-04",
          "label": "Login is not required to see core value where the store forbids it",
          "requiredEvidence": [
            "screenshot"
          ]
        },
        {
          "id": "STR-05",
          "label": "No placeholder content, lorem ipsum or unfinished screens",
          "requiredEvidence": [
            "screenshot"
          ]
        },
        {
          "id": "STR-06",
          "label": "Does not crash on cold start",
          "requiredEvidence": [
            "playwright_trace"
          ]
        },
        {
          "id": "STR-07",
          "label": "Exceeds minimum functionality expectations",
          "requiredEvidence": [
            "screenshot"
          ]
        }
      ]
    }
  ]
}$rubric$::jsonb,
  '6d6d9047480d74109c76f926f9d5b4c410a6a66dbde62e7eb152c73c5f0cdced',
  'First published rubric: 6 scored dimensions (functional_integrity, security_posture, data_privacy_practice, practicality_ux, production_readiness, store_distribution_readiness) and 3 gates (GATE-CRITICAL-SECURITY, GATE-EXPOSED-SECRET, GATE-NO-AUTHORISATION-COVERAGE).',
  now(),
  now()
)
on conflict (version) do nothing;
