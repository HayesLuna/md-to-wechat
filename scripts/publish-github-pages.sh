#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
repository='HayesLuna/md-to-wechat'
# Use injected authentication. Never read or print a token value.
gh api "repos/$repository" --jq '{repository:.full_name,can_push:.permissions.push,can_administer:.permissions.admin}'
# Refuse to overwrite a different remote main history.
if git ls-remote --exit-code origin refs/heads/main >/dev/null; then
  git fetch origin main
  if ! git rev-parse --verify HEAD >/dev/null 2>&1 || ! git merge-base --is-ancestor FETCH_HEAD HEAD; then
    printf '%s\n' '远端 main 有其他提交，请先检查并合并；不会强制推送。' >&2
    exit 1
  fi
else
  git_result=$?
  if [ "$git_result" -ne 2 ]; then exit "$git_result"; fi
fi
npm run build
pages_metadata="$(mktemp /tmp/mojian-pages-metadata.XXXXXX)"
pages_error="$(mktemp /tmp/mojian-pages-error.XXXXXX)"
trap 'rm -f "$pages_metadata" "$pages_error"' EXIT
if gh api "repos/$repository/pages" >"$pages_metadata" 2>"$pages_error"; then
  python3 - "$pages_metadata" <<'PY'
import json,sys
config=json.load(open(sys.argv[1]))
if config.get('build_type')!='workflow':
 raise SystemExit('现有 Pages 使用其他发布方式，请先检查配置；不会自动覆盖。')
PY
else
  if rg -q 'HTTP 404' "$pages_error"; then
    gh api --method POST "repos/$repository/pages" -f build_type=workflow --silent
  else
    cat "$pages_error" >&2
    exit 1
  fi
fi
# Explicit project paths avoid accidentally committing unrelated user files.
git add -- .gitignore README.md index.html package.json package-lock.json tsconfig.json vite.config.ts playwright.config.ts src tests scripts .github/workflows/pages.yml
if ! git diff --cached --quiet; then
  git commit -m 'Publish 墨笺 Markdown web app'
fi
git push origin HEAD:refs/heads/main
printf '%s\n' '源码已推送；等待 GitHub Actions 的 Pages 发布结果，不能把推送成功当作网站已可访问。'
gh api "repos/$repository/pages" --jq .html_url
