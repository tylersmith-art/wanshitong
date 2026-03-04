#!/bin/bash
set -e

# ─── Colors ──────────────────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

step() { echo -e "\n${BOLD}${CYAN}[$1]${NC} $2"; }
ok()   { echo -e "  ${GREEN}OK${NC} $1"; }
warn() { echo -e "  ${YELLOW}WARNING${NC} $1"; }
err()  { echo -e "  ${RED}ERROR${NC} $1"; }
info() { echo -e "  ${DIM}$1${NC}"; }

# ─── Config ──────────────────────────────────────────────────────────
DEFAULTS_FILE="$HOME/.config/trpc-template/defaults.env"
DOMAIN_SUFFIX="tylermakes.art"
REMOTE_HOST="tylersmith@homebase.local"
REMOTE_ENV_DIR="~/envs"
LOCAL_ENV_DIR="$HOME/envs"
INGRESS_REPO="git@github.com:tylersmith-art/k8s-ingress.git"
# ─────────────────────────────────────────────────────────────────────

OVERRIDE_IP=""
EXPO_TOKEN=""
APNS_KEY_PATH=""
APNS_KEY_ID=""
APNS_TEAM_ID=""
GOOGLE_SERVICES_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ip) OVERRIDE_IP="$2"; shift 2 ;;
    --expo-token) EXPO_TOKEN="$2"; shift 2 ;;
    --expo-token=*) EXPO_TOKEN="${1#*=}"; shift ;;
    --apns-key-path) APNS_KEY_PATH="$2"; shift 2 ;;
    --apns-key-path=*) APNS_KEY_PATH="${1#*=}"; shift ;;
    --apns-key-id) APNS_KEY_ID="$2"; shift 2 ;;
    --apns-key-id=*) APNS_KEY_ID="${1#*=}"; shift ;;
    --apns-team-id) APNS_TEAM_ID="$2"; shift 2 ;;
    --apns-team-id=*) APNS_TEAM_ID="${1#*=}"; shift ;;
    --google-services-path) GOOGLE_SERVICES_PATH="$2"; shift 2 ;;
    --google-services-path=*) GOOGLE_SERVICES_PATH="${1#*=}"; shift ;;
    --help|-h)
      echo "Usage: ./scripts/init.sh <project-name> [options]"
      echo ""
      echo "Options:"
      echo "  --ip <ip>                    Override the server IP for the DNS A record"
      echo "  --expo-token <token>         Set Expo push access token (enables push notifications)"
      echo "  --apns-key-path <path>       Path to APNs .p8 key file (used with eas credentials)"
      echo "  --apns-key-id <id>           APNs key ID (used with --apns-key-path)"
      echo "  --apns-team-id <id>          Apple Team ID (used with --apns-key-path)"
      echo "  --google-services-path <p>   Path to google-services.json for FCM"
      echo ""
      echo "This script will:"
      echo "  1. Replace all template placeholders"
      echo "  2. Generate database credentials"
      echo "  3. Create .env files (local + deployment)"
      echo "  4. Copy env files to ${REMOTE_HOST}:${REMOTE_ENV_DIR}/"
      echo "  5. Add project domain to shared Auth0 SPA allowed URLs"
      echo "  6. Initialize EAS project for mobile builds"
      echo "  7. Create a GoDaddy DNS A record for the subdomain"
      echo "  8. Update K8s ingress rules and push"
      echo "  9. Configure push notifications (if flags provided)"
      echo " 10. Add template remote for future updates"
      echo " 11. Commit, push, and trigger deploy workflows"
      exit 0 ;;
    *) PROJECT_NAME="$1"; shift ;;
  esac
done

if [ -z "$PROJECT_NAME" ]; then
  echo "Usage: ./scripts/init.sh <project-name> [--ip <server-ip>]"
  echo "Run with --help for details."
  exit 1
fi

# ─── Check prerequisites ────────────────────────────────────────────
MISSING=()

check_tool() {
  local name="$1" install="$2"
  if ! command -v "$name" &> /dev/null; then
    MISSING+=("  $name  →  $install")
  fi
}

check_tool "node"    "https://nodejs.org"
check_tool "pnpm"    "corepack enable"
check_tool "docker"  "https://docker.com/products/docker-desktop"
check_tool "gh"      "brew install gh"
check_tool "git"     "https://git-scm.com"
check_tool "openssl" "(should be pre-installed on macOS)"
check_tool "curl"    "(should be pre-installed on macOS)"

