#!/bin/bash
set -e

# ─── Device Build Script ─────────────────────────────────────────────
# Builds and deploys the Expo app to a physical iPhone via Xcode.
#
# First run:  walks you through setup (Team ID, device, Wi-Fi pairing)
#             and saves config to ~/.config/trpc-template/defaults.env
# After that: fully automated — no prompts, builds and installs.
#
# Usage:
#   ./scripts/build-device.sh              # standalone release build (default)
#   ./scripts/build-device.sh --debug      # dev client build (needs Metro server)
#   ./scripts/build-device.sh --clean      # force prebuild --clean
#   ./scripts/build-device.sh --setup      # re-run first-time setup
# ──────────────────────────────────────────────────────────────────────

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$PROJECT_ROOT/packages/mobile"
APP_JSON="$MOBILE_DIR/app.json"
EAS_JSON="$MOBILE_DIR/eas.json"
DEFAULTS_FILE="$HOME/.config/trpc-template/defaults.env"

FORCE_CLEAN=false
FORCE_SETUP=false
BUILD_RELEASE=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean) FORCE_CLEAN=true; shift ;;
    --setup) FORCE_SETUP=true; shift ;;
    --debug) BUILD_RELEASE=false; shift ;;
    *) shift ;;
  esac
done

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

echo ""
echo -e "${BOLD}Local Device Build — Physical iPhone via Xcode${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Load saved defaults ─────────────────────────────────────────────
mkdir -p "$(dirname "$DEFAULTS_FILE")"
APPLE_TEAM_ID=""
IOS_DEVICE_UDID=""
IOS_DEVICE_NAME=""

if [ -f "$DEFAULTS_FILE" ]; then
  source "$DEFAULTS_FILE"
fi

NEEDS_SETUP=false
if [ -z "$APPLE_TEAM_ID" ] || [ -z "$IOS_DEVICE_UDID" ] || [ "$FORCE_SETUP" = true ]; then
  NEEDS_SETUP=true
fi

if [ "$NEEDS_SETUP" = false ]; then
  echo ""
  echo -e "  ${DIM}Automated mode (saved config found)${NC}"
  echo -e "  ${DIM}Team: $APPLE_TEAM_ID | Device: $IOS_DEVICE_NAME ($IOS_DEVICE_UDID)${NC}"
  echo -e "  ${DIM}Run with --setup to reconfigure${NC}"
fi

# ─── Step 1: Prerequisites & Xcode setup ─────────────────────────────
step "1/10" "Checking prerequisites..."

# ── Node ──
if ! command -v node &>/dev/null; then
  err "node not found."
  echo "  Install from https://nodejs.org or: brew install node"
  exit 1
fi
ok "node $(node --version)"

# ── Xcode ──
if ! [ -d "/Applications/Xcode.app" ]; then
  err "Xcode not found at /Applications/Xcode.app"
  echo ""
  echo "  Install Xcode from the Mac App Store:"
  echo "    open 'macappstore://itunes.apple.com/app/id497799835'"
  echo ""
  echo "  After installing, re-run this script."
  # Try to open the App Store page
  open 'macappstore://itunes.apple.com/app/id497799835' 2>/dev/null || true
  exit 1
fi

# ── Select Xcode as active developer tools ──
CURRENT_DEV_DIR=$(xcode-select -p 2>/dev/null || echo "")
if [[ "$CURRENT_DEV_DIR" != *"Xcode.app"* ]]; then
  info "Setting Xcode as active developer directory..."
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  ok "xcode-select pointed to Xcode.app"
else
  ok "xcode-select: $CURRENT_DEV_DIR"
fi

# ── Accept Xcode license ──
if ! xcodebuild -checkFirstLaunchStatus 2>/dev/null; then
  info "Accepting Xcode license (requires sudo)..."
  sudo xcodebuild -license accept
  ok "Xcode license accepted"
else
  ok "Xcode license already accepted"
fi

# ── Install Xcode additional components (platforms, simulators) ──
if ! xcodebuild -checkFirstLaunchStatus 2>/dev/null; then
  info "Installing Xcode first-launch components..."
  sudo xcodebuild -runFirstLaunch
  ok "Xcode components installed"
fi

ok "xcodebuild $(xcodebuild -version 2>/dev/null | head -1)"

# ── iOS platform (Xcode 15+ may need separate download) ──
if ! xcodebuild -showsdks 2>/dev/null | grep -q "iphoneos"; then
  warn "iOS SDK not found. Installing iOS platform..."
  echo ""
  echo "  This can take a few minutes (downloads iOS SDK)."
  xcodebuild -downloadPlatform iOS
  ok "iOS platform installed"
else
  IOS_SDK=$(xcodebuild -showsdks 2>/dev/null | grep "iphoneos" | tail -1 | xargs)
  ok "iOS SDK: $IOS_SDK"
fi

