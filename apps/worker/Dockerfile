# The assessment worker.
#
# Built from Playwright's own image rather than from a plain Node base, because
# the hard part of running a browser on a server is not the browser — it is the
# forty shared libraries it links against. That image already carries them, and
# already carries the Chromium build matching the pinned Playwright version. A
# mismatch between the two is a launch failure with a message about a missing
# `.so`, which is a bad way to spend an evening.
#
# The tag tracks `playwright` in apps/worker/package.json. When that version
# moves, this moves with it — `tests/deployment.test.ts` fails if they drift.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# pnpm comes from the `packageManager` field via corepack, so the version here
# and the version in CI are the same one.
RUN corepack enable

# The manifests first, so a change to source code does not re-resolve the whole
# dependency tree. This is a workspace, so every package's manifest has to be
# present before `pnpm install` can build the graph.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages ./packages
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/

# `--frozen-lockfile` so a deploy that would have changed the lockfile fails
# here rather than quietly shipping different dependencies from the ones that
# passed CI.
RUN pnpm install --frozen-lockfile --filter @vibefycode/worker...

COPY . .

# The browsers live at this path in the base image. The engine reads it, and
# without it Playwright looks in the home directory of whichever user the
# platform decided to run as and finds nothing.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production

# Reports are written here before they are uploaded. A container's disk is
# ephemeral and that is correct: nothing in this directory is the record.
ENV VIBEFYCODE_REPORT_DIR=/tmp/vibefycode-reports

# No build step. The worker runs its TypeScript directly through tsx, which is
# how it runs in development — one fewer artefact that can differ between them.
CMD ["pnpm", "--filter", "@vibefycode/worker", "start"]
