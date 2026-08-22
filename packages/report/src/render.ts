/**
 * The report, as a self-contained HTML document.
 *
 * Self-contained on purpose: this same document is what Playwright prints to
 * PDF, and a PDF that depends on a stylesheet fetched at print time is a PDF
 * that renders differently depending on the network. Everything — tokens,
 * layout, print rules — is inlined.
 *
 * The scope statement and the non-reliance legend are frozen into the row this
 * renders from, not read from the current source files, so a later edit to the
 * standard wording can never change what a customer was actually told.
 */
import { NON_RELIANCE_LEGEND, AI_DISCLOSURE, legibleOr, themes } from '@vibefy/shared';
import { redactForTier, scoreFingerprint } from './redact.ts';
import type { RenderedReport, ReportFinding, ReportSource, ReportTier } from './types.ts';

const SEVERITY_LABEL: Record<ReportFinding['severity'], string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Note',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stylesheet(): string {
  const light = themes.light;
  return `
    .whitelabel {
      display: flex; gap: 16px; align-items: flex-start;
      border-left: 4px solid var(--line-strong);
      padding: 12px 0 12px 16px; margin-bottom: 28px;
    }
    .whitelabel-logo { max-height: 56px; max-width: 180px; }
    .whitelabel-name { font-weight: 700; font-size: 18px; margin: 0; }
    .whitelabel-line { margin: 0 0 4px; font-weight: 600; }
    :root {
      --surface: ${light.surface};
      --surface-muted: ${light.surfaceMuted};
      --text: ${light.text};
      --muted: ${light.textMuted};
      --line: ${light.border};
      --line-strong: ${light.borderInteractive};
      --accent: ${light.accent};
      --ok: ${light.success};
      --warn: ${light.warning};
      --bad: ${light.danger};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0 0 48px;
      background: var(--surface);
      color: var(--text);
      font-family: 'Poppins', 'Montserrat', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      line-height: 1.6;
      font-size: 15px;
    }
    .page { max-width: 46rem; margin: 0 auto; padding: 0 24px; }
    h1 { font-size: 2rem; letter-spacing: -0.02em; margin: 0 0 8px; }
    h2 { font-size: 1.35rem; letter-spacing: -0.01em; margin: 40px 0 12px; }
    h3 { font-size: 1.05rem; margin: 0 0 6px; }
    p { margin: 0 0 12px; }
    .muted { color: var(--muted); }
    .lede { font-size: 1.1rem; }
    header.cover { padding: 40px 0 24px; border-bottom: 1px solid var(--line); }
    .score-row { display: flex; flex-wrap: wrap; gap: 24px; align-items: baseline; margin: 24px 0 8px; }
    .score { font-size: 3.4rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
    .score-of { color: var(--muted); font-size: 1.1rem; }
    .band { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
    th { text-align: left; font-weight: 600; }
    td, th { padding: 8px 12px 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
    .bar { height: 8px; border-radius: 4px; background: var(--surface-muted); overflow: hidden; min-width: 120px; }
    .bar > span { display: block; height: 8px; background: var(--accent); }
    .finding { border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin: 0 0 16px; break-inside: avoid; }
    .finding-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: baseline; }
    .sev { font-weight: 600; font-size: 0.9rem; }
    .sev-critical, .sev-high { color: var(--bad); }
    .sev-medium { color: var(--warn); }
    .sev-low, .sev-info { color: var(--muted); }
    .remediation { border-left: 3px solid var(--line-strong); padding-left: 14px; margin-top: 12px; }
    .evidence { margin-top: 12px; font-size: 0.85rem; color: var(--muted); }
    .evidence code { font-size: 0.8rem; }
    .callout { border: 1px solid var(--line); background: var(--surface-muted); border-radius: 12px; padding: 20px; margin: 24px 0; break-inside: avoid; }
    .legend { font-size: 0.85rem; color: var(--muted); border-top: 1px solid var(--line); margin-top: 40px; padding-top: 20px; }
    ol.plan { padding-left: 20px; }
    ol.plan li { margin-bottom: 16px; break-inside: avoid; }
    ul.plain { padding-left: 20px; }
    @media print {
      body { font-size: 11pt; }
      .page { max-width: none; padding: 0; }
      h2 { break-after: avoid; }
      a { color: inherit; text-decoration: none; }
      @page { margin: 18mm 16mm; }
    }
  `;
}

