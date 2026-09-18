-- =============================================================================
-- 0022 — Publish rubric 1.1.0
--
-- Seven new criteria, and nothing else. Every weight, severity penalty,
-- confidence multiplier, band, gate, threshold and dimension floor is
-- byte-identical to 1.0.0, so an application with identical findings scores
-- identically under either — the pass mark has not moved, and
-- `tests/rubric-published.test.ts` asserts that rather than taking this
-- comment's word for it.
--
-- 1.0.0 stays published and stays in the registry. A badge earned against it is
-- verified against it until it expires: a score recomputed against a rubric
-- that did not exist when it was earned is not the score anybody agreed to.
--
-- What the seven are for, and why they arrive now:
--
--   · SEC-12, SEC-13 and PRI-07 — the verification page now answers a visitor
--     directly, in their own words, and three of its questions had no criterion
--     behind them: does my card reach a real payment company, is the page
--     running anything known to be hostile, and is there a person to contact.
--   · UX-07 — visual consistency had nowhere to be recorded, so the design
--     survey was citing a criterion about first-run clarity instead. Findings
--     against it are observations and carry no penalty; tightening what a badge
--     requires is a separate decision from having somewhere to write something
--     down.
--   · FI-08, PRD-06 and STR-08 — games fail in ways the general criteria were
--     not written to look at: never becoming interactive, needing an input
--     method the device does not have, and the weight downloaded before any of
--     it can start.
--
-- Every one of them arrived with the check that answers it. A criterion nothing
-- checks is worse than no criterion at all, because the assurance list turns
-- "no findings" into a tick — and a tick for something nobody looked at is the
-- one failure this whole product cannot survive.
-- =============================================================================

insert into public.rubric_versions
  (version, definition, checksum, changelog, published_at, effective_from)
