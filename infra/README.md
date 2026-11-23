# infra/

Deployment-side files that nothing discovers by path — every one of them is
opened explicitly by CI, by a recipe, or by the server operator. Anything that
a tool finds implicitly stays where it is (see "What is deliberately not here").

## Contents

- `caddy/Caddyfile` — the host reverse proxy in front of the composed stack.
  Not part of `docker-compose.yml`; terminates TLS with ACME and proxies to the
  backend and frontend containers.

The remote half of the deploy (the shell script `.github/workflows/deploy.yml`
pipes into `sh -s`) deliberately stays inline in that workflow: it has exactly
one consumer, so a separate file would only add a hop that nothing lints.

## Deploy flow

1. `.github/workflows/test.yml` runs the gate on every push.
2. `.github/workflows/deploy.yml` builds both images on `main`, pushes them to
   GHCR by digest, then SSHes to the server.
3. On the server, the piped inline script fast-forwards to the deployed SHA,
   pulls the two images by digest, and runs `docker compose up -d --wait` in
   `/opt/x-blog` (the repo checkout on the server — the compose file must stay
   at the repo root because that directory is the deploy working directory).

## Checking a change

```bash
just caddy-check   # caddy validate --config infra/caddy/Caddyfile
```

The Caddy config replaces the former `nginx.conf`. One nginx feature has no
core Caddy equivalent: `proxy_cache` of Nuxt SSR responses (`proxy_cache_valid
200 1m`). Caddy's `cache` directive is a third-party plugin, so the micro-cache
is gone; if it is needed back, build Caddy with `xcaddy` and the
`cache-handler` module and add a `cache` block to the frontend `handle`.

## What is deliberately not here

Their location is part of their contract, so moving them here would break
discovery rather than tidy the tree:

- `.github/workflows/` — GitHub reads only that path.
- `justfile` — `just` searches upward from the caller's directory, and the
  recipes' `cd backend/nova` paths are relative to the justfile itself.
- `docker-compose.yml` — Compose discovers it in the working directory, and the
  server runs `docker compose` from the repo root.
- `backend/nova/Dockerfile`, `frontend/aura/Dockerfile` and their
  `.dockerignore` files — the build context must be the package directory.
- `ruff.toml`, `pytest.toml`, `ty.toml`, `.coveragerc.toml` — each tool loads
  the nearest config walking up from where it runs.
- `.pre-commit-config.yaml`, `.rumdl.toml` — discovered at the repo root.

New operational scripts (backups, certificate renewal, health probes) belong
here, not in a package directory.
