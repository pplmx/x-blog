# Runs on the deployment host, piped into `sh -s` right after the five
# newline-separated values the ssh command reads (DEPLOY_SHA, BACKEND_IMAGE,
# FRONTEND_IMAGE, GHCR_USER, GHCR_TOKEN). Keep it POSIX sh — the remote shell
# is whatever `sh` is on the server.
#
# Lives here rather than inline in .github/workflows/deploy.yml so it can be
# linted (shellcheck) and reviewed as a script instead of a nested heredoc.
set -eu
cd /opt/x-blog
git fetch origin main
CURRENT_MAIN="$(git rev-parse FETCH_HEAD)"
if [ "$DEPLOY_SHA" != "$CURRENT_MAIN" ]; then
  echo "Skipping stale commit $DEPLOY_SHA; main is $CURRENT_MAIN"
  exit 0
fi
git checkout --detach "$DEPLOY_SHA"
DOCKER_CONFIG="$(mktemp -d)"
export DOCKER_CONFIG
cleanup_docker() {
  docker logout ghcr.io >/dev/null 2>&1 || true
  rm -rf "$DOCKER_CONFIG"
}
trap cleanup_docker EXIT
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
export BACKEND_IMAGE FRONTEND_IMAGE
docker compose pull backend frontend
docker compose up -d --no-build --remove-orphans --wait --wait-timeout 120
docker image prune -f
