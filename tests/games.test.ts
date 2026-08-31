/**
 * Games, assessed as games.
 *
 * Anré asked for a way in that is specifically for games, and for games to be
 * tested as games. The first half is a button and could have been faked: a
 * heading over the same assessment would have been marketing wearing the
 * clothes of a product. What is held here is that the button leads somewhere
 * that behaves differently, and that the difference stops exactly where it
 * should.
 *
 * The sharpest line in this feature is the one it refuses to cross. We do not
 * say whether a game is any good — not fun, not original, not pretty, not well
 * balanced. Those are taste, nobody can evidence them, and an assessment that
 * started handing out opinions on them would be worth less on everything else
 * it says.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { DEFAULT_STAGES } from '../packages/engine/src/pipeline.ts';
import { gameExperienceStage } from '../packages/engine/src/stages/model-stages.ts';
import type { StageContext } from '../packages/engine/src/stages/types.ts';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const collapse = (text: string) => text.replace(/\s+/g, ' ');

// Whitespace-collapsed: a sentence does not stop meaning what it means because
// the line wrapped in the middle of it.
const prompt = collapse(read('prompts/game-experience.md'));
const page = collapse(read('apps/web/app/games/page.tsx'));
const form = collapse(read('apps/web/app/console/apps/new/page.tsx'));

/** Just enough context for the stage to decide whether it applies. */
const contextFor = (overrides: {
  isGame: boolean;
  depth?: 'limited' | 'full' | 'continuous';
  primaryUrl?: string | null;
}) =>
  ({
    depth: overrides.depth ?? 'full',
    target: {
      appName: 'Kettle Quest',
      primaryUrl:
        overrides.primaryUrl === undefined ? 'https://game.example' : overrides.primaryUrl,
      isGame: overrides.isGame,
      appType: 'web_url',
    },
  }) as unknown as StageContext;

describe('when the game pass runs', () => {
  it('is in the pipeline at all', () => {
    expect(DEFAULT_STAGES.map((stage) => stage.id)).toContain('game_experience');
  });

  it('runs for a game', () => {
    expect(gameExperienceStage.appliesTo(contextFor({ isGame: true }))).toBe(true);
  });

  it('does not run for anything else', () => {
    expect(gameExperienceStage.appliesTo(contextFor({ isGame: false }))).toBe(false);
  });

  it('does not run on a free limited pass, which did not pay for playing', () => {
    expect(gameExperienceStage.appliesTo(contextFor({ isGame: true, depth: 'limited' }))).toBe(
      false,
    );
  });

  it('says why it was skipped in its own words', () => {
    // The pipeline's default explanation talks about the app type and the
    // depth. That is not why this one was skipped, and a report that says it is
    // has told the customer something false about their own run.
    expect(gameExperienceStage.skipReason?.(contextFor({ isGame: false }))).toMatch(
      /not registered as a game/i,
    );
    expect(
      gameExperienceStage.skipReason?.(contextFor({ isGame: true, depth: 'limited' })),
    ).toMatch(/limited run/i);
  });
});

describe('what the game pass is told to look for', () => {
  it('asks whether it becomes playable, not whether the page loads', () => {
    // The single most common way a game built quickly fails, and invisible to a
    // check that only asks whether the server answered.
    expect(prompt).toMatch(/become playable at all/i);
    expect(prompt).toMatch(/loading bar that never finishes/i);
  });

  it('asks what it costs to get to playable', () => {
    expect(prompt).toMatch(/bytes downloaded/i);
    expect(prompt).toMatch(/cached it on the first run/i);
  });

  it('asks whether a phone can play it', () => {
    expect(prompt).toMatch(/360px/);
    expect(prompt).toMatch(/touch/i);
  });

  it('asks whether progress survives', () => {
    expect(prompt).toMatch(/Reload mid-play/i);
  });

  it('refuses to judge whether the game is any good', () => {
    expect(prompt).toMatch(/not judging whether the game is any good/i);
    for (const word of ['fun', 'original', 'difficulty', 'taste']) {
      expect(prompt.toLowerCase(), word).toContain(word);
    }
  });

  it('forbids inventing a rule id', () => {
    // A report citing a rule the published rubric does not define is a score
    // nobody can check against the thing it claims to come from.
    expect(prompt).toMatch(/may not invent a rule id/i);
    expect(prompt).toMatch(/FI-01/);
  });
});

describe('the way in', () => {
  it('leads to the form with the game box already ticked', () => {
    // Somebody who came to have a game tested should not have to know which box
    // halfway down the form is the one that matters.
    expect(page).toContain('/console/apps/new?kind=game');
    expect(form).toContain("const isGame = kind === 'game'");
    expect(form).toContain('defaultChecked={isGame}');
  });

  it('says what it will not judge before it says what it checks', () => {
    // Somebody hoping for a verdict on their design should find out here, not
    // after paying for a report that carefully declines to give one.
    const refusal = page.indexOf('This is not a review');
    const checks = page.indexOf('What the game pass looks at');
    expect(refusal).toBeGreaterThan(-1);
    expect(checks).toBeGreaterThan(refusal);
  });

  it('promises no separate score, badge or easier pass mark', () => {
    expect(page).toMatch(/scored against the same/i);
    expect(page).toMatch(/no separate game score, no game badge, and no easier pass mark/i);
  });

  it('is reachable from the site navigation', () => {
    expect(read('apps/web/components/site-nav.tsx')).toContain("href: '/games'");
  });
});

describe('what a game is, to the database', () => {
  let db: Client;
  let account: SeededAccount;

  beforeAll(async () => {
    db = await connect();
    account = await seedAccount(db, 'games');
  });

  afterAll(async () => {
    await db?.end();
  });

  it('is a flag on the application, not a kind of target', () => {
    // A game is a web URL or a mobile build like anything else, reached and
    // authorised the same way. Adding a fourth app_type would have meant a game
    // could no longer also be a mobile build.
    expect(read('supabase/schema.sql')).toContain('is_game boolean not null default false');
    expect(read('supabase/schema.sql')).toContain(
      "create type public.app_type as enum ('web_url', 'repository', 'mobile_build')",
    );
  });

  it('defaults to false, so nothing already registered silently becomes a game', async () => {
    const { rows } = await db.query<{ is_game: boolean }>(
      `insert into public.apps (organisation_id, name, slug, app_type, primary_url, created_by)
       values ($1, 'Ordinary App', 'ordinary-app-games-test', 'web_url', 'https://a.example', $2)
       returning is_game`,
      [account.organisationId, account.userId],
    );
    expect(rows[0]!.is_game).toBe(false);
  });

  it('records the game stage under a name the database knows', async () => {
    // `run_stage` is a closed set on purpose: a stage name that could be any
    // string is a stage name that will be two spellings by the time anybody
    // queries it.
    const { rows } = await db.query<{ ok: boolean }>(
      `select 'game_experience' = any(enum_range(null::public.run_stage)::text[]) as ok`,
    );
    expect(rows[0]!.ok).toBe(true);
  });
});
