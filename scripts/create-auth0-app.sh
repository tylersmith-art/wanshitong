#!/bin/bash
set -e

# Creates a dedicated Auth0 SPA application and API for this project.
# Only needed when you want to isolate a project from the shared Auth0 app.
# Requires: auth0 CLI (brew install auth0-cli)

if [ -z "$1" ]; then
  echo "Usage: ./scripts/create-auth0-app.sh <project-name>"
  echo ""
  echo "Creates a dedicated Auth0 SPA application and API for this project."
  echo "Updates the local .env and deployment env files with the new credentials."
  exit 1
fi

PROJECT_NAME="$1"
DOMAIN_SUFFIX="tylermakes.art"
PROJECT_DOMAIN="${PROJECT_NAME}.${DOMAIN_SUFFIX}"
LOCAL_ENV_DIR="$HOME/Documents/envs"
REMOTE_HOST="tylersmith@homebase.local"
REMOTE_ENV_DIR="~/envs"

# Check auth0 CLI
if ! command -v auth0 &> /dev/null; then
  echo "Error: auth0 CLI not found. Install with: brew install auth0-cli"
  echo "Then authenticate with: auth0 login"
  exit 1
fi

echo "Creating dedicated Auth0 resources for: ${PROJECT_NAME}"
echo ""

# Create API
echo "[1/4] Creating Auth0 API..."
API_OUTPUT=$(auth0 apis create \
  --name "${PROJECT_NAME}-api" \
  --identifier "https://${PROJECT_DOMAIN}/api" \
  --scopes "read:users,write:users" \
  --json 2>&1)

AUTH0_AUDIENCE=$(echo "$API_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['identifier'])" 2>/dev/null) || \
  AUTH0_AUDIENCE="https://${PROJECT_DOMAIN}/api"

echo "  API Identifier: ${AUTH0_AUDIENCE}"

# Create SPA Application
echo "[2/4] Creating Auth0 SPA Application..."
APP_OUTPUT=$(auth0 apps create \
  --name "${PROJECT_NAME}" \
  --type spa \
  --callbacks "https://${PROJECT_DOMAIN},http://localhost:3000" \
  --logout-urls "https://${PROJECT_DOMAIN},http://localhost:3000" \
  --origins "https://${PROJECT_DOMAIN},http://localhost:3000" \
  --json 2>&1)

AUTH0_CLIENT_ID=$(echo "$APP_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['client_id'])" 2>/dev/null)
AUTH0_DOMAIN=$(echo "$APP_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('domain',''))" 2>/dev/null)

if [ -z "$AUTH0_CLIENT_ID" ]; then
  echo "  ERROR: Failed to create Auth0 app. Check auth0 CLI auth."
  echo "  Output: ${APP_OUTPUT}"
  exit 1
fi

echo "  Client ID: ${AUTH0_CLIENT_ID}"
echo "  Domain: ${AUTH0_DOMAIN}"

# Update env files
echo "[3/4] Updating env files..."

update_env_var() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
  fi
}

for ENV_FILE in .env "${LOCAL_ENV_DIR}/${PROJECT_NAME}.env"; do
  if [ -f "$ENV_FILE" ]; then
    update_env_var "$ENV_FILE" "AUTH0_AUDIENCE" "$AUTH0_AUDIENCE"
    update_env_var "$ENV_FILE" "VITE_AUTH0_DOMAIN" "$AUTH0_DOMAIN"
    update_env_var "$ENV_FILE" "VITE_AUTH0_CLIENT_ID" "$AUTH0_CLIENT_ID"
    update_env_var "$ENV_FILE" "VITE_AUTH0_AUDIENCE" "$AUTH0_AUDIENCE"
    update_env_var "$ENV_FILE" "AUTH0_ISSUER_BASE_URL" "https://${AUTH0_DOMAIN}"
    echo "  Updated ${ENV_FILE}"
  fi
done

# Copy updated env to remote
echo "[4/4] Syncing to ${REMOTE_HOST}..."

scp "${LOCAL_ENV_DIR}/${PROJECT_NAME}.env" \
    "${REMOTE_HOST}:${REMOTE_ENV_DIR}/${PROJECT_NAME}.env" 2>/dev/null && \
  echo "  Copied ${PROJECT_NAME}.env" || \
  echo "  WARNING: Could not reach ${REMOTE_HOST}. Copy manually later."

echo ""
echo "Done! This project now has its own Auth0 application."
echo "  API:       ${AUTH0_AUDIENCE}"
echo "  Client ID: ${AUTH0_CLIENT_ID}"
echo "  Domain:    ${AUTH0_DOMAIN}"
