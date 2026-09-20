#!/usr/bin/env bash
#
# ARCA — start everything for local testing.
#
#   ./start.sh              start the agent and the web app, then open the UI
#   ./start.sh --replay     also start the demo incident, so the map has a fire
#   ./start.sh --check      run the tests and typecheck, then exit
#   ./start.sh --build      run a production build and serve that instead
#   ./start.sh --stop       stop anything this script left running
#
# Ctrl+C stops both services. No credentials are needed: with an empty .env you
# still get the full pipeline on the replay bundle.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$PWD"
RUN_DIR="$ROOT/.run"
AGENT_LOG="$RUN_DIR/agent.log"
WEB_LOG="$RUN_DIR/web.log"

# --- output ------------------------------------------------------------------

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[90m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; CYAN=""; RESET=""
fi

say()  { printf "%s\n" "$*"; }
step() { printf "%s==>%s %s\n" "$CYAN" "$RESET" "$*"; }
ok()   { printf "%s  ok%s %s\n" "$GREEN" "$RESET" "$*"; }
warn() { printf "%s  !!%s %s\n" "$YELLOW" "$RESET" "$*"; }
die()  { printf "%s  xx%s %s\n" "$RED" "$RESET" "$*" >&2; exit 1; }

# --- arguments ---------------------------------------------------------------

REPLAY=0; CHECK_ONLY=0; USE_BUILD=0; STOP_ONLY=0; OPEN_UI=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --replay)   REPLAY=1 ;;
    --check)    CHECK_ONLY=1 ;;
    --build)    USE_BUILD=1 ;;
    --stop)     STOP_ONLY=1 ;;
    --no-open)  OPEN_UI=0 ;;
    -h|--help)  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          die "Unknown option: $1  (try --help)" ;;
  esac
  shift
done

# --- stopping ----------------------------------------------------------------

stop_services() {
  local stopped=0
  for name in agent web; do
    local pidfile="$RUN_DIR/$name.pid"
    [[ -f "$pidfile" ]] || continue
    local pid; pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      # Kill the whole process group: pnpm spawns the real server as a child,
      # and killing only the parent leaves the port held by an orphan.
      kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      stopped=1
    fi
    rm -f "$pidfile"
  done
  [[ $stopped -eq 1 ]] && sleep 1
  return 0
}

if [[ $STOP_ONLY -eq 1 ]]; then
  step "Stopping ARCA"
  stop_services
  ok "Stopped."
  exit 0
fi

cleanup() {
  printf "\n"
  step "Shutting down"
  stop_services
  ok "Stopped. Logs kept in .run/"
}
trap cleanup EXIT INT TERM

# --- prerequisites -----------------------------------------------------------

step "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "node is not installed. Node 20 or newer is required."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 20 ]] || die "Node $NODE_MAJOR found; 20 or newer is required."

if ! command -v pnpm >/dev/null 2>&1; then
  die "pnpm is not installed. Install it with:  npm i -g pnpm"
fi

ok "node $(node -v), pnpm $(pnpm -v)"

mkdir -p "$RUN_DIR"

if [[ ! -d node_modules ]]; then
  step "Installing dependencies (first run, this takes a minute)"
  pnpm install
  ok "Dependencies installed"
fi

# --- environment -------------------------------------------------------------

if [[ -f .env ]]; then
  # Export for the web app. The agent loads .env itself via
  # --env-file-if-exists, but Next reads its own directory, not the repo root.
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  ok ".env loaded"
else
  warn "No .env found. Running with defaults — the replay demo still works."
  warn "Copy .env.example to .env when you have credentials to add."
fi

AGENT_PORT="${PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
# PORT is read by both the agent and Next. Sourcing one .env would otherwise
# hand the agent's port to the web app, which then fails to bind. Each service
# is started with its own PORT below; on a platform like Railway each service
# gets its own injected value and this does not arise.
unset PORT
AGENT_URL="http://localhost:$AGENT_PORT"
WEB_URL="http://localhost:$WEB_PORT"
export NEXT_PUBLIC_AGENT_URL="${NEXT_PUBLIC_AGENT_URL:-$AGENT_URL}"

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# --- checks only -------------------------------------------------------------

if [[ $CHECK_ONLY -eq 1 ]]; then
  step "Running tests"
  pnpm test
  step "Typechecking"
  pnpm typecheck
  ok "All checks passed."
  trap - EXIT INT TERM
  exit 0
fi

# --- ports -------------------------------------------------------------------

step "Checking ports"
stop_services   # clear anything a previous run left behind

for port in "$AGENT_PORT" "$WEB_PORT"; do
  if port_busy "$port"; then
    die "Port $port is in use by something this script did not start.
     Find it with:  lsof -nP -iTCP:$port -sTCP:LISTEN
     Or choose another port:  PORT=4001 ./start.sh"
  fi
done
ok "Ports $AGENT_PORT and $WEB_PORT are free"

# --- build -------------------------------------------------------------------

if [[ $USE_BUILD -eq 1 ]]; then
  step "Building for production (this is the build Railway runs)"
  pnpm build
  ok "Build complete"
  AGENT_CMD=(pnpm --filter @arca/agent start)
  WEB_CMD=(pnpm --filter @arca/web start)
