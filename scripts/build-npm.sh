#!/usr/bin/env bash
#
# Bundle the tack CLI into a single file that runs under Bun, ready to publish as
# the @playsthisgame/tack npm package. Run from the repo root. Requires bun.
#
# The CLI is a Bun program (it uses bun:sqlite), so the published bin runs under
# Bun via its `#!/usr/bin/env bun` shebang — users need Bun installed. The native
# `@xenova/transformers` dep (onnxruntime-node) is left external and declared as a
# runtime dependency so npm installs the correct platform binary on the user's
# machine; everything else (workspace packages, ink, ai-sdk, zod, …) is bundled in.
#
set -euo pipefail

ENTRY="packages/cli/src/index.ts"
OUT="npm/dist/index.js"

mkdir -p "$(dirname "$OUT")"

echo "==> bundling $ENTRY -> $OUT"
bun build "$ENTRY" \
  --target=bun \
  --external @xenova/transformers \
  --outfile "$OUT"

chmod +x "$OUT"
echo "==> done"
