# Clasper - common targets for dev and CI
# Use: make setup (first time), make dev, make workspace, make test, etc.

.PHONY: install dev build test setup workspace clean conformance dispatcher build-ops seed-ops dev-seeded seed-ops-seeded reset-seeded-db reset-reseed-ops-seeded

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
# One command to clear and repopulate. Usage:
#   ADAPTER_JWT_SECRET=dev-only-secret make reset-reseed-ops-seeded
reset-reseed-ops-seeded:
	@echo "Note: the server must already be running with CLASPER_DB_PATH=$${CLASPER_DB_PATH:-./clasper.seed.db}"
	SEED_RESET=1 npm run seed:ops

# Delete the seeded DB file (use with dev-seeded).
reset-seeded-db:
	rm -f $${CLASPER_DB_PATH:-./clasper.seed.db}

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
