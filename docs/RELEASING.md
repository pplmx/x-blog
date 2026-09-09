# Release Process

This document describes how to cut a release of X-Blog using a standard
production flow: version policy, release checklist, and the automation that
runs around a tag.

## Versioning

X-Blog follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **MAJOR** — breaking API/behavior changes or a stability declaration (0.1.0 → 1.0.0).
- **MINOR** — backward-compatible features.
- **PATCH** — backward-compatible bug fixes.

The version lives in the backend only (the frontend is a private Nuxt package
that does not carry its own version):

- `backend/nova/pyproject.toml` → `[project] version`
- `backend/nova/app/main.py` → `version="x.y.z"` (startup log + FastAPI)
- `backend/nova/app/routers/health.py` → `HealthResponse.version` default
  (returned by `GET /health`)

> **Tip:** add a matching `version` field to `frontend/aura/package.json` only
> if the UI ever needs to display its own version; today the health endpoint is
> the single source of truth for the running build.

## Release checklist

A release is cut only on `main` **after the `Test` workflow is green on the
exact commit being tagged**. The `Deploy` workflow builds GHCR images and rolls
production only after a successful `Test`, so a red build stalls the pipeline.

1. **Confirm `main` is green.**

   ```bash
   gh run list --workflow=test.yml --branch main --limit 3
   ```

   All of `backend-test`, `backend-test-postgres`, `frontend-test`, and
   `e2e-test` must pass for the target commit. Locally, `just ci` runs the same
   gates (lint, format, typecheck, tests, coverage ≥80%, PostgreSQL parity).

2. **Choose a version** per the policy above (e.g. `v0.2.0`).

3. **Update the version** (replace `0.1.0` everywhere):

   ```bash
   # backend/nova/pyproject.toml
   sed -i 's/^version = "0.1.0"/version = "0.2.0"/' backend/nova/pyproject.toml
   # backend/nova/app/main.py
   sed -i 's/version="0.1.0"/version="0.2.0"/' backend/nova/app/main.py
   # backend/nova/app/routers/health.py
   sed -i 's/version: str = "0.1.0"/version: str = "0.2.0"/' backend/nova/app/routers/health.py
   ```

4. **Update `CHANGELOG.md`** (Keep a Changelog format):
    - Move the unreleased notes under a new `## [x.y.z] - YYYY-MM-DD` heading.
    - Add a comparison link at the bottom:
   `[x.y.z]: https://github.com/pplmx/x-blog/releases/tag/vx.y.z`
    - Read the recent `feat`/`fix`/`perf`/`security` commits to make sure the
   notable entries are captured.

5. **Open a release preparation PR** (`chore(release): prepare vx.y.z`) with the
   version bump + CHANGELOG, and merge it once the `Test` workflow is green.

6. **Tag and push.**

   ```bash
   git checkout main && git pull --ff-only
   git tag -a v0.1.0 -m "X-Blog v0.1.0"
   git push origin v0.1.0
   ```

7. **Create the GitHub Release** with notes from the CHANGELOG:

   ```bash
   # extract the changelog body for this version and paste into --notes-file
   gh release create v0.1.0 --title "X-Blog v0.1.0" --notes-file /tmp/release-notes.md
   ```

   The `Deploy` workflow is triggered by the `Test` workflow on the tagged
   commit (it deploys by commit SHA, so a tag does not redeploy anything new if
   main was already live; the tag exists for provenance and pullability).

## Branch protection & deploy requirements

- `main` requires the `Test` workflow to pass before merge.
- `production` is a protected environment restricted to `main`; the `Deploy`
  workflow builds and pushes `ghcr.io/.../backend|frontend@<sha>` images and
  rolls them via SSH to `/opt/x-blog` (`docker compose pull` + `up -d`).
- Release tags are **pushed, never force-moved**. Any release correction is a
  new PATCH version.

## Hotfixes

For an urgent production fix, follow the same checklist on a branch cut from
`main`, open a PR (the `Test` workflow runs), and merge it — production picks
it up from the next green `main`. Do not tag from a hotfix branch; the release
tag must be on `main`.

## References

- `docs/deployment.md` — server topology, environment variables, rate-limit
  tuning, and the SSH/GHCR deploy details.
- `.github/workflows/test.yml` — the CI gate.
- `.github/workflows/deploy.yml` — build + roll to production.
