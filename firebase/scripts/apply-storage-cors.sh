#!/usr/bin/env bash
# Applies the CORS config in firebase/storage.cors.json to the Firebase Storage
# bucket so bistar.app and admin.bistar.app can play videos via <video> from
# signed URLs pointing at storage.googleapis.com.
#
# Requires: gcloud authenticated as a principal with storage.buckets.update on
# bistar-app. Run from anywhere.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CORS_FILE="${SCRIPT_DIR}/../storage.cors.json"
BUCKET="gs://bistar-app.firebasestorage.app"

gcloud storage buckets update "$BUCKET" --cors-file="$CORS_FILE"
gcloud storage buckets describe "$BUCKET" --format="yaml(cors_config)"
