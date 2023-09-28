#!/bin/sh
DOCUMENT_ROOT=/var/www/sources

# Take site offline
echo "Taking site offline..."
touch $DOCUMENT_ROOT/maintenance.file

# Swap over the content
echo "Deploying content..."
mkdir -p $DOCUMENT_ROOT/Rumble
cp rumble.png $DOCUMENT_ROOT/Rumble
cp RumbleConfig.json $DOCUMENT_ROOT/Rumble
cp RumbleScript.js $DOCUMENT_ROOT/Rumble
sh sign.sh $DOCUMENT_ROOT/Rumble/RumbleScript.js $DOCUMENT_ROOT/Rumble/RumbleConfig.json

# Notify Cloudflare to wipe the CDN cache
echo "Purging Cloudflare cache for zone $CLOUDFLARE_ZONE_ID..."
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -H "Content-Type: application/json" \
     --data '{"files":["https://plugins.grayjay.app/Rumble/rumble.png", "https://plugins.grayjay.app/Rumble/RumbleConfig.json", "https://plugins.grayjay.app/Rumble/RumbleScript.js"]}'

# Take site back online
echo "Bringing site back online..."
rm $DOCUMENT_ROOT/maintenance.file
