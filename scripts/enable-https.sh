#!/usr/bin/env bash
# qaytnoma.tez-agent.uz uchun HTTPS.
#
# Domen nameserverlari ahost'da rdns1-3.ahost.uz ga o'zgartirildi; .uz
# registri delegatsiyani bir necha soatgacha yangilaydi. Certbot'ning HTTP-01
# tekshiruvi ommaviy DNS ishlashini talab qiladi, shuning uchun skript
# serverda cron orqali har 5 daqiqada chaqiriladi: DNS tarqalganini ko'rsa,
# sertifikat oladi, nginx'ni HTTPS'ga o'tkazadi va o'zini cron'dan olib
# tashlaydi. Undan keyin yangilanishni certbot'ning o'z taymeri qiladi.
#
# Qo'lda ishga tushirish:  bash ~/projects/qaytnoma/scripts/enable-https.sh
# Jurnal:                   /var/log/qaytnoma-https.log
set -uo pipefail

# Cron minimal PATH bilan ishlaydi (/usr/bin:/bin) — certbot esa snap orqali
# o'rnatilgan va /snap/bin da turadi. Aks holda "certbot: command not found".
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin

DOMAIN=qaytnoma.tez-agent.uz
IP=139.162.197.219
TAG="[enable-https $(date -Is)]"

remove_cron() {
  crontab -l 2>/dev/null | grep -v 'enable-https.sh' | crontab -
}

if [ -e "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  echo "$TAG sertifikat allaqachon bor — cron yozuvi olib tashlanadi"
  remove_cron
  exit 0
fi

for resolver in 8.8.8.8 1.1.1.1; do
  got=$(dig +short +time=4 +tries=1 "$DOMAIN" @"$resolver" | head -1)
  if [ "$got" != "$IP" ]; then
    echo "$TAG $resolver → '${got:--}' — DNS hali tarqalmagan"
    exit 0
  fi
done

echo "$TAG DNS tayyor, certbot ishga tushmoqda"
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --keep-until-expiring \
  && nginx -t && systemctl reload nginx; then
  remove_cron
  echo "$TAG HTTPS yoqildi: https://$DOMAIN"
else
  echo "$TAG certbot xato bilan tugadi — keyingi urinish 5 daqiqadan keyin"
  exit 1
fi
