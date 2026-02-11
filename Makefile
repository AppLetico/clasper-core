# Clasper - common targets for dev and CI
# Use: make setup (first time), make dev, make workspace, make test, etc.

.PHONY: install dev build test setup workspace clean conformance dispatcher build-ops seed-ops dev-seeded seed-ops-seeded reset-db reset-seeded-db reset-reseed-ops-seeded seed-openclaw-policies demo-openclaw

install:
	npm install

# One-command setup: install deps, copy .env.example → .env (if missing), scaffold workspace
setup: install
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example"; else echo ".env already exists (skipped)"; fi
	@$(MAKE) workspace
	@echo ""
	@echo "Setup done. Next: edit .env (BACKEND_URL, AGENT_JWT_SECRET, LLM keys), then run: make dev"

dev:
	npm run dev

# Seed realistic data for the local Ops Console UI.
# Requires: ADAPTER_JWT_SECRET (and OPS_LOCAL_API_KEY / AGENT_DAEMON_API_KEY if you’ve enabled them).
seed-ops:
	npm run seed:ops

# Convenience: run Core against a dedicated seeded DB file.
# Usage:
#   ADAPTER_JWT_SECRET=dev-only-secret make dev-seeded
dev-seeded:
	CLASPER_DB_PATH=$${CLASPER_DB_PATH:-./clasper.seed.db} npm run dev

# Seed data into the dedicated seeded DB file.
# Usage:
#   ADAPTER_JWT_SECRET=dev-only-secret make seed-ops-seeded
seed-ops-seeded:
	@echo "Note: the server must already be running with CLASPER_DB_PATH=$${CLASPER_DB_PATH:-./clasper.seed.db}"
	npm run seed:ops

# Reset local DB tables and reseed (server must already be running with seeded DB).
# One command to clear and repopulate. Use same CLASPER_PORT as server if not 8081.
#   ADAPTER_JWT_SECRET=dev-only-secret make reset-reseed-ops-seeded
#   CLASPER_PORT=8082 make reset-reseed-ops-seeded   # when server runs on 8082
reset-reseed-ops-seeded:
	@echo "Note: server must be running (CLASPER_DB_PATH=$${CLASPER_DB_PATH:-./clasper.seed.db}, same port as CLASPER_PORT)"
	SEED_RESET=1 npm run seed:ops

# Delete the seeded DB file (use with dev-seeded).
# Usage:
#   make reset-seeded-db
#   CLASPER_DB_PATH=./tmp/my-seeded.db make reset-seeded-db
reset-seeded-db:
	@if pgrep -f "tsx watch src/server/index.ts|dist/server/index.js" >/dev/null && [ "$${FORCE:-0}" != "1" ]; then \
		echo "Clasper server appears to be running."; \
		echo "Stop it first, or run FORCE=1 make reset-seeded-db"; \
		exit 1; \
	fi
	@DB="$${CLASPER_DB_PATH:-./clasper.seed.db}"; \
	rm -f "$$DB" "$$DB-wal" "$$DB-shm" "$$DB-journal"; \
	echo "Reset seeded DB: $$DB"

# Delete the default local DB file + SQLite sidecars.
# Usage:
#   make reset-db
#   CLASPER_DB_PATH=./tmp/my.db make reset-db
reset-db:
	@if pgrep -f "tsx watch src/server/index.ts|dist/server/index.js" >/dev/null && [ "$${FORCE:-0}" != "1" ]; then \
		echo "Clasper server appears to be running."; \
		echo "Stop it first, or run FORCE=1 make reset-db"; \
		exit 1; \
	fi
	@DB="$${CLASPER_DB_PATH:-./clasper.db}"; \
	rm -f "$$DB" "$$DB-wal" "$$DB-shm" "$$DB-journal"; \
	echo "Reset DB: $$DB"

dispatcher:
	npm run dispatcher

build:
	npm run build

test:
	npm test

# Create a workspace from the built-in template (./workspace, or set CLASPER_WORKSPACE)
workspace:
	npm run init-workspace

# Overwrite existing workspace files
workspace-force:
	CLASPER_WORKSPACE=$${CLASPER_WORKSPACE:-./workspace} npm run init-workspace -- --force

# Ops Console — production build only (minified, no live reload)
build-ops:
	npm run build:ops

clean:
	rm -rf dist src/ops-ui/dist node_modules/.cache

# Run control-plane conformance against BACKEND_URL (requires AGENT_TOKEN)
conformance:
	npm run conformance

# ─── OpenClaw Integration ────────────────────────────────────────────
# Seed the default OpenClaw governance policies into Clasper Core.
# Requires: Clasper Core running, OPS_LOCAL_API_KEY set.
# Usage:
#   make seed-openclaw-policies
#   CLASPER_PORT=8082 make seed-openclaw-policies
seed-openclaw-policies:
	npx tsx scripts/seed-openclaw-policies.ts

# Full OpenClaw integration demo:
# 1. Seed default policies
# 2. Print setup instructions for connecting OpenClaw
demo-openclaw: seed-openclaw-policies
	@echo ""
	@echo "  ══════════════════════════════════════════════════════════════"
	@echo "  OpenClaw × Clasper Integration Demo"
	@echo "  ══════════════════════════════════════════════════════════════"
	@echo ""
	@echo "  Default policies seeded. Next steps:"
	@echo ""
	@echo "  1. Install the Clasper plugin in OpenClaw:"
	@echo "     openclaw plugins install ./integrations/openclaw"
	@echo ""
	@echo "  2. Start OpenClaw with the plugin:"
	@echo "     CLASPER_URL=http://localhost:$${CLASPER_PORT:-8081} \\"
	@echo "     openclaw gateway start --plugins clasper-openclaw"
	@echo ""
	@echo "  3. Open the Ops Console:"
	@echo "     http://localhost:$${CLASPER_PORT:-8081}/"
	@echo ""
	@echo "  4. Try the demo scenarios:"
	@echo "     - Agent tries 'rm -rf' → blocked (delete_file = deny)"
	@echo "     - Agent runs 'npm install' → requires approval (exec = require_approval)"
	@echo "     - Agent reads a file → allowed (read_file = allow)"
	@echo ""
	@echo "  No OpenClaw tool with side effects can execute unless Clasper allows it."
	@echo "  ══════════════════════════════════════════════════════════════"
	@echo ""