values (
  '1.1.0',
  $rubric${
  "version": "1.1.0",
  "name": "VibefyCode Rubric",
  "status": "draft",
  "changelog": "Seven new criteria, and nothing else. No weight, penalty, confidence multiplier, band, gate, threshold or dimension floor differs from 1.0.0, so an application with identical findings scores identically under both \u2014 the pass mark has not moved. What is new is that seven things we can already observe now have somewhere to be recorded, instead of being reported as observations against a criterion that did not quite fit. SEC-12 and SEC-13 and PRI-07 exist because the verification page now answers a visitor directly and three of its questions had no criterion behind them. UX-07 gives visual consistency a home; findings against it are observations and carry no penalty, because tightening what a badge requires is a separate decision from having somewhere to write something down. FI-08, PRD-06 and STR-08 are for games, which fail in ways the general criteria were not written to look at. Every criterion here arrived with the check that answers it. A criterion nothing checks is worse than no criterion at all: it turns \"nobody looked\" into \"nothing was found\".",
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
    "method": "Each dimension starts at 100. Every published finding subtracts its severity penalty, scaled by the confidence multiplier. Dimension scores are clamped to 0\u2013100 and combined by weight. Gates are applied last and can only lower a result.",
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
      "appliesToDimensions": ["security_posture", "data_privacy_practice"],
      "triggerSeverity": "critical",
      "capOverallAt": 49,
      "blocksCertification": true,
      "rationale": "A single critical exposure makes the rest of the score irrelevant. Encoded as a gate rather than as arithmetic so that no combination of strong dimensions can outvote it."
    },
    {
      "id": "GATE-EXPOSED-SECRET",
      "label": "Live credential exposed in client code or repository",
      "appliesToRules": ["SEC-04"],
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
          "requiredEvidence": ["playwright_trace", "screenshot"]
        },
        {
          "id": "FI-02",
          "label": "Sign-up and sign-in succeed and persist across refresh",
          "requiredEvidence": ["playwright_trace"]
        },
        {
          "id": "FI-03",
          "label": "Form validation rejects bad input with a usable message",
          "requiredEvidence": ["screenshot"]
        },
        {
          "id": "FI-04",
          "label": "Error states are handled rather than crashing or hanging",
          "requiredEvidence": ["console_log", "screenshot"]
        },
        {
          "id": "FI-05",
          "label": "Empty states are designed rather than blank",
          "requiredEvidence": ["screenshot"]
        },
        {
          "id": "FI-06",
          "label": "Browser back button and deep links behave correctly",
          "requiredEvidence": ["playwright_trace"]
        },
        {
          "id": "FI-07",
          "label": "State survives reload; logout clears session",
          "requiredEvidence": ["playwright_trace"]
        },
        {
          "id": "FI-08",
          "label": "The application reaches an interactive state, and the input methods it needs are supported",
          "requiredEvidence": ["screenshot", "playwright_trace"]
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
          "requiredEvidence": ["header_scan"]
        },
        {
          "id": "SEC-02",
          "label": "Security headers present and sane (CSP, X-Content-Type-Options, Referrer-Policy, frame ancestors)",
          "requiredEvidence": ["header_scan"]
        },
        {
          "id": "SEC-03",
          "label": "Session cookies carry Secure, HttpOnly and a sane SameSite",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "SEC-04",
          "label": "No live credential in client bundles, source maps or repository history",
          "requiredEvidence": ["dependency_report", "http_exchange"]
        },
        {
          "id": "SEC-05",
          "label": "Authorisation is enforced server-side, not only in the UI",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "SEC-06",
          "label": "Object references are not guessable in a way that exposes other tenants",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "SEC-07",
          "label": "API endpoints require authentication where the UI implies they do",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "SEC-08",
          "label": "No .env, .git, admin route or source map exposed",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "SEC-09",
          "label": "Rate limiting exists on authentication and expensive endpoints",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "SEC-10",
          "label": "Dependencies carry no known-critical advisories",
          "requiredEvidence": ["dependency_report"]
        },
        {
          "id": "SEC-11",
          "label": "CORS policy is not a wildcard on credentialed endpoints",
          "requiredEvidence": ["header_scan"]
        },
        {
          "id": "SEC-12",
          "label": "Card details are handled by a recognised payment processor rather than collected by the application itself",
          "requiredEvidence": ["http_exchange", "screenshot"]
        },
        {
          "id": "SEC-13",
          "label": "No script is loaded from a known cryptominer or a known-malicious host",
          "requiredEvidence": ["http_exchange", "console_log"]
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
          "requiredEvidence": ["screenshot"]
        },
        {
          "id": "PRI-02",
          "label": "Data collection disclosed and matches observed network behaviour",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "PRI-03",
          "label": "Account deletion path exists and is reachable by a user",
          "requiredEvidence": ["playwright_trace"]
        },
        {
          "id": "PRI-04",
          "label": "Third-party transfers disclosed; no undisclosed trackers",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "PRI-05",
          "label": "Consent obtained before non-essential tracking",
          "requiredEvidence": ["screenshot", "http_exchange"]
        },
        {
          "id": "PRI-06",
          "label": "No personal data in URLs, logs or client-side storage without cause",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "PRI-07",
          "label": "A contact route to the operator is published and reachable without signing in",
          "requiredEvidence": ["screenshot", "http_exchange"]
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
          "requiredEvidence": ["screenshot"]
        },
        {
          "id": "UX-02",
          "label": "Layout works at 360px width and does not scroll horizontally",
          "requiredEvidence": ["screenshot"]
        },
        {
          "id": "UX-03",
          "label": "WCAG 2.2 AA automated pass with no critical violations",
          "requiredEvidence": ["accessibility_scan"]
        },
        {
          "id": "UX-04",
          "label": "Keyboard navigation reaches every interactive element with a visible focus indicator",
          "requiredEvidence": ["accessibility_scan", "playwright_trace"]
        },
        {
          "id": "UX-05",
          "label": "Loading and error feedback exists for slow operations",
          "requiredEvidence": ["screenshot"]
        },
        {
          "id": "UX-06",
          "label": "Copy is legible and free of placeholder text",
          "requiredEvidence": ["screenshot"]
        },
        {
          "id": "UX-07",
          "label": "Type, spacing and control styles follow a consistent scale rather than being chosen per element",
          "requiredEvidence": ["screenshot"]
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
          "requiredEvidence": ["lighthouse_report"]
        },
        {
          "id": "PRD-02",
          "label": "No console errors on core flows",
          "requiredEvidence": ["console_log"]
        },
        {
          "id": "PRD-03",
          "label": "Error monitoring is present",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "PRD-04",
          "label": "Environment hygiene: no debug flags, test data or staging endpoints in production",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "PRD-05",
          "label": "No obvious scalability red flags in observable behaviour",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "PRD-06",
          "label": "Time and transferred weight before the application is usable, measured over a declared connection",
          "requiredEvidence": ["http_exchange", "screenshot"]
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
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "STR-02",
          "label": "Data-collection disclosure matches observed behaviour",
          "requiredEvidence": ["http_exchange"]
        },
        {
          "id": "STR-03",
          "label": "In-app account deletion path exists",
          "requiredEvidence": ["playwright_trace"]
        },
        {
          "id": "STR-04",
          "label": "Login is not required to see core value where the store forbids it",
          "requiredEvidence": ["screenshot"]
        },
        {
          "id": "STR-05",
          "label": "No placeholder content, lorem ipsum or unfinished screens",
          "requiredEvidence": ["screenshot"]
        },
        {
          "id": "STR-06",
          "label": "Does not crash on cold start",
          "requiredEvidence": ["playwright_trace"]
        },
        {
          "id": "STR-07",
          "label": "Exceeds minimum functionality expectations",
          "requiredEvidence": ["screenshot"]
        },
        {
          "id": "STR-08",
          "label": "Age rating and in-app purchase disclosure are present where the store requires them",
          "requiredEvidence": ["screenshot"]
        }
      ]
    }
  ]
}$rubric$::jsonb,
  '16df419ffb252ed59608330de825f0f3f849e2badcac5999039d4a2f3fe1fe3a',
  'Additive: seven new criteria (FI-08, SEC-12, SEC-13, PRI-07, UX-07, PRD-06, STR-08) across the existing six dimensions. No weight, penalty, band, gate or threshold changed, so scores are comparable with 1.0.0.',
  now(),
  now()
)
on conflict (version) do nothing;