# ── CocoaPods ──
if ! command -v pod &>/dev/null; then
  info "Installing CocoaPods..."
  if command -v brew &>/dev/null; then
    brew install cocoapods
  else
    sudo gem install cocoapods
  fi
  ok "CocoaPods installed"
else
  ok "pod $(pod --version 2>/dev/null)"
fi

# ── Apple ID in Xcode (manual check) ──
# Check if any accounts are configured by looking for provisioning profiles
if [ -z "$(security find-identity -v -p codesigning 2>/dev/null | grep -v 'valid identities found')" ]; then
  warn "No signing certificates found."
  echo ""
  echo -e "  ${BOLD}You need to add your Apple ID to Xcode:${NC}"
  echo "    1. Open Xcode > Settings (Cmd+,) > Accounts"
  echo "    2. Click '+' > Apple ID > sign in"
  echo "    3. After signing in, close Xcode settings"
  echo ""
  echo "  Opening Xcode settings now..."
  open -a Xcode
  echo ""
  read -p "  Press Enter after adding your Apple ID... "
fi

# ── eas CLI ──
if command -v eas &>/dev/null; then
  ok "eas $(eas --version 2>/dev/null | head -1)"
else
  info "Installing eas-cli..."
  npm install -g eas-cli
  ok "eas-cli installed"
fi

# ── EAS login ──
# EXPO_TOKEN env var is used automatically by eas-cli (for CI/headless).
if ! eas whoami &>/dev/null 2>&1; then
  if [ -n "$EXPO_TOKEN" ]; then
    ok "Authenticated via EXPO_TOKEN"
  else
    warn "Not logged in to EAS."
    echo ""
    echo "  EAS login is needed for push notification credentials"
    echo "  and project linking (even for local builds)."
    echo ""
    echo "  Logging in now..."
    eas login
    if ! eas whoami &>/dev/null 2>&1; then
      err "EAS login failed. Re-run this script after logging in."
      exit 1
    fi
  fi
fi
EAS_USER=$(eas whoami 2>/dev/null)
ok "Logged in to EAS as: $EAS_USER"

# ─── Step 2: Install dependencies (must happen before EAS init) ──────
step "2/10" "Installing dependencies..."

(cd "$PROJECT_ROOT" && pnpm install --silent 2>&1 | tail -3)
ok "Dependencies installed"

# Build shared packages (hooks, shared) — Release bundles need dist/ output
info "Building workspace packages..."
(cd "$PROJECT_ROOT" && pnpm build 2>&1 | tail -5)
ok "Packages built"

# ─── Step 3: Install expo-dev-client ─────────────────────────────────
step "3/10" "Checking expo-dev-client..."

if (cd "$MOBILE_DIR" && node -e "require('expo-dev-client')" 2>/dev/null); then
  ok "expo-dev-client installed"
else
  info "Installing expo-dev-client..."
  (cd "$MOBILE_DIR" && npx expo install expo-dev-client)
  ok "Installed"
fi

# ─── Step 4: Fix EAS Project ID ─────────────────────────────────────
step "4/10" "Checking EAS project ID..."

