# CI/CD

GitHub Actions handles both PR checks and production deploys. All workflows run on a self-hosted runner (Mac mini at `homebase.lan`).

## CI Workflow (Pull Requests)

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: corepack enable
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm test
```

Every PR to `main` must pass build + typecheck + tests before merging.

## Deploy Workflows (Push to Main)

Three workflows, each with path filters so only affected packages deploy. All three also support `workflow_dispatch` for manual triggers:

### deploy-api.yml
Triggers on changes to `packages/api/**` or `packages/shared/**`:
1. Builds Docker image tagged with git SHA
2. Creates K8s secret from env file (`/Users/tylersmith/envs/<repo-name>.env`)
3. Applies K8s deployment manifest
4. Waits for rollout (120s timeout)

### deploy-web.yml
Triggers on changes to `packages/web/**`, `packages/hooks/**`, or `packages/shared/**`:
1. Loads `VITE_*` env vars from env file (`/Users/tylersmith/envs/<repo-name>.env`)
2. Builds Docker image with Vite build args, tagged with git SHA
3. Applies K8s deployment manifest
4. Waits for rollout (120s timeout)

### deploy-infra.yml
Triggers on changes to `.k8s/**`. Manages the PostgreSQL secret (created from `/Users/tylersmith/envs/<repo-name>-postgres.env`) and deploys the PostgreSQL K8s deployment. Waits for rollout (120s timeout).

## How to Implement

### Add a new CI step

Edit `.github/workflows/ci.yml`. Example — add a lint step:

```yaml
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm lint        # add here
      - run: pnpm test
```

### Add a new deploy workflow

Create a new file in `.github/workflows/`:

```yaml
# .github/workflows/deploy-worker.yml
name: Deploy Worker

on:
  push:
    branches: [main]
    paths:
      - "packages/worker/**"

jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - name: Set environment variables
        run: |
          echo "REPO_NAME=$(basename $GITHUB_REPOSITORY)" >> $GITHUB_ENV
          echo "GIT_SHA=$(git rev-parse --short HEAD)" >> $GITHUB_ENV
      - name: Build Docker image
        run: docker build -f packages/worker/Dockerfile -t ${{ env.REPO_NAME }}-worker:${{ env.GIT_SHA }} .
      - name: Deploy to Kubernetes
        run: |
          sed -e "s|<REPO_NAME>|${{ env.REPO_NAME }}|g" \
              -e "s|<IMAGE_NAME>|${{ env.REPO_NAME }}-worker:${{ env.GIT_SHA }}|g" \
              .k8s/worker-deployment.yml | kubectl apply -f -
      - name: Verify rollout
        run: kubectl rollout status deployment/${{ env.REPO_NAME }}-worker --timeout=120s
```

### Add a script to CI

1. Add the script to the relevant `package.json`
2. Add a Turbo task in `turbo.json` if it should run across packages
3. Add the step to `ci.yml`

## How to Test

CI changes are tested by creating a PR. The workflow triggers automatically.

To test locally before pushing:

```bash
pnpm build && pnpm typecheck && pnpm test
```

This mirrors exactly what CI runs.

## How to Debug

- **CI failed on "pnpm install"?** Usually a lockfile mismatch. Run `pnpm install` locally and commit the updated `pnpm-lock.yaml`.
- **Build passes locally but fails in CI?** CI uses `--frozen-lockfile`, which is stricter. Also check for OS-specific issues (CI runs on macOS/ARM via the self-hosted runner).
- **Deploy succeeded but app is broken?** Check `kubectl logs deployment/<repo-name>-api` on homebase. The rollout status check only verifies pods are running, not that the app is healthy.
- **Workflow didn't trigger?** Check the path filters. Changes to `packages/shared` trigger both API and web deploys. Changes to `packages/hooks` trigger web deploy. Changes outside `packages/` (and `.k8s/`) don't trigger any deploy. All deploy workflows also support `workflow_dispatch` for manual runs.
- **All workflows queue sequentially?** The self-hosted runner is a single Mac mini — only one job runs at a time. Workflows across all repos queue. This is by design.
- **Rollout timeout (120s)?** Usually means the pod is crash-looping. Check logs: `kubectl logs deployment/<repo-name>-api --previous` to see the crash output.
- **K8s secret issues?** The env file must exist at `/Users/tylersmith/envs/<repo-name>.env` on the runner. If it's missing, `init.sh` wasn't run for this project.
