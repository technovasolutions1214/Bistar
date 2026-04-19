#!/usr/bin/env bash
# Applies the CORS config in firebase/storage.cors.json to the Firebase Storage
# bucket so novaflix.app and admin.novaflix.app can play videos via <video> from
# signed URLs pointing at storage.googleapis.com.
#
# Requires: gcloud authenticated as a principal with storage.buckets.update on
# novaflix-584d4. Run from anywhere.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CORS_FILE="${SCRIPT_DIR}/../storage.cors.json"
BUCKET="gs://novaflix-584d4.firebasestorage.app"

gcloud storage buckets update "$BUCKET" --cors-file="$CORS_FILE"
gcloud storage buckets describe "$BUCKET" --format="yaml(cors_config)"