CURRENT_ID=$(python3 -c "
import json
with open('$APP_JSON') as f:
    data = json.load(f)
print(data.get('expo',{}).get('extra',{}).get('eas',{}).get('projectId',''))
" 2>/dev/null)

UUID_REGEX='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

if [[ "$CURRENT_ID" =~ $UUID_REGEX ]]; then
  ok "EAS project ID: $CURRENT_ID"
else
  warn "Invalid or placeholder EAS project ID: '$CURRENT_ID'"
  info "Removing placeholder so EAS can link a new project..."

  python3 -c "
import json
with open('$APP_JSON') as f:
    data = json.load(f)
eas = data.get('expo',{}).get('extra',{}).get('eas',{})
if 'projectId' in eas:
    del eas['projectId']
with open('$APP_JSON', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"
  (cd "$MOBILE_DIR" && eas init --non-interactive --force)

  NEW_ID=$(python3 -c "
import json
with open('$APP_JSON') as f:
    data = json.load(f)
print(data.get('expo',{}).get('extra',{}).get('eas',{}).get('projectId',''))
" 2>/dev/null)

  if [[ "$NEW_ID" =~ $UUID_REGEX ]]; then
    ok "EAS project linked: $NEW_ID"
  else
    err "eas init didn't write a valid project ID. Check app.json and re-run."
    exit 1
  fi
fi

# ─── Step 5: Fix eas.json ───────────────────────────────────────────
step "5/10" "Updating eas.json..."

python3 -c "
import json
with open('$EAS_JSON') as f:
    data = json.load(f)
changed = False
if 'appVersionSource' not in data.get('cli', {}):
    data['cli']['appVersionSource'] = 'remote'
    changed = True
if changed:
    with open('$EAS_JSON', 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
"
ok "eas.json configured"

# ─── Step 6: Push credentials via Expo GraphQL API ──────────────────
step "6/10" "Checking push notification credentials..."

# Resolve EXPO_TOKEN: env var → macOS Keychain → skip
EXPO_API_TOKEN="${EXPO_TOKEN:-}"
if [ -z "$EXPO_API_TOKEN" ]; then
  EXPO_API_TOKEN=$(security find-generic-password -s "trpc-template-godaddy" -a "expo-token" -w 2>/dev/null || echo "")
fi

PUSH_BUNDLE_ID=$(jq -r '.expo.ios.bundleIdentifier // ""' "$APP_JSON" 2>/dev/null || echo "")
PUSH_EAS_PROJECT_ID=$(jq -r '.expo.extra.eas.projectId // ""' "$APP_JSON" 2>/dev/null || echo "")

if [ -z "$EXPO_API_TOKEN" ]; then
  info "No EXPO_TOKEN found — skipping push credential setup"
  info "(Set via init.sh or export EXPO_TOKEN=... for push support)"
elif [ -z "${APNS_KEY_PATH:-}" ] || [ -z "${APNS_KEY_ID:-}" ] || [ -z "${APNS_TEAM_ID:-}" ]; then
  info "APNs credentials not configured — skipping"
  info "(Run init.sh with push credentials to enable)"
elif [ ! -f "${APNS_KEY_PATH}" ]; then
  warn "APNs key file not found: $APNS_KEY_PATH"
elif [ -z "$PUSH_BUNDLE_ID" ] || [[ "$PUSH_BUNDLE_ID" == *"TEMPLATE"* ]]; then
  info "Template bundle ID — skipping push credentials"
else
  EXPO_GQL="https://api.expo.dev/graphql"

  # GraphQL helper — jq builds the JSON body (handles .p8 newlines etc.)
  gql() {
    local query="$1" vars="${2:-null}"
    local body
    body=$(jq -n --arg q "$query" --argjson v "$vars" '{query: $q, variables: $v}')
    curl -s -X POST "$EXPO_GQL" \
      -H "Authorization: Bearer $EXPO_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body"
  }

  # Check for GraphQL errors, extract .data — returns 1 on error
  gql_data() {
    local resp="$1"
    if [ -z "$resp" ]; then
      warn "Empty response from Expo API"
      return 1
    fi
    if ! echo "$resp" | jq empty 2>/dev/null; then
      warn "Non-JSON response: ${resp:0:200}"
      return 1
    fi
    local err
    err=$(echo "$resp" | jq -r '.errors[0].message // empty')
    if [ -n "$err" ]; then
      warn "Expo API: $err"
      return 1
    fi
    echo "$resp" | jq -r '.data'
  }

  PUSH_OK=true

  # 1. Account info
  info "Querying Expo account..."
  RESP=$(gql '{ meActor { ... on User { id accounts { id name } } ... on Robot { id firstName accounts { id name } } } }')
  DATA=$(gql_data "$RESP") || { PUSH_OK=false; }

  if [ "$PUSH_OK" = true ]; then
    ACCT_ID=$(echo "$DATA" | jq -r '.meActor.accounts[0].id // empty')
    ACCT_NAME=$(echo "$DATA" | jq -r '.meActor.accounts[0].name // empty')

    if [ -z "$ACCT_ID" ] || [ -z "$ACCT_NAME" ] || [ "$ACCT_ID" = "null" ]; then
      warn "Could not resolve Expo account (token may be invalid)"
      info "Response: $(echo "$RESP" | jq -c '.' 2>/dev/null | head -c 200)"
      PUSH_OK=false
    else
      info "Account: $ACCT_NAME"
    fi
  fi

  if [ "$PUSH_OK" = true ]; then
    # 2. Check existing push keys on account
    RESP=$(gql 'query($n: String!) { account { byName(accountName: $n) { applePushKeysPaginated(first: 50) { edges { node { id keyIdentifier } } } } } }' \
      "$(jq -n --arg n "$ACCT_NAME" '{n: $n}')")
    DATA=$(gql_data "$RESP") || { warn "Could not check push keys"; PUSH_OK=false; }
  fi

  PUSH_KEY_ID=""
  TEAM_GQL_ID=""

  if [ "$PUSH_OK" = true ]; then
    PUSH_KEY_ID=$(echo "$DATA" | jq -r --arg kid "$APNS_KEY_ID" \
      '.account.byName.applePushKeysPaginated.edges[] | select(.node.keyIdentifier == $kid) | .node.id' | head -1)

    if [ -n "$PUSH_KEY_ID" ]; then
      ok "Push key exists on account ($APNS_KEY_ID)"
    else
      # 3. Get or create Apple Team
      RESP=$(gql 'query($n: String!) { account { byName(accountName: $n) { appleTeams { id appleTeamIdentifier } } } }' \
        "$(jq -n --arg n "$ACCT_NAME" '{n: $n}')")
      DATA=$(gql_data "$RESP") || PUSH_OK=false

      if [ "$PUSH_OK" = true ]; then
        TEAM_GQL_ID=$(echo "$DATA" | jq -r --arg tid "$APNS_TEAM_ID" \
          '.account.byName.appleTeams[] | select(.appleTeamIdentifier == $tid) | .id' | head -1)

        if [ -z "$TEAM_GQL_ID" ]; then
          RESP=$(gql 'mutation($i: AppleTeamInput!, $a: ID!) { appleTeam { createAppleTeam(appleTeamInput: $i, accountId: $a) { id } } }' \
            "$(jq -n --arg tid "$APNS_TEAM_ID" --arg a "$ACCT_ID" '{i: {appleTeamIdentifier: $tid}, a: $a}')")
          DATA=$(gql_data "$RESP") || PUSH_OK=false
          [ "$PUSH_OK" = true ] && TEAM_GQL_ID=$(echo "$DATA" | jq -r '.appleTeam.createAppleTeam.id')
        fi
      fi

      # 4. Create push key (jq handles .p8 newline escaping)
      if [ "$PUSH_OK" = true ]; then
        KEY_P8=$(cat "$APNS_KEY_PATH")
        RESP=$(gql 'mutation($i: ApplePushKeyInput!, $a: ID!) { applePushKey { createApplePushKey(applePushKeyInput: $i, accountId: $a) { id } } }' \
          "$(jq -n --arg kp8 "$KEY_P8" --arg kid "$APNS_KEY_ID" --arg tid "$TEAM_GQL_ID" --arg a "$ACCT_ID" \
            '{i: {keyP8: $kp8, keyIdentifier: $kid, appleTeamId: $tid}, a: $a}')")
        DATA=$(gql_data "$RESP") || PUSH_OK=false
        if [ "$PUSH_OK" = true ]; then
          PUSH_KEY_ID=$(echo "$DATA" | jq -r '.applePushKey.createApplePushKey.id')
          ok "Created push key ($APNS_KEY_ID)"
        fi
      fi
    fi
  fi

  # 5. Check if app already has push key assigned
  if [ "$PUSH_OK" = true ] && [ -n "$PUSH_KEY_ID" ]; then
    # Get or create AppleAppIdentifier
    info "Looking up app identifier for $PUSH_BUNDLE_ID..."
    RESP=$(gql 'query($n: String!, $b: String!) { account { byName(accountName: $n) { appleAppIdentifiers(bundleIdentifier: $b) { id } } } }' \
      "$(jq -n --arg n "$ACCT_NAME" --arg b "$PUSH_BUNDLE_ID" '{n: $n, b: $b}')")
    DATA=$(gql_data "$RESP") || PUSH_OK=false

    APPLE_APP_ID=""
    if [ "$PUSH_OK" = true ]; then
      APPLE_APP_ID=$(echo "$DATA" | jq -r '.account.byName.appleAppIdentifiers[0].id // empty')

      if [ -z "$APPLE_APP_ID" ]; then
        info "Creating app identifier..."
        # Need team ID — fetch if we reused an existing push key
        if [ -z "$TEAM_GQL_ID" ]; then
          RESP=$(gql 'query($n: String!) { account { byName(accountName: $n) { appleTeams { id appleTeamIdentifier } } } }' \
            "$(jq -n --arg n "$ACCT_NAME" '{n: $n}')")
          DATA=$(gql_data "$RESP") || PUSH_OK=false
          [ "$PUSH_OK" = true ] && TEAM_GQL_ID=$(echo "$DATA" | jq -r --arg tid "$APNS_TEAM_ID" \
            '.account.byName.appleTeams[] | select(.appleTeamIdentifier == $tid) | .id' | head -1)
        fi
        if [ "$PUSH_OK" = true ] && [ -n "$TEAM_GQL_ID" ]; then
          RESP=$(gql 'mutation($i: AppleAppIdentifierInput!, $a: ID!) { appleAppIdentifier { createAppleAppIdentifier(appleAppIdentifierInput: $i, accountId: $a) { id } } }' \
            "$(jq -n --arg b "$PUSH_BUNDLE_ID" --arg tid "$TEAM_GQL_ID" --arg a "$ACCT_ID" \
              '{i: {bundleIdentifier: $b, appleTeamId: $tid}, a: $a}')")
          DATA=$(gql_data "$RESP") || PUSH_OK=false
          [ "$PUSH_OK" = true ] && APPLE_APP_ID=$(echo "$DATA" | jq -r '.appleAppIdentifier.createAppleAppIdentifier.id')
        fi
      else
        info "App identifier: $APPLE_APP_ID"
      fi
    fi

    # Check existing credentials
    if [ "$PUSH_OK" = true ] && [ -n "$APPLE_APP_ID" ]; then
      info "Checking iOS credentials for project $PUSH_EAS_PROJECT_ID..."
      RESP=$(gql 'query($appId: String!, $aaid: String!) { app { byId(appId: $appId) { id iosAppCredentials(filter: { appleAppIdentifierId: $aaid }) { id pushKey { id keyIdentifier } } } } }' \
        "$(jq -n --arg appId "$PUSH_EAS_PROJECT_ID" --arg aaid "$APPLE_APP_ID" '{appId: $appId, aaid: $aaid}')")
      DATA=$(gql_data "$RESP") || { info "Response: $(echo "$RESP" | jq -c '.' 2>/dev/null | head -c 300)"; PUSH_OK=false; }

      if [ "$PUSH_OK" = true ]; then
        EXISTING_KEY=$(echo "$DATA" | jq -r '.app.byId.iosAppCredentials[0].pushKey.keyIdentifier // empty')
        if [ -n "$EXISTING_KEY" ]; then
          ok "Push key already assigned ($EXISTING_KEY)"
        else
          # Get or create IosAppCredentials
          CREDS_ID=$(echo "$DATA" | jq -r '.app.byId.iosAppCredentials[0].id // empty')

          if [ -z "$CREDS_ID" ]; then
            info "Creating iOS app credentials..."
            # App ID is already in the credentials response from byId
            APP_ID=$(echo "$DATA" | jq -r '.app.byId.id // empty')
            if [ -z "$APP_ID" ] || [ "$APP_ID" = "null" ]; then
              warn "Could not resolve app ID from EAS project"
              PUSH_OK=false
            fi

            if [ "$PUSH_OK" = true ]; then
              RESP=$(gql 'mutation($i: IosAppCredentialsInput!, $appId: ID!, $aaid: ID!) { iosAppCredentials { createIosAppCredentials(iosAppCredentialsInput: $i, appId: $appId, appleAppIdentifierId: $aaid) { id } } }' \
                "$(jq -n --arg appId "$APP_ID" --arg aaid "$APPLE_APP_ID" '{i: {}, appId: $appId, aaid: $aaid}')")
              DATA=$(gql_data "$RESP") || PUSH_OK=false
              [ "$PUSH_OK" = true ] && CREDS_ID=$(echo "$DATA" | jq -r '.iosAppCredentials.createIosAppCredentials.id')
            fi
          fi

          # 6. Assign push key
          if [ "$PUSH_OK" = true ] && [ -n "$CREDS_ID" ]; then
            info "Assigning push key..."
            RESP=$(gql 'mutation($cid: ID!, $kid: ID!) { iosAppCredentials { setPushKey(id: $cid, pushKeyId: $kid) { id } } }' \
              "$(jq -n --arg cid "$CREDS_ID" --arg kid "$PUSH_KEY_ID" '{cid: $cid, kid: $kid}')")
            gql_data "$RESP" > /dev/null && ok "Push key assigned to $PUSH_BUNDLE_ID" || PUSH_OK=false
          fi
        fi
      fi
    fi
  fi

  if [ "$PUSH_OK" != true ]; then
    warn "Push credential setup failed — push notifications may not work"
    warn "You can configure manually: cd packages/mobile && eas credentials"
  fi
fi

# ─── Step 7: Apple Developer + Device setup ──────────────────────────
step "7/10" "Apple Developer & device setup..."

if [ "$NEEDS_SETUP" = true ]; then
  echo ""
  echo "── First-time setup (saved for future runs) ─────────────────"

  # ── Team ID ──
  echo ""
  echo -e "  ${BOLD}Apple Developer Team ID${NC}"
  echo ""
  echo "  Your signing certificates:"
  echo ""
  security find-identity -v -p codesigning 2>/dev/null | head -10 | while IFS= read -r line; do
    echo "    $line"
  done
  echo ""

  # Try to auto-detect Team ID from signing identity
  DETECTED_TEAM=$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -oE '\([A-Z0-9]{10}\)' | head -1 | tr -d '()')

  if [ -n "$DETECTED_TEAM" ]; then
    echo -e "  Detected Team ID: ${BOLD}$DETECTED_TEAM${NC}"
    read -p "  Use this Team ID? [Y/n] " USE_DETECTED
    if [ "$USE_DETECTED" != "n" ] && [ "$USE_DETECTED" != "N" ]; then
      APPLE_TEAM_ID="$DETECTED_TEAM"
    fi
  fi

  if [ -z "$APPLE_TEAM_ID" ]; then
    echo "  Find your Team ID at: https://developer.apple.com/account"
    echo "  (Membership Details > Team ID)"
    read -p "  Apple Developer Team ID: " APPLE_TEAM_ID
  fi

  if [ -z "$APPLE_TEAM_ID" ]; then
    err "Team ID is required."
    exit 1
  fi
  ok "Team ID: $APPLE_TEAM_ID"

  # ── Device selection ──
  echo ""
  echo -e "  ${BOLD}Select your iPhone${NC}"
  echo ""

  # Use xctrace first — it returns the traditional UDID that xcodebuild needs.
  # devicectl returns a CoreDevice UUID which is a DIFFERENT identifier.
  XCTRACE_LIST=$(xcrun xctrace list devices 2>/dev/null | grep -i "iPhone" || true)
  if [ -n "$XCTRACE_LIST" ]; then
    echo "  Connected devices:"
    echo ""
    echo "$XCTRACE_LIST" | while IFS= read -r line; do
      echo "    $line"
    done
    echo ""
    # Apple UDIDs come in multiple formats:
    #   ECID:          XXXXXXXX-XXXXXXXXXXXXXXXX (8-16 hex, most modern iPhones)
    #   Standard UUID: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX (8-4-4-4-12)
    #   Legacy 40-char: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
    DETECTED_UDID=$(echo "$XCTRACE_LIST" | head -1 \
      | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{16}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{40}' || true)
    DETECTED_NAME=$(echo "$XCTRACE_LIST" | head -1 | sed 's/ (.*//' | xargs || true)
  fi

  # Fallback: try devicectl (returns CoreDevice UUID — less preferred but better than nothing)
  if [ -z "$DETECTED_UDID" ]; then
    if command -v xcrun &>/dev/null && xcrun devicectl list devices 2>/dev/null | grep -q "iPhone"; then
      echo "  Connected devices (via devicectl):"
      echo ""
      DEVICE_LIST=$(xcrun devicectl list devices 2>/dev/null | grep -i "iPhone" || true)
      if [ -n "$DEVICE_LIST" ]; then
        echo "$DEVICE_LIST" | while IFS= read -r line; do
          echo "    $line"
        done
        echo ""
        warn "Only CoreDevice UUID found (devicectl). xcodebuild may need traditional UDID."
        DETECTED_UDID=$(xcrun devicectl list devices 2>/dev/null \
          | grep -i "iPhone" | head -1 \
          | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{16}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{40}' || true)
        DETECTED_NAME=$(xcrun devicectl list devices 2>/dev/null \
          | grep -i "iPhone" | head -1 \
          | sed 's/  .*//' | xargs || true)
      fi
    fi
  fi

  if [ -n "$DETECTED_UDID" ]; then
    echo -e "  Detected: ${BOLD}${DETECTED_NAME:-iPhone}${NC} ($DETECTED_UDID)"
    read -p "  Use this device? [Y/n] " USE_DETECTED_DEV
    if [ "$USE_DETECTED_DEV" != "n" ] && [ "$USE_DETECTED_DEV" != "N" ]; then
      IOS_DEVICE_UDID="$DETECTED_UDID"
      IOS_DEVICE_NAME="${DETECTED_NAME:-iPhone}"
    fi
  fi

  if [ -z "$IOS_DEVICE_UDID" ]; then
    echo ""
    echo "  No device auto-detected. Make sure your iPhone is:"
    echo "    - Connected via USB, OR"
    echo "    - Paired for Wi-Fi debugging (Xcode > Devices & Simulators)"
    echo ""
    echo "  Find your UDID:"
    echo "    Xcode > Window > Devices and Simulators > select device > Identifier"
    echo ""
    read -p "  Device UDID: " IOS_DEVICE_UDID
    read -p "  Device name (for your reference): " IOS_DEVICE_NAME
    IOS_DEVICE_NAME="${IOS_DEVICE_NAME:-iPhone}"
  fi

  if [ -z "$IOS_DEVICE_UDID" ]; then
    err "Device UDID is required."
    exit 1
  fi
  ok "Device: $IOS_DEVICE_NAME ($IOS_DEVICE_UDID)"

  # ── Device preparation + Wi-Fi pairing ──
  echo ""
  echo -e "  ${BOLD}Device preparation & Wi-Fi setup${NC}"
  echo ""
  echo "  If Xcode shows 'data corrupted or malformed' errors, choose R"
  echo "  to clear the device cache and re-prepare your iPhone."
  echo ""
  echo "  Setup steps:"
  echo "    1. Connect your iPhone via USB"
  echo "    2. On iPhone: Settings > Privacy & Security > Developer Mode > ON"
  echo "       (iPhone will restart — wait for it)"
  echo "    3. Open Xcode > Window > Devices and Simulators"
  echo "    4. Wait for 'Preparing device for development...' to finish"
  echo "    5. Wi-Fi debugging is automatic after USB pairing (Xcode 16+)"
  echo "    6. After pairing, USB is never needed again"
  echo ""
  read -p "  Press Enter to continue, or 'r' to repair device cache... " DEVICE_PREP

  if [ "$DEVICE_PREP" = "r" ] || [ "$DEVICE_PREP" = "R" ]; then
    echo ""
    info "Clearing Xcode device support cache..."
    rm -rf ~/Library/Developer/Xcode/iOS\ DeviceSupport/*
    ok "Device support cache cleared"

    info "Clearing CoreDevice cache..."
    rm -rf ~/Library/Developer/CoreSimulator/Caches/* 2>/dev/null || true
    ok "CoreDevice cache cleared"

    info "Restarting Xcode..."
    killall Xcode 2>/dev/null || true
    sleep 2
    open -a Xcode
    echo ""
    echo "  Xcode is restarting. Wait for it to detect your device."
    echo "  In Xcode > Window > Devices and Simulators:"
    echo "    - Your iPhone should appear and show 'Preparing device...'"
    echo "    - This takes 1-2 minutes"
    echo "    - Once it shows the iOS version, preparation is complete"
    echo ""
    read -p "  Press Enter when device preparation is done... "
    ok "Device repaired"
  fi

  # ── Save to defaults ──
  # Append or update mobile fields in defaults.env
  # Remove old mobile lines first, then append
  if [ -f "$DEFAULTS_FILE" ]; then
    grep -v '^APPLE_TEAM_ID=' "$DEFAULTS_FILE" \
      | grep -v '^IOS_DEVICE_UDID=' \
      | grep -v '^IOS_DEVICE_NAME=' > "$DEFAULTS_FILE.tmp" || true
    mv "$DEFAULTS_FILE.tmp" "$DEFAULTS_FILE"
  fi

  cat >> "$DEFAULTS_FILE" <<MOBILE
APPLE_TEAM_ID=${APPLE_TEAM_ID}
IOS_DEVICE_UDID=${IOS_DEVICE_UDID}
IOS_DEVICE_NAME=${IOS_DEVICE_NAME}
MOBILE

  chmod 600 "$DEFAULTS_FILE"
  ok "Saved to $DEFAULTS_FILE (reused for all future projects)"
else
  ok "Team ID: $APPLE_TEAM_ID"
  ok "Device: $IOS_DEVICE_NAME ($IOS_DEVICE_UDID)"
fi

# ─── Step 7: Prebuild native project ────────────────────────────────
step "8/10" "Generating native iOS project (expo prebuild)..."

if [ -d "$MOBILE_DIR/ios" ] && [ "$FORCE_CLEAN" = false ]; then
  info "ios/ directory exists. Using it. (Run with --clean to regenerate.)"
else
  CLEAN_FLAG=""
  if [ -d "$MOBILE_DIR/ios" ]; then
    CLEAN_FLAG="--clean"
    info "Cleaning and regenerating ios/ directory..."
  fi
  (cd "$MOBILE_DIR" && npx expo prebuild --platform ios $CLEAN_FLAG --no-install)
  ok "Native project generated"
fi

# Pod install
info "Running pod install..."
(cd "$MOBILE_DIR/ios" && pod install --silent 2>&1 | tail -3)
ok "Pods installed"

# ─── Step 8: Build with xcodebuild ──────────────────────────────────
step "9/10" "Building for device..."

WORKSPACE=$(find "$MOBILE_DIR/ios" -name "*.xcworkspace" -maxdepth 1 | head -1)
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
DERIVED_DATA="$MOBILE_DIR/ios/build"

# Resolve the correct UDID for xcodebuild.
# xcodebuild needs the traditional UDID (from xctrace), NOT the CoreDevice UUID (from devicectl).
# If the saved UDID is a CoreDevice UUID, look up the traditional one.
XCODE_UDID="$IOS_DEVICE_UDID"
XCTRACE_MATCH=$(xcrun xctrace list devices 2>/dev/null | grep -i "${IOS_DEVICE_NAME:-iPhone}" | head -1 || true)
if [ -n "$XCTRACE_MATCH" ]; then
  RESOLVED_UDID=$(echo "$XCTRACE_MATCH" \
    | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{16}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{40}' || true)
  if [ -n "$RESOLVED_UDID" ] && [ "$RESOLVED_UDID" != "$IOS_DEVICE_UDID" ]; then
    info "Resolved xcodebuild UDID: $RESOLVED_UDID (saved was CoreDevice UUID)"
    XCODE_UDID="$RESOLVED_UDID"
  fi
fi

BUILD_CONFIG="Debug"
if [ "$BUILD_RELEASE" = true ]; then
  BUILD_CONFIG="Release"
fi

echo ""
info "Workspace: $WORKSPACE"
info "Scheme:    $SCHEME"
info "Team:      $APPLE_TEAM_ID"
info "Device:    $XCODE_UDID"
info "Config:    $BUILD_CONFIG"
echo ""

# Unlock login keychain for non-interactive (daemon/pm2) builds
if [ -n "$KEYCHAIN_PASSWORD" ]; then
  info "Unlocking login keychain for automated build..."
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" ~/Library/Keychains/login.keychain-db
  ok "Keychain unlocked"
fi

XCODE_AUTH_FLAGS=()
if [ -n "$ASC_KEY_PATH" ] && [ -n "$ASC_KEY_ID" ] && [ -n "$ASC_ISSUER_ID" ]; then
  info "Using App Store Connect API key for provisioning"
  XCODE_AUTH_FLAGS=(
    -authenticationKeyPath "$ASC_KEY_PATH"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
  )
else
  warn "No App Store Connect API key configured."
  echo ""
  echo -e "  ${BOLD}Headless/CI builds require an API key for code signing.${NC}"
  echo "  Without it, xcodebuild needs an interactive Xcode session."
  echo ""
  echo "  To set up:"
  echo "    1. Go to App Store Connect > Users & Access > Integrations > Team Keys"
  echo "    2. Create a key with 'Developer' role"
  echo "    3. Download the .p8 file (one-time download)"
  echo "    4. Add to $DEFAULTS_FILE:"
  echo "         ASC_KEY_PATH=/path/to/AuthKey_XXXXXX.p8"
  echo "         ASC_KEY_ID=<Key ID from App Store Connect>"
  echo "         ASC_ISSUER_ID=<Issuer ID from App Store Connect>"
  echo ""
fi

xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$BUILD_CONFIG" \
  -destination "id=$XCODE_UDID" \
  -derivedDataPath "$DERIVED_DATA" \
  -allowProvisioningUpdates \
  "${XCODE_AUTH_FLAGS[@]}" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CODE_SIGN_STYLE="Automatic" \
  CODE_SIGN_IDENTITY="Apple Development" \
  build \
  2>&1 | tail -20

BUILD_EXIT=${PIPESTATUS[0]}
if [ "$BUILD_EXIT" -ne 0 ]; then
  err "xcodebuild failed (exit $BUILD_EXIT)"
  echo ""
  echo "  Common fixes:"
  echo "    - Trust your dev certificate on iPhone:"
  echo "      Settings > General > VPN & Device Management"
  echo "    - Add Apple ID in Xcode: Settings > Accounts"
  echo "    - Re-run with --setup if Team ID is wrong"
  echo "    - Re-run with --clean if native project is stale"
  exit 1
fi
ok "Build succeeded"

# ─── Step 9: Install on device ──────────────────────────────────────
step "10/10" "Installing on device..."

# Find the built .app (matches Debug-iphoneos or Release-iphoneos)
APP_PATH=$(find "$DERIVED_DATA/Build/Products" -name "*.app" -path "*${BUILD_CONFIG}-iphoneos*" | head -1)

if [ -z "$APP_PATH" ]; then
  err "Could not find built .app bundle."
  echo "  Check $DERIVED_DATA/Build/Products/ manually."
  exit 1
fi

info "App: $APP_PATH"

# devicectl needs the CoreDevice UUID (different from xcodebuild's traditional UDID).
# Look it up by device name at install time.
COREDEVICE_UUID=$(xcrun devicectl list devices 2>/dev/null \
  | grep -i "${IOS_DEVICE_NAME:-iPhone}" | head -1 \
  | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' || true)

INSTALLED=false

# Try xcrun devicectl with CoreDevice UUID (Xcode 15+)
if [ -n "$COREDEVICE_UUID" ]; then
  info "CoreDevice UUID: $COREDEVICE_UUID"
  if xcrun devicectl device install app --device "$COREDEVICE_UUID" "$APP_PATH" 2>&1 | tail -5; then
    ok "Installed on $IOS_DEVICE_NAME"
    INSTALLED=true
  fi
fi

# Fallback: try ios-deploy with traditional UDID
if [ "$INSTALLED" = false ] && command -v ios-deploy &>/dev/null; then
  ios-deploy --id "$XCODE_UDID" --bundle "$APP_PATH" --no-wifi 2>&1 | tail -5
  ok "Installed on $IOS_DEVICE_NAME"
  INSTALLED=true
fi

if [ "$INSTALLED" = false ]; then
  warn "Auto-install failed. You can install manually from Xcode:"
  echo "    Open $WORKSPACE > Product > Destination > $IOS_DEVICE_NAME > Run"
fi

# ─── Done ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Build complete!${NC}"
echo ""
echo "  App installed on: $IOS_DEVICE_NAME"
echo ""

if [ "$BUILD_RELEASE" = true ]; then
  echo -e "  ${BOLD}Standalone build — no dev server needed.${NC}"
  echo "  Just open the app on your phone."
  echo ""
  echo -e "  ${BOLD}Test push notifications:${NC}"
  echo "    1. Open the app — it asks for notification permission"
  echo "    2. Push token is logged to console (check Xcode > Debug > Console)"
  echo "    3. Send a test: npx expo notifications:send --to <token>"
else
  echo -e "  ${BOLD}Start the dev server:${NC}"
  echo "    cd packages/mobile && npx expo start --dev-client"
  echo ""
  echo -e "  ${BOLD}Test push notifications:${NC}"
  echo "    1. Open the app — it asks for notification permission"
  echo "    2. Push token is logged to the dev server console"
  echo "    3. Send a test: npx expo notifications:send --to <token>"
fi
echo ""
echo -e "  ${DIM}Re-run anytime: ./scripts/build-device.sh${NC}"
echo -e "  ${DIM}Dev client:     ./scripts/build-device.sh --debug${NC}"
echo -e "  ${DIM}Force clean:    ./scripts/build-device.sh --clean${NC}"
echo -e "  ${DIM}Reconfigure:    ./scripts/build-device.sh --setup${NC}"
