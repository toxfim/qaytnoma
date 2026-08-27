#!/usr/bin/env bash
# Landing sahifasini serverda yangilash.
#
# Serverda ishlaydi (ydev, ~/projects/qaytnoma). Repo'ni tortadi va
# apps/landing/public ni nginx veb-ildiziga nusxalaydi. nginx `www-data`
# sifatida ishlaydi va /root ichiga kira olmaydi — shuning uchun simlink
# emas, nusxa.
#
# download/ papkasiga tegilmaydi: o'rnatgich (.exe) repo'da yo'q, u lokal
# mashinadan `pnpm deploy:installer` bilan to'g'ridan-to'g'ri veb-ildizga
# yuklanadi.
set -euo pipefail

REPO="${REPO:-$HOME/projects/qaytnoma}"
WEBROOT="${WEBROOT:-/var/www/qaytnoma.tez-agent.uz}"
BRANCH="${BRANCH:-v2}"

cd "$REPO"
git fetch -q origin "$BRANCH"
git checkout -q "$BRANCH"
git reset -q --hard "origin/$BRANCH"

mkdir -p "$WEBROOT/download"
rsync -a --delete --exclude 'download/' apps/landing/public/ "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"

echo "deploy: $(git rev-parse --short HEAD) → $WEBROOT"
ls -la "$WEBROOT" "$WEBROOT/download"