else
  # The shared libraries must exist before anything that imports them runs.
  if [[ ! -f packages/core/dist/index.js || ! -f packages/db/dist/index.js ]]; then
    step "Building shared libraries"
    pnpm build:libs
    ok "Libraries built"
  fi
  AGENT_CMD=(pnpm --filter @arca/agent dev)
  WEB_CMD=(pnpm --filter @arca/web dev)
fi

# --- start -------------------------------------------------------------------

start_service() {
  local name="$1" log="$2"; shift 2
  : > "$log"
  # setsid gives the service its own process group so the whole tree can be
  # signalled on shutdown. Not present on macOS, where the plain PID is enough.
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" >>"$log" 2>&1 &
  else
    "$@" >>"$log" 2>&1 &
  fi
  echo $! > "$RUN_DIR/$name.pid"
}

wait_for() {
  local url="$1" label="$2" log="$3" tries="${4:-60}"
  for ((i = 0; i < tries; i++)); do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      return 0
    fi
    # Fail fast if the process died rather than waiting out the whole timeout.
    if grep -qiE "EADDRINUSE|Cannot find module|SyntaxError|failed to start" "$log" 2>/dev/null; then
      printf "\n"
      warn "$label failed to start. Last lines of $log:"
      tail -n 15 "$log" >&2
      return 1
    fi
    printf "."
    sleep 1
  done
  printf "\n"
  warn "$label did not answer within ${tries}s. Last lines of $log:"
  tail -n 15 "$log" >&2
  return 1
}

step "Starting the agent on :$AGENT_PORT"
start_service agent "$AGENT_LOG" env PORT="$AGENT_PORT" "${AGENT_CMD[@]}"
printf "   waiting"
wait_for "$AGENT_URL/api/health" "The agent" "$AGENT_LOG" 90 || exit 1
printf "\n"
ok "Agent ready — $AGENT_URL"

step "Starting the web app on :$WEB_PORT"
start_service web "$WEB_LOG" env PORT="$WEB_PORT" "${WEB_CMD[@]}"
printf "   waiting"
wait_for "$WEB_URL" "The web app" "$WEB_LOG" 120 || exit 1
printf "\n"
ok "Web ready — $WEB_URL"

# --- what this deployment can do ---------------------------------------------

say ""
step "What this deployment can do"
curl -fsS "$AGENT_URL/api/health" 2>/dev/null | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let health;
  try { health = JSON.parse(raw); } catch { return; }
  const labels = {
    deepfire: "Live detection (DeepFire)",
    talaia: "Exposure inventory (Talaia)",
    nebius: "Briefings and extraction (Nebius)",
    slng: "Voice calls (SLNG)",
    telegram: "Coordinator phone (Telegram)",
    outboundCalls: "Dialling real numbers",
    database: "Durable storage",
  };
  for (const [key, label] of Object.entries(labels)) {
    const on = health.capabilities?.[key];
    console.log(`     ${on ? "✓" : "·"} ${label}${on ? "" : "  (not configured)"}`);
  }
  if (health.capabilities?.exerciseMode) {
    console.log("     ⚠ Exercise mode is ON. Every message and call says SIMULACRO.");
  }
  console.log(`     storage: ${health.storage}`);
});
' || warn "Could not read /api/health"

# --- optional replay ---------------------------------------------------------

if [[ $REPLAY -eq 1 ]]; then
  say ""
  step "Starting the demo replay incident"
  BUNDLE="$(curl -fsS "$AGENT_URL/api/replay" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).bundles[0] || ""')"
  if [[ -z "$BUNDLE" ]]; then
    warn "No replay bundles found. Generate one with:  pnpm demo:bundle"
  else
    curl -fsS -X POST "$AGENT_URL/api/replay/$BUNDLE" | node -e '
      let raw = "";
      process.stdin.on("data", (c) => (raw += c));
      process.stdin.on("end", () => {
        const r = JSON.parse(raw);
        console.log(`     ${r.ranked} sites ranked, confirmed at ${r.confirmation.score}/100`);
      });
    ' || warn "Replay request failed"
    ok "Replay started ($BUNDLE)"
  fi
fi

# --- ready -------------------------------------------------------------------

say ""
printf "%s  ARCA is running%s\n" "$BOLD" "$RESET"
say ""
printf "     Operations screen   %s%s%s\n" "$BOLD" "$WEB_URL" "$RESET"
printf "     Agent API           %s\n" "$AGENT_URL"
printf "     %sLogs                .run/agent.log, .run/web.log%s\n" "$DIM" "$RESET"
say ""
printf "     %sTry: press play on the timeline to watch the fire spread,%s\n" "$DIM" "$RESET"
printf "     %sthen hover the confirmation score to see why it was confirmed.%s\n" "$DIM" "$RESET"
say ""
printf "     %sCtrl+C to stop both services.%s\n" "$DIM" "$RESET"
say ""

if [[ $OPEN_UI -eq 1 ]] && command -v open >/dev/null 2>&1; then
  open "$WEB_URL" 2>/dev/null || true
fi

# Surface anything either service logs from here on, so a failure that happens
# after startup is visible rather than buried in a file.
tail -f "$AGENT_LOG" "$WEB_LOG" 2>/dev/null &
wait $!
