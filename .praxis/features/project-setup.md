# Project Setup

The principle: **one command, fully working project**. Running `./scripts/init.sh <project-name>` takes a fresh clone of the template and produces a deployed, running application — local dev environment, production deployment, DNS, auth, and mobile build config all configured.

## The Principle

Everything the application needs to work should be configured by `init.sh`. If a new feature requires configuration to function (env vars, external service credentials, DNS records, deployment manifests, ingress rules), that configuration must be added to `init.sh` — not documented as a manual step.

The goal is zero manual setup beyond running the script. A developer clones the template, runs one command with a project name, and gets:

- Local `.env` with all required variables populated
- Deployment env files generated and copied to the server
- Auth0 callback URLs updated for the new domain
- DNS A record created pointing to the server
- K8s ingress rules added for the new domain
- Mobile app identifiers and EAS project configured
- Initial commit pushed, deploy workflows triggered

If any of these steps fail, the script prints clear instructions for manual resolution — but the intent is that they don't fail.

## When to Update init.sh

Update `init.sh` whenever you:

- **Add an env var** that the API or web app needs at runtime. Add it to both the local `.env` template (Step 2) and the deployment env file (Step 3). If it needs a secret, generate one with `openssl rand`.
- **Add an external service** that needs API keys or credentials. Prompt for the credentials during first-time setup (the `DEFAULTS_FILE` section) so they're saved once and reused across projects.
- **Add a new deployed package** that needs its own K8s deployment, Docker image, or env file. Add the relevant file generation and deployment trigger steps.
- **Add a new domain or subdomain** that needs DNS and ingress rules. Extend Steps 7 and 8.
- **Change the Auth0 setup** — new callback URLs, new scopes, or a new application type. Update Step 5.

The test: if someone runs `init.sh` on a fresh clone, will the new feature work? If not, `init.sh` needs updating.

## How It Works

The script runs 10 steps in sequence. Each step prints its number and what it's doing. If a step fails, it prints a warning and continues — so partial failures don't block the rest of the setup.

| Step | What it does |
|---|---|
| Prerequisites | Checks for required tools (node, pnpm, docker, gh, git, openssl, curl) |
| Credential check | Sources `~/.config/trpc-template/defaults.env` and checks each credential group (Auth0, GoDaddy, server IP, M2M, push notifications). Only prompts for groups that are missing — existing credentials are reused silently. New features can add credential groups and existing installs get prompted on next run. |
| 1 | Replaces `@wanshitong/` scope with `@<project-name>/` in all source files |
| 2 | Creates local `.env` with database credentials, Auth0 config, and API settings |
| 3 | Creates deployment env files in `~/envs/` for the K8s deploy workflows |
| 4 | Copies deployment env files to the server (scp, or local cp if running on homebase) |
| 5 | Adds the new project domain to the shared Auth0 SPA's allowed URLs via Management API |
| 6 | Initializes an EAS project for mobile builds |
| 7 | Creates a GoDaddy DNS A record for `<project-name>.tylermakes.art` |
| 8 | Clones k8s-ingress repo, adds TLS host + routing rules, pushes (auto-deploys) |
| 9 | Configures push notifications (Expo token, APNs credentials from saved defaults) |
| 10 | Adds a `template` git remote for pulling future template updates |
| 11 | Commits, pushes, triggers all three deploy workflows |

### Credentials are incremental

On each run, init.sh sources `~/.config/trpc-template/defaults.env` and checks each credential group. It only prompts for groups that are **missing** — credentials already saved are reused silently. Secrets (GoDaddy, Expo token) go in macOS Keychain; everything else goes in `defaults.env`.

This means when a new feature adds a credential group (e.g., push notifications was added after Auth0/GoDaddy), existing installs get prompted for just the new credentials on their next run — without re-entering anything that's already saved.

#### How to add a new credential group

Follow this pattern in init.sh:

```bash
# ── New Service (prompt if missing) ──
if [ -z "${NEW_SERVICE_KEY:-}" ]; then
  echo "── New Service (not yet configured) ───────────────────────"
  echo "  Instructions for where to get this credential."
  echo ""
  read -p "New Service API Key: " NEW_SERVICE_KEY
  if [ -n "$NEW_SERVICE_KEY" ]; then
    # For secrets: store in Keychain
    store_keychain "new-service-key" "$NEW_SERVICE_KEY"
    # For non-secrets: will be written to defaults.env below
  fi
  echo ""
  DEFAULTS_CHANGED=true
fi
```

Then add the variable to the `cat > "$DEFAULTS_FILE"` block:

```bash
NEW_SERVICE_KEY=${NEW_SERVICE_KEY:-}
```

And load Keychain secrets after sourcing defaults:

```bash
NEW_SERVICE_SECRET=$(read_keychain "new-service-key" 2>/dev/null || echo "")
```

The key rules:
1. **Check if missing** with `[ -z "${VAR:-}" ]` — the `:-` prevents unbound variable errors
2. **Set `DEFAULTS_CHANGED=true`** so the file gets rewritten with the new values
3. **Secrets go in Keychain** via `store_keychain`, non-secrets go in `defaults.env`
4. **Always allow skipping** with Enter for optional credentials (like push)

### Failures are non-blocking

Each step uses `|| echo "WARNING: ..."` patterns so a failure (e.g., can't reach the server for scp, GoDaddy API returns an error) prints a warning with manual instructions but doesn't abort the script. The final summary shows what succeeded and what needs manual attention.

## Related

- [Environment Validation](./env-validation.md) — How env vars are validated at API startup
- [CI/CD](./ci-cd.md) — The deploy workflows that init.sh triggers
- [Authentication](./authentication.md) — Auth0 setup that init.sh configures