if [ ${#MISSING[@]} -gt 0 ]; then
  err "Missing required tools:"
  echo ""
  for m in "${MISSING[@]}"; do
    echo "$m"
  done
  echo ""
  echo "  Install the missing tools above, then re-run this script."
  exit 1
fi

ok "All prerequisite tools found"

# Auto-install optional tools that can be added without user intervention
if ! command -v eas &> /dev/null; then
  info "Installing eas-cli (needed for mobile builds and push credentials)..."
  npm install -g eas-cli && ok "eas-cli installed" || warn "Failed to install eas-cli"
fi
echo ""

SCOPE="@${PROJECT_NAME}"
DB_USER="${PROJECT_NAME//-/_}_user"
DB_NAME="${PROJECT_NAME//-/_}"
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)
PROJECT_DOMAIN="${PROJECT_NAME}.${DOMAIN_SUFFIX}"

echo ""
echo -e "${BOLD}Project Initialization — ${PROJECT_NAME}${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Domain: ${PROJECT_DOMAIN}"

# ─── Keychain helpers (GoDaddy credentials) ─────────────────────────
KEYCHAIN_SERVICE="trpc-template-godaddy"

store_keychain() {
  local account="$1" value="$2"
  security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$account" 2>/dev/null || true
  security add-generic-password -s "$KEYCHAIN_SERVICE" -a "$account" -w "$value"
}

read_keychain() {
  local account="$1"
  security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$account" -w 2>/dev/null
}

# ─── Detect public IP ───────────────────────────────────────────────
detect_public_ip() {
  curl -s --max-time 5 https://ifconfig.me 2>/dev/null || \
  curl -s --max-time 5 https://api.ipify.org 2>/dev/null || \
  echo ""
}

# ─── Load defaults and prompt for missing credentials ────────────────
# Pattern: source existing defaults, then check each credential group.
# Only prompt for groups that are missing. This way new features can add
# credential blocks and existing installs get prompted on next run —
# without re-asking for credentials that are already saved.
mkdir -p "$(dirname "$DEFAULTS_FILE")"

# Save CLI flag values before source potentially overwrites them
CLI_EXPO_TOKEN="$EXPO_TOKEN"
CLI_APNS_KEY_PATH="$APNS_KEY_PATH"
CLI_APNS_KEY_ID="$APNS_KEY_ID"
CLI_APNS_TEAM_ID="$APNS_TEAM_ID"

# Source existing defaults (may be empty or missing some fields)
if [ -f "$DEFAULTS_FILE" ]; then
  source "$DEFAULTS_FILE"
fi

# Load secrets from env vars first, then fall back to Keychain
GODADDY_API_KEY="${GODADDY_API_KEY:-$(read_keychain "api-key" 2>/dev/null || echo "")}"
GODADDY_API_SECRET="${GODADDY_API_SECRET:-$(read_keychain "api-secret" 2>/dev/null || echo "")}"
SAVED_EXPO_TOKEN="${EXPO_TOKEN:-${SAVED_EXPO_TOKEN:-$(read_keychain "expo-token" 2>/dev/null || echo "")}}"

DEFAULTS_CHANGED=false

# ── Auth0 (prompt if missing) ──
if [ -z "${AUTH0_DOMAIN:-}" ] || [ -z "${AUTH0_CLIENT_ID:-}" ] || [ -z "${AUTH0_AUDIENCE_BASE:-}" ]; then
  echo "── Auth0 (not yet configured) ─────────────────────────────"
  echo "  Do you have an existing Auth0 SPA application, or should"
  echo "  we create one now using the Auth0 CLI?"
  echo ""
  echo "  1) I have an existing SPA — I'll enter the credentials"
  echo "  2) Create a new shared SPA + API for me"
  echo ""
  read -p "Choose [1/2]: " AUTH0_CHOICE

  if [ "$AUTH0_CHOICE" = "2" ]; then
    echo ""
    echo "  Creating shared Auth0 resources via CLI..."
    echo "  (Make sure you've run 'auth0 login' first)"
    echo ""

    read -p "App name (e.g., shared-spa): " AUTH0_APP_NAME
    AUTH0_APP_NAME="${AUTH0_APP_NAME:-shared-spa}"

    read -p "API identifier / audience base URL (e.g., https://api.tylermakes.art): " AUTH0_AUDIENCE_BASE

    # Create API
    echo ""
    echo "  Creating Auth0 API: ${AUTH0_APP_NAME}-api"
    echo "    Identifier: ${AUTH0_AUDIENCE_BASE}"
    echo ""
    auth0 apis create \
      --name "${AUTH0_APP_NAME}-api" \
      --identifier "${AUTH0_AUDIENCE_BASE}" \
      --no-input \
      --json && \
      echo "" && echo "  API created." || \
      echo "  API creation returned an error (may already exist)."
    echo ""

    # Create SPA (capture only stdout for clean JSON; hints go to terminal via stderr)
    echo "  Creating Auth0 SPA Application: ${AUTH0_APP_NAME}"
    echo ""
    APP_OUTPUT=$(auth0 apps create \
      --name "${AUTH0_APP_NAME}" \
      --type spa \
      --callbacks "http://localhost:3000" \
      --logout-urls "http://localhost:3000" \
      --origins "http://localhost:3000" \
      --no-input \
      --json)

    echo "$APP_OUTPUT"
    echo ""

    AUTH0_CLIENT_ID=$(echo "$APP_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['client_id'])" 2>/dev/null)

    # Domain isn't in the JSON response — get it from the current tenant
    AUTH0_DOMAIN=$(auth0 tenants list --json --no-input 2>/dev/null | python3 -c "
import sys, json
tenants = json.load(sys.stdin)
print(tenants[0]['name'] if tenants else '')
" 2>/dev/null)

    if [ -z "$AUTH0_CLIENT_ID" ] || [ -z "$AUTH0_DOMAIN" ]; then
      echo "  Could not auto-detect all credentials."
      echo ""
      if [ -n "$AUTH0_CLIENT_ID" ]; then
        echo "  Client ID: ${AUTH0_CLIENT_ID} (detected)"
      else
        read -p "Auth0 SPA Client ID: " AUTH0_CLIENT_ID
      fi
      if [ -z "$AUTH0_DOMAIN" ]; then
        read -p "Auth0 Domain (e.g., dev-xxx.us.auth0.com): " AUTH0_DOMAIN
      fi
    else
      echo "  SPA created!"
      echo "    Domain:    ${AUTH0_DOMAIN}"
      echo "    Client ID: ${AUTH0_CLIENT_ID}"
      echo "    Audience:  ${AUTH0_AUDIENCE_BASE}"
    fi
  else
    echo ""
    echo "  Where to find these values:"
    echo "    Domain:    Auth0 Dashboard top-left, or Settings → General"
    echo "    Client ID: Applications → your SPA app → Settings"
    echo "    Audience:  Applications → APIs → your API → Identifier"
    echo ""
    read -p "Auth0 Domain (e.g., dev-xxx.us.auth0.com): " AUTH0_DOMAIN
    read -p "Auth0 SPA Client ID: " AUTH0_CLIENT_ID
    read -p "Auth0 Audience base URL (e.g., https://api.tylermakes.art): " AUTH0_AUDIENCE_BASE
  fi
  echo ""
  DEFAULTS_CHANGED=true
fi

# ── Auth0 M2M (prompt if missing) ──
if [ -z "${AUTH0_M2M_CLIENT_ID:-}" ] || [ -z "${AUTH0_M2M_CLIENT_SECRET:-}" ]; then
  echo "── Auth0 M2M (not yet configured) ─────────────────────────"
  echo "  The init script uses an Auth0 Machine-to-Machine app to"
  echo "  update allowed URLs without requiring interactive login."
  echo ""
  echo "  If you already have one (e.g., 'praxis-init-script'),"
  echo "  enter its credentials. Otherwise, create one first:"
  echo "    1. Auth0 Dashboard → Applications → Create Application"
  echo "    2. Choose 'Machine to Machine'"
  echo "    3. Authorize it for the 'Auth0 Management API' with"
  echo "       scopes: read:clients, update:clients"
  echo "    4. Copy the Client ID and Client Secret from Settings"
  echo ""
  read -p "Auth0 M2M Client ID: " AUTH0_M2M_CLIENT_ID
  read -s -p "Auth0 M2M Client Secret: " AUTH0_M2M_CLIENT_SECRET
  echo ""
  echo ""
  DEFAULTS_CHANGED=true
fi

# ── GoDaddy (prompt if missing) ──
if [ -z "$GODADDY_API_KEY" ] || [ -z "$GODADDY_API_SECRET" ]; then
  echo "── GoDaddy DNS (not yet configured) ───────────────────────"
  echo "  1. Go to https://developer.godaddy.com/keys"
  echo "  2. Create a Production API key (secret is shown only once)"
  echo ""
  read -p "GoDaddy API Key: " GODADDY_API_KEY
  read -s -p "GoDaddy API Secret: " GODADDY_API_SECRET
  echo ""
  store_keychain "api-key" "$GODADDY_API_KEY"
  store_keychain "api-secret" "$GODADDY_API_SECRET"
  echo "  GoDaddy credentials saved to macOS Keychain."
  echo ""
  DEFAULTS_CHANGED=true
fi

# ── Server IP (prompt if missing) ──
if [ -z "${SERVER_IP:-}" ]; then
  echo "── Server IP (not yet configured) ─────────────────────────"
  echo "  The DNS A record needs your server's public IPv4 address."
  echo "  To find it on the server: curl ifconfig.me"
  echo ""
  DETECTED_IP=$(detect_public_ip)
  if [ -n "$DETECTED_IP" ]; then
    read -p "Server public IP [${DETECTED_IP}]: " SERVER_IP_INPUT
    SERVER_IP="${SERVER_IP_INPUT:-$DETECTED_IP}"
  else
    read -p "Server public IP (for DNS A record): " SERVER_IP
  fi
  echo ""
  DEFAULTS_CHANGED=true
fi

# ── Push Notifications (prompt if missing) ──
if [ -z "$SAVED_EXPO_TOKEN" ] && [ -z "${APNS_KEY_ID:-}" ]; then
  echo "── Push Notifications (not yet configured) ────────────────"
  echo "  Push requires an Expo access token and Apple credentials."
  echo "  These are shared across all apps under your accounts."
  echo "  (Press Enter to skip if you don't have these yet.)"
  echo ""
  read -p "Expo access token: " NEW_EXPO_TOKEN
  if [ -n "$NEW_EXPO_TOKEN" ]; then
    store_keychain "expo-token" "$NEW_EXPO_TOKEN"
    SAVED_EXPO_TOKEN="$NEW_EXPO_TOKEN"
    echo "  Expo token saved to macOS Keychain."
    echo ""
    read -p "APNs Key ID (10-char alphanumeric): " APNS_KEY_ID
    read -p "Apple Team ID (10-char alphanumeric): " APNS_TEAM_ID
    read -p "Path to APNs .p8 key file: " INPUT_APNS_KEY_PATH
    if [ -n "$INPUT_APNS_KEY_PATH" ] && [ -f "$INPUT_APNS_KEY_PATH" ]; then
      SHARED_APNS_DIR="$HOME/.config/trpc-template"
      cp "$INPUT_APNS_KEY_PATH" "$SHARED_APNS_DIR/apns-key.p8"
      chmod 600 "$SHARED_APNS_DIR/apns-key.p8"
      APNS_KEY_PATH="$SHARED_APNS_DIR/apns-key.p8"
      echo "  APNs key copied to ${APNS_KEY_PATH}"
    fi
  else
    echo "  Skipped. Push will use console adapter (in-app toasts still work)."
    echo "  Push credentials will be prompted again on next run."
  fi
  echo ""
  DEFAULTS_CHANGED=true
fi

# ── Save defaults if anything changed ──
if [ "$DEFAULTS_CHANGED" = true ]; then
  cat > "$DEFAULTS_FILE" <<DEFAULTS
AUTH0_DOMAIN=${AUTH0_DOMAIN:-}
AUTH0_CLIENT_ID=${AUTH0_CLIENT_ID:-}
AUTH0_AUDIENCE_BASE=${AUTH0_AUDIENCE_BASE:-}
AUTH0_M2M_CLIENT_ID=${AUTH0_M2M_CLIENT_ID:-}
AUTH0_M2M_CLIENT_SECRET=${AUTH0_M2M_CLIENT_SECRET:-}
SERVER_IP=${SERVER_IP:-}
GODADDY_API_KEY=${GODADDY_API_KEY:-}
GODADDY_API_SECRET=${GODADDY_API_SECRET:-}
EXPO_TOKEN=${SAVED_EXPO_TOKEN:-}
APNS_KEY_ID=${APNS_KEY_ID:-}
APNS_TEAM_ID=${APNS_TEAM_ID:-}
APNS_KEY_PATH=${APNS_KEY_PATH:-}
DEFAULTS

  chmod 600 "$DEFAULTS_FILE"
  ok "Saved to ${DEFAULTS_FILE} (reused for all future projects)"
  echo ""
fi

# CLI flags override saved defaults
if [ -n "$CLI_EXPO_TOKEN" ]; then EXPO_TOKEN="$CLI_EXPO_TOKEN"
elif [ -n "$SAVED_EXPO_TOKEN" ]; then EXPO_TOKEN="$SAVED_EXPO_TOKEN"
fi
if [ -n "$CLI_APNS_KEY_PATH" ]; then APNS_KEY_PATH="$CLI_APNS_KEY_PATH"; fi
if [ -n "$CLI_APNS_KEY_ID" ]; then APNS_KEY_ID="$CLI_APNS_KEY_ID"; fi
if [ -n "$CLI_APNS_TEAM_ID" ]; then APNS_TEAM_ID="$CLI_APNS_TEAM_ID"; fi

# Allow --ip flag to override SERVER_IP for this project
if [ -n "$OVERRIDE_IP" ]; then
  SERVER_IP="$OVERRIDE_IP"
fi

AUTH0_AUDIENCE="${AUTH0_AUDIENCE_BASE}"

# ─── Step 1: Replace template placeholders ───────────────────────────
step "1/11" "Replacing template placeholders..."

# Covers source code, configs, and documentation (including .praxis/features/*.md)
find . -type f \( -name "*.json" -o -name "*.ts" -o -name "*.tsx" -o -name "*.vue" -o -name "*.yml" -o -name "*.yaml" -o -name "*.md" -o -name "*.js" -o -name "Dockerfile" \) \
  ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" \
  -exec sed -i '' "s|@template/|${SCOPE}/|g" {} +

find . -type f \( -name "*.yml" -o -name "*.yaml" \) \
  ! -path "*/node_modules/*" ! -path "*/.git/*" \
  -exec sed -i '' "s|<REPO_NAME>|${PROJECT_NAME}|g" {} +

sed -i '' "s|\"trpc-template\"|\"${PROJECT_NAME}\"|g" package.json

sed -i '' "s|template_db|${DB_NAME}|g" docker-compose.yml
sed -i '' "s|template_user|${DB_USER}|g" docker-compose.yml
sed -i '' "s|template_pass|${DB_PASSWORD}|g" docker-compose.yml

# Mobile app placeholders
APP_DISPLAY_NAME=$(echo "$PROJECT_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1')
BUNDLE_ID_SUFFIX=$(echo "$PROJECT_NAME" | tr -d '-')
APP_SCHEME=$(echo "$PROJECT_NAME" | tr -d '-')

sed -i '' "s|TEMPLATE_APP_NAME|${APP_DISPLAY_NAME}|g" packages/mobile/app.json
sed -i '' "s|TEMPLATE_SLUG|${PROJECT_NAME}-mobile|g" packages/mobile/app.json
sed -i '' "s|TEMPLATE_SCHEME|${APP_SCHEME}|g" packages/mobile/app.json
sed -i '' "s|TEMPLATE_SCHEME|${APP_SCHEME}|g" packages/mobile/src/lib/auth.ts
sed -i '' "s|art.tylermakes.TEMPLATE_BUNDLE|art.tylermakes.${BUNDLE_ID_SUFFIX}|g" packages/mobile/app.json
sed -i '' "s|TEMPLATE_DOMAIN|${PROJECT_DOMAIN}|g" packages/mobile/app.json
sed -i '' "s|TEMPLATE_DOMAIN|${PROJECT_DOMAIN}|g" packages/mobile/app/_layout.tsx
sed -i '' "s|TEMPLATE_AUTH0_DOMAIN|${AUTH0_DOMAIN}|g" packages/mobile/app.json
sed -i '' "s|TEMPLATE_AUTH0_CLIENT_ID|${AUTH0_CLIENT_ID}|g" packages/mobile/app.json
sed -i '' "s|TEMPLATE_AUTH0_AUDIENCE|${AUTH0_AUDIENCE}|g" packages/mobile/app.json

ok "Placeholders replaced"

# ─── Step 2: Generate local .env ─────────────────────────────────────
step "2/11" "Creating local .env..."

cat > .env <<ENV
# Database (local docker compose)
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}

# Auth0
AUTH0_ISSUER_BASE_URL=https://${AUTH0_DOMAIN}
AUTH0_AUDIENCE=${AUTH0_AUDIENCE}

# Frontend (Vite)
VITE_AUTH0_DOMAIN=${AUTH0_DOMAIN}
VITE_AUTH0_CLIENT_ID=${AUTH0_CLIENT_ID}
VITE_AUTH0_AUDIENCE=${AUTH0_AUDIENCE}

# API
PORT=3001
CORS_ORIGIN=http://localhost:3000
ENV

# Append push env vars if --expo-token was provided
if [ -n "$EXPO_TOKEN" ]; then
  cat >> .env <<ENV

# Push Notifications
PUSH_PROVIDER=expo
EXPO_ACCESS_TOKEN=${EXPO_TOKEN}
ENV
fi

ok "Created .env"

# ─── Step 3: Generate deployment env files ───────────────────────────
step "3/11" "Creating deployment env files..."

mkdir -p "$LOCAL_ENV_DIR"

cat > "${LOCAL_ENV_DIR}/${PROJECT_NAME}.env" <<ENV
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${PROJECT_NAME}-postgres-service:5432/${DB_NAME}
AUTH0_ISSUER_BASE_URL=https://${AUTH0_DOMAIN}
AUTH0_AUDIENCE=${AUTH0_AUDIENCE}
VITE_AUTH0_DOMAIN=${AUTH0_DOMAIN}
VITE_AUTH0_CLIENT_ID=${AUTH0_CLIENT_ID}
VITE_AUTH0_AUDIENCE=${AUTH0_AUDIENCE}
PORT=3001
CORS_ORIGIN=https://${PROJECT_DOMAIN}
NODE_ENV=production
ENV

# Append push env vars to deployment env if --expo-token was provided
if [ -n "$EXPO_TOKEN" ]; then
  cat >> "${LOCAL_ENV_DIR}/${PROJECT_NAME}.env" <<ENV
PUSH_PROVIDER=expo
EXPO_ACCESS_TOKEN=${EXPO_TOKEN}
ENV
fi

cat > "${LOCAL_ENV_DIR}/${PROJECT_NAME}-postgres.env" <<ENV
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=${DB_NAME}
ENV

ok "Created ${LOCAL_ENV_DIR}/${PROJECT_NAME}.env"
ok "Created ${LOCAL_ENV_DIR}/${PROJECT_NAME}-postgres.env"

# ─── Step 4: Copy env files to remote ────────────────────────────────
step "4/11" "Copying env files to ${REMOTE_HOST}..."

if [[ "$(hostname)" == homebase* ]]; then
  mkdir -p "${REMOTE_ENV_DIR/#\~/$HOME}"
  cp "${LOCAL_ENV_DIR}/${PROJECT_NAME}.env" "${REMOTE_ENV_DIR/#\~/$HOME}/${PROJECT_NAME}.env" && \
    ok "Copied ${PROJECT_NAME}.env (local)" || \
    warn "Failed to copy ${PROJECT_NAME}.env locally"
  cp "${LOCAL_ENV_DIR}/${PROJECT_NAME}-postgres.env" "${REMOTE_ENV_DIR/#\~/$HOME}/${PROJECT_NAME}-postgres.env" && \
    ok "Copied ${PROJECT_NAME}-postgres.env (local)" || \
    warn "Failed to copy ${PROJECT_NAME}-postgres.env locally"
else
  ssh "${REMOTE_HOST}" "mkdir -p ${REMOTE_ENV_DIR}" 2>/dev/null || true
  scp "${LOCAL_ENV_DIR}/${PROJECT_NAME}.env" \
      "${REMOTE_HOST}:${REMOTE_ENV_DIR}/${PROJECT_NAME}.env" 2>/dev/null && \
    ok "Copied ${PROJECT_NAME}.env" || \
    warn "Could not reach ${REMOTE_HOST}. Copy manually later."
  scp "${LOCAL_ENV_DIR}/${PROJECT_NAME}-postgres.env" \
      "${REMOTE_HOST}:${REMOTE_ENV_DIR}/${PROJECT_NAME}-postgres.env" 2>/dev/null && \
    ok "Copied ${PROJECT_NAME}-postgres.env" || \
    warn "Could not reach ${REMOTE_HOST}. Copy manually later."
fi

# ─── Step 5: Update Auth0 shared SPA allowed URLs ───────────────────
step "5/11" "Updating Auth0 allowed URLs..."

if [ -z "$AUTH0_M2M_CLIENT_ID" ] || [ -z "$AUTH0_M2M_CLIENT_SECRET" ]; then
  echo ""
  err "Auth0 M2M credentials not configured."
  echo ""
  echo "  To fix this, add AUTH0_M2M_CLIENT_ID and AUTH0_M2M_CLIENT_SECRET"
  echo "  to ${DEFAULTS_FILE}"
  echo ""
  echo "  If you don't have an M2M app yet:"
  echo "    1. Auth0 Dashboard → Applications → Create Application"
  echo "    2. Choose 'Machine to Machine', name it 'praxis-init-script'"
  echo "    3. Authorize it for the 'Auth0 Management API' with scopes:"
  echo "         read:clients, update:clients"
  echo "    4. Copy Client ID and Client Secret from Settings tab"
  echo "    5. Add to ${DEFAULTS_FILE}:"
  echo "         AUTH0_M2M_CLIENT_ID=<your-client-id>"
  echo "         AUTH0_M2M_CLIENT_SECRET=<your-client-secret>"
  echo ""
  echo "  Existing M2M app 'praxis-init-script' may already exist in Auth0."
  echo "  Check: Auth0 Dashboard → Applications → filter by 'Machine to Machine'"
  echo ""
  warn "Skipping Auth0 URL update. Add https://${PROJECT_DOMAIN} manually."
else
  # Get M2M access token
  info "Requesting Auth0 Management API token..."
  TOKEN_RESPONSE=$(curl -s --max-time 15 -X POST \
    "https://${AUTH0_DOMAIN}/oauth/token" \
    -H "Content-Type: application/json" \
    -d "{\"client_id\":\"${AUTH0_M2M_CLIENT_ID}\",\"client_secret\":\"${AUTH0_M2M_CLIENT_SECRET}\",\"audience\":\"https://${AUTH0_DOMAIN}/api/v2/\",\"grant_type\":\"client_credentials\"}")

  MGMT_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)

  if [ -z "$MGMT_TOKEN" ]; then
    echo ""
    err "Failed to get Auth0 Management API token."
    echo "  Response: ${TOKEN_RESPONSE:0:300}"
    echo ""
    echo "  Possible causes:"
    echo "    - M2M Client ID or Secret is wrong (check ${DEFAULTS_FILE})"
    echo "    - M2M app not authorized for Management API"
    echo "    - Missing scopes: read:clients, update:clients"
    echo ""
    echo "  To fix: Auth0 Dashboard → Applications → APIs tab"
    echo "    → Auth0 Management API → toggle ON → add scopes"
    echo ""
    warn "Skipping Auth0 URL update. Add https://${PROJECT_DOMAIN} manually."
  else
    ok "Got Management API token"

    # Fetch current app settings
    APP_JSON=$(curl -s --max-time 15 \
      "https://${AUTH0_DOMAIN}/api/v2/clients/${AUTH0_CLIENT_ID}?fields=callbacks,allowed_logout_urls,web_origins" \
      -H "Authorization: Bearer ${MGMT_TOKEN}")

    if ! echo "$APP_JSON" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
      err "Failed to fetch Auth0 app. Response: ${APP_JSON:0:300}"
      warn "Skipping Auth0 URL update."
    else
      # Build updated URL lists
      UPDATED_JSON=$(echo "$APP_JSON" | python3 -c "
import sys, json

app = json.load(sys.stdin)
domain = '${PROJECT_DOMAIN}'
scheme = '${APP_SCHEME}'

callbacks = app.get('callbacks', [])
logout = app.get('allowed_logout_urls', [])
origins = app.get('web_origins', [])

new_urls = [f'https://{domain}', 'http://localhost:3000']
mobile_scheme = f'{scheme}://auth'
new_callbacks = new_urls + [mobile_scheme]
new_logout = new_urls
new_origins = new_urls

for u in new_callbacks:
    if u not in callbacks:
        callbacks.append(u)
for u in new_logout:
    if u not in logout:
        logout.append(u)
for u in new_origins:
    if u not in origins:
        origins.append(u)

print(json.dumps({
    'callbacks': callbacks,
    'allowed_logout_urls': logout,
    'web_origins': origins,
}))
" 2>/dev/null)

      info "Updating Auth0 allowed URLs..."
      UPDATE_RESPONSE=$(curl -s --max-time 15 -X PATCH \
        "https://${AUTH0_DOMAIN}/api/v2/clients/${AUTH0_CLIENT_ID}" \
        -H "Authorization: Bearer ${MGMT_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$UPDATED_JSON")

      if echo "$UPDATE_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'client_id' in d" 2>/dev/null; then
        ok "Added https://${PROJECT_DOMAIN} to Auth0 allowed URLs"
      else
        err "Failed to update Auth0 app."
        echo "  Response: ${UPDATE_RESPONSE:0:300}"
        warn "Manually add https://${PROJECT_DOMAIN} to your Auth0 SPA allowed URLs."
      fi
    fi
  fi
fi

# ─── Step 6: Initialize EAS project ──────────────────────────────────
step "6/11" "Initializing EAS project..."

if command -v eas &> /dev/null; then
  # Remove the placeholder projectId BEFORE running eas init.
  # If the field exists with any non-UUID value, eas init thinks the project
  # is already linked and skips creation — but then fails on the invalid ID.
  python3 -c "
import json, re
with open('packages/mobile/app.json') as f:
    data = json.load(f)
eas = data.get('expo',{}).get('extra',{}).get('eas',{})
pid = eas.get('projectId','')
uuid_re = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
if pid and not uuid_re.match(pid):
    del eas['projectId']
    with open('packages/mobile/app.json', 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('  Removed placeholder projectId before linking.')
" 2>/dev/null

  EAS_OUTPUT=$(cd packages/mobile && eas init --non-interactive --force 2>&1) || true
  echo "$EAS_OUTPUT"

  # Read the project ID that eas init wrote into app.json
  EAS_PROJECT_ID=$(python3 -c "
import json
with open('packages/mobile/app.json') as f:
    data = json.load(f)
pid = data.get('expo',{}).get('extra',{}).get('eas',{}).get('projectId','')
if pid and pid != 'TEMPLATE_EAS_PROJECT_ID':
    print(pid)
" 2>/dev/null)

  if [ -n "$EAS_PROJECT_ID" ]; then
    ok "EAS project ID: ${EAS_PROJECT_ID}"
    # Replace the updates URL placeholder with the real project ID
    sed -i '' "s|TEMPLATE_EAS_PROJECT_ID|${EAS_PROJECT_ID}|g" packages/mobile/app.json
    ok "Updates URL configured"
  else
    warn "Could not detect EAS project ID."
    info "Run 'cd packages/mobile && eas init' manually."
  fi
else
  warn "eas CLI not found. Install with: npm install -g eas-cli"
  info "Then run: cd packages/mobile && eas init"
fi

# ─── Step 7: Create GoDaddy DNS A record ────────────────────────────
step "7/11" "Creating DNS A record for ${PROJECT_DOMAIN}..."

if [ -n "$GODADDY_API_KEY" ] && [ -n "$GODADDY_API_SECRET" ] && [ -n "$SERVER_IP" ]; then
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT "https://api.godaddy.com/v1/domains/${DOMAIN_SUFFIX}/records/A/${PROJECT_NAME}" \
    -H "Authorization: sso-key ${GODADDY_API_KEY}:${GODADDY_API_SECRET}" \
    -H "Content-Type: application/json" \
    -d "[{\"data\": \"${SERVER_IP}\", \"ttl\": 600}]")

  if [ "$HTTP_STATUS" = "200" ]; then
    ok "Created A record: ${PROJECT_DOMAIN} → ${SERVER_IP}"
  else
    warn "GoDaddy API returned HTTP ${HTTP_STATUS}."
    info "Manually create an A record: ${PROJECT_DOMAIN} → ${SERVER_IP}"
  fi
else
  warn "GoDaddy credentials or SERVER_IP not set in ${DEFAULTS_FILE}."
  info "Manually create an A record: ${PROJECT_DOMAIN} → your server IP"
fi

# ─── Step 8: Update K8s ingress ──────────────────────────────────────
step "8/11" "Updating K8s ingress rules..."

INGRESS_TMP=$(mktemp -d)
INGRESS_UPDATED=false

if git clone --quiet "$INGRESS_REPO" "$INGRESS_TMP" 2>/dev/null; then
  INGRESS_FILE="$INGRESS_TMP/ingress.yaml"

  if [ -f "$INGRESS_FILE" ]; then
    if grep -qF "$PROJECT_DOMAIN" "$INGRESS_FILE"; then
      ok "Ingress rules for ${PROJECT_DOMAIN} already exist"
    else
      # Add WebSocket timeout annotations if not present
      if ! grep -q "proxy-read-timeout" "$INGRESS_FILE"; then
        sed -i '' '/^  annotations:/a\
\    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"\
\    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"\
\    nginx.ingress.kubernetes.io/proxy-connect-timeout: "3600"
' "$INGRESS_FILE"
        ok "Added WebSocket timeout annotations"
      fi

      # Insert hostname into spec.tls[0].hosts[] (before the secretName line)
      sed -i '' "/secretName:/i\\
\\        - ${PROJECT_DOMAIN}
" "$INGRESS_FILE"

      # Append routing rule block to end of file
      cat >> "$INGRESS_FILE" <<RULE
    - host: ${PROJECT_DOMAIN}
      http:
        paths:
          - pathType: Prefix
            path: /api
            backend:
              service:
                name: ${PROJECT_NAME}-api-service
                port:
                  number: 80
          - pathType: Prefix
            path: /
            backend:
              service:
                name: ${PROJECT_NAME}-ui-service
                port:
                  number: 80
RULE

      cd "$INGRESS_TMP"
      git add ingress.yaml
      git commit -m "Add ingress rules for ${PROJECT_DOMAIN}" --quiet
      git push --quiet
      cd - > /dev/null
      INGRESS_UPDATED=true
      ok "Added ingress rules for ${PROJECT_DOMAIN} and pushed to k8s-ingress"
    fi
  else
    warn "ingress.yaml not found in k8s-ingress repo."
  fi
else
  warn "Could not clone k8s-ingress repo. Add ingress rules manually."
fi

rm -rf "$INGRESS_TMP"

# ─── Step 9: Configure push notifications ────────────────────────────
step "9/11" "Configuring push notifications..."

if [ -n "$EXPO_TOKEN" ]; then
  ok "Push provider: Expo (token configured in .env files)"

  # Initialize EAS project if eas-cli is available
  if command -v eas &> /dev/null; then
    info "Running eas project:init..."
    (cd packages/mobile && eas project:init --non-interactive 2>&1) && \
      ok "EAS project initialized for push" || \
      warn "eas project:init failed. Run manually: cd packages/mobile && eas project:init"
  fi
else
  info "Push notifications: console mode (set --expo-token for production push)"
fi

if [ -n "$APNS_KEY_PATH" ]; then
  if [ ! -f "$APNS_KEY_PATH" ]; then
    warn "APNs key file not found at ${APNS_KEY_PATH}"
  elif [ -z "$APNS_KEY_ID" ] || [ -z "$APNS_TEAM_ID" ]; then
    warn "--apns-key-path requires --apns-key-id and --apns-team-id"
  elif command -v eas &> /dev/null; then
    info "Uploading APNs credentials via eas..."
    (cd packages/mobile && eas credentials --platform ios --non-interactive 2>&1) && \
      ok "APNs credentials uploaded" || \
      warn "eas credentials upload failed. Run manually."
  else
    warn "eas CLI not found. Install with: npm install -g eas-cli"
    info "Then run: cd packages/mobile && eas credentials --platform ios"
  fi
fi

if [ -n "$GOOGLE_SERVICES_PATH" ]; then
  if [ -f "$GOOGLE_SERVICES_PATH" ]; then
    cp "$GOOGLE_SERVICES_PATH" packages/mobile/google-services.json && \
      ok "Copied google-services.json to packages/mobile/" || \
      warn "Failed to copy google-services.json"
  else
    warn "google-services.json not found at ${GOOGLE_SERVICES_PATH}"
  fi
fi

# ─── Step 10: Add template remote for future updates ────────────────
step "10/11" "Adding template remote..."

if git remote get-url template &>/dev/null; then
  ok "Template remote already exists"
else
  git remote add template git@github.com:tylersmith-art/trpc-template.git && \
    ok "Added 'template' remote. Pull updates with: git fetch template && git merge template/main" || \
    warn "Failed to add template remote."
fi

# ─── Step 11: Summary ───────────────────────────────────────────────
step "11/11" "Finalizing..."
echo ""
info "Project:    ${PROJECT_NAME}"
info "Repo:       git@github.com:tylersmith-art/${PROJECT_NAME}.git"
info "Domain:     ${PROJECT_DOMAIN}"
info "DB User:    ${DB_USER}"
info "DB Name:    ${DB_NAME}"
info "DB Pass:    (saved in .env files)"
info "Auth0:      ${AUTH0_DOMAIN} (shared app)"
info "Audience:   ${AUTH0_AUDIENCE}"
info "DNS:        ${PROJECT_DOMAIN} → ${SERVER_IP}"
info "Ingress:    $(if [ "$INGRESS_UPDATED" = true ]; then echo "added to k8s-ingress (auto-deploys)"; else echo "already configured"; fi)"
echo ""
info "Committing initialized project..."
git add -A
git commit -m "Initialize ${PROJECT_NAME} from trpc-template" --quiet
git push --quiet
ok "Pushed to GitHub"
echo ""
info "Triggering deploy workflows..."
REPO="tylersmith-art/${PROJECT_NAME}"
gh workflow run deploy-infra.yml --repo "$REPO" --ref main
gh workflow run deploy-api.yml --repo "$REPO" --ref main
gh workflow run deploy-web.yml --repo "$REPO" --ref main
ok "All 3 workflows triggered"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo "    docker compose up -d"
echo "    pnpm install"
echo "    pnpm db:generate"
echo "    pnpm db:migrate"
echo "    pnpm dev"
echo ""
echo -e "${BOLD}Mobile:${NC}"
echo "    pnpm mobile:dev        # Start Expo dev server"
echo "    pnpm mobile:ios        # Build & run on iOS simulator"
echo "    pnpm mobile:build:dev  # EAS development build"
echo "    pnpm mobile:build      # EAS production build"