export function renderReport(source: ReportSource, tier: ReportTier): RenderedReport {
  const view = redactForTier(source, tier);
  const fingerprint = scoreFingerprint(source);
  const title = `Vibefy assessment — ${source.appName}`;

  const findingsHtml = view.findings
    .map(
      (finding) => `
      <article class="finding">
        <div class="finding-head">
          <h3>${escapeHtml(finding.title)}</h3>
          <span class="sev sev-${finding.severity}">${SEVERITY_LABEL[finding.severity]} · ${escapeHtml(finding.confidence)} confidence</span>
        </div>
        <p class="muted">${escapeHtml(finding.dimension.replace(/_/g, ' '))} · ${escapeHtml(finding.ruleId)}</p>
        <p>${escapeHtml(finding.description)}</p>
        ${
          view.showRemediation && finding.remediation
            ? `<div class="remediation"><strong>What to do.</strong> ${escapeHtml(finding.remediation)}</div>`
            : ''
        }
        ${
          view.showEvidence && finding.evidence.length > 0
            ? `<div class="evidence"><strong>Evidence.</strong> ${finding.evidence
                .map(
                  (artefact) =>
                    `${escapeHtml(artefact.kind.replace(/_/g, ' '))} — ${escapeHtml(artefact.summary)} <code>${artefact.sha256.slice(0, 12)}…</code>`,
                )
                .join('<br>')}</div>`
            : ''
        }
      </article>`,
    )
    .join('\n');

  const dimensionRows = source.dimensions
    .map(
      (dimension) => `
      <tr>
        <th scope="row">${escapeHtml(dimension.label)}</th>
        <td class="muted">${Math.round(dimension.weight * 100)}%</td>
        <td><div class="bar"><span style="width:${Math.max(0, Math.min(100, dimension.score))}%"></span></div></td>
        <td>${dimension.score.toFixed(1)}</td>
        <td class="muted">${escapeHtml(dimension.band)}</td>
      </tr>`,
    )
    .join('\n');

  const branding = source.branding ?? null;
  // The agency's colour is used only if it is legible on the report surface. We
  // will not ship a document that fails the standard we score other people
  // against, however much someone likes their brand blue.
  const accent = legibleOr(branding?.accentColour, themes.light.surface, themes.light.text);
  const brandingHtml = branding
    ? `<aside class="whitelabel" style="border-color:${escapeHtml(accent)}">
        ${
          branding.logoDataUri
            ? `<img class="whitelabel-logo" src="${escapeHtml(branding.logoDataUri)}" alt="${escapeHtml(branding.displayName)}">`
            : `<p class="whitelabel-name" style="color:${escapeHtml(accent)}">${escapeHtml(branding.displayName)}</p>`
        }
        <div>
          <p class="whitelabel-line">Prepared for you by ${escapeHtml(branding.displayName)}.</p>
          <p class="muted">The assessment itself was carried out by Vibefy against published rubric v${escapeHtml(source.rubricVersion)}. ${escapeHtml(branding.displayName)} did not score this application and cannot change what it scored.</p>
          ${branding.contactLine ? `<p class="muted">${escapeHtml(branding.contactLine)}</p>` : ''}
        </div>
      </aside>`
    : '';

  const policy = source.policy ?? null;
  const policyHtml = policy
    ? `<section class="callout">
        <h2 style="margin-top:0">Your organisation’s policy: ${escapeHtml(policy.profileName)}</h2>
        <p><strong>${policy.meetsPolicy ? 'Meets your policy.' : 'Does not meet your policy.'}</strong></p>
        ${
          policy.failures.length > 0
            ? `<ul class="plain">${policy.failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join('')}</ul>`
            : ''
        }
        <p class="muted">${escapeHtml(policy.note)}</p>
      </section>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="vibefy-score-fingerprint" content="${escapeHtml(fingerprint)}">
<style>${stylesheet()}</style>
</head>
<body>
<div class="page">

${brandingHtml}
<header class="cover">
  <p class="muted">Vibefy assessment · Rubric v${escapeHtml(source.rubricVersion)}</p>
  <h1>${escapeHtml(source.appName)}</h1>
  <p class="muted">${escapeHtml(source.appUrl ?? '')} · assessed ${escapeHtml(source.assessedOn)}${
    source.reviewedOn ? ` · reviewed ${escapeHtml(source.reviewedOn)}` : ''
  }</p>
  <div class="score-row">
    <span class="score">${source.overallScore.toFixed(1)}</span>
    <span class="score-of">/ 100</span>
    <span class="band">${escapeHtml(source.band)}</span>
  </div>
  <p class="muted">Prepared for ${escapeHtml(source.organisationName)}${tier === 'free' ? ' · free tier' : ''}</p>
</header>

<section class="callout">
  <h2 style="margin-top:0">What this assessment is, and is not</h2>
  <p>${escapeHtml(source.scopeStatement)}</p>
  <p class="muted">${escapeHtml(AI_DISCLOSURE)}</p>
</section>

${policyHtml}

${
  source.narrative
    ? `<section>
  <h2>Summary</h2>
  <p class="lede">${escapeHtml(source.narrative.headline)}</p>
  <p>${escapeHtml(source.narrative.summary)}</p>
  ${
    source.narrative.strengths.length > 0
      ? `<h3>What this application does well</h3><ul class="plain">${source.narrative.strengths
          .map((strength) => `<li>${escapeHtml(strength)}</li>`)
          .join('')}</ul>`
      : ''
  }
</section>`
    : ''
}

<section>
  <h2>Score by dimension</h2>
  <table>
    <caption class="muted" style="text-align:left;padding-bottom:8px">
      Scores are computed from the published rubric. Gates are applied last and can only lower a result.
    </caption>
    <thead>
      <tr><th scope="col">Dimension</th><th scope="col">Weight</th><th scope="col"></th><th scope="col">Score</th><th scope="col">Band</th></tr>
    </thead>
    <tbody>${dimensionRows}</tbody>
  </table>
  ${
    source.certificationBlockers.length > 0
      ? `<div class="callout"><h3>Why this did not reach the certification threshold</h3><ul class="plain">${source.certificationBlockers
          .map((blocker) => `<li>${escapeHtml(blocker)}</li>`)
          .join('')}</ul></div>`
      : `<p class="muted">This assessment met the published certification threshold on the date above.</p>`
  }
</section>

<section>
  <h2>Findings${view.hiddenFindingCount > 0 ? ` — the ${view.findings.length} most serious` : ''}</h2>
  ${view.findings.length === 0 ? '<p class="muted">No findings were published for this assessment.</p>' : findingsHtml}
  ${
    view.hiddenFindingCount > 0
      ? `<div class="callout"><h3>${view.hiddenFindingCount} further finding${view.hiddenFindingCount === 1 ? '' : 's'} not shown</h3>
         <p class="muted">A free report shows the three most serious findings. The full report adds:</p>
         <ul class="plain">${view.withheld.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
         <p class="muted">Your score is not affected by which report you buy. It is the same number either way.</p></div>`
      : ''
  }
</section>

${
  view.showPrioritisedPlan && source.narrative && source.narrative.prioritisedRemediation.length > 0
    ? `<section>
  <h2>What to fix, in order</h2>
  <p class="muted">Ordered by consequence to a real user, not by how interesting the defect is.</p>
  <ol class="plan">
    ${source.narrative.prioritisedRemediation
      .map(
        (item) => `<li>
        <strong>${escapeHtml(item.title)}</strong>
        <p class="muted">${escapeHtml(item.why)}</p>
        <p>${escapeHtml(item.step)}</p>
      </li>`,
      )
      .join('')}
  </ol>
</section>`
    : ''
}

<section>
  <h2>What was not assessed</h2>
  <p class="muted">Stated so that silence is not mistaken for a clean result.</p>
  <ul class="plain">
    ${
      (source.narrative?.notAssessed ?? [])
        .concat(
          source.stages
            .filter((stage) => stage.status !== 'succeeded')
            .map(
              (stage) =>
                `The ${stage.stage.replace(/_/g, ' ')} stage did not complete (${stage.status}).`,
            ),
        )
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('') || '<li>Everything within the authorised scope was assessed.</li>'
    }
  </ul>
</section>

<footer class="legend">
  <p>${escapeHtml(NON_RELIANCE_LEGEND)}</p>
  <p>Assessment ${escapeHtml(source.assessmentId)} · rubric v${escapeHtml(source.rubricVersion)} · prompt bundle <code>${escapeHtml(source.promptBundleSha256.slice(0, 16))}…</code></p>
  <p>Findings are limited to what was observable within the authorised scope. Absence of a finding is not evidence of absence of a defect.</p>
</footer>

</div>
</body>
</html>`;

  return { tier, html, title, withheld: view.withheld };
}
