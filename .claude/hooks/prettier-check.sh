#!/bin/bash
# PostToolUse hook: runs prettier --check on .svelte/.ts/.mjs files after Edit/Write
f=$(jq -r '.tool_input.file_path')
echo "$f" | grep -qE '\.(svelte|ts|mjs|js)$' || exit 0
cd "$(git rev-parse --show-toplevel)" && pnpm exec prettier --check "$f" 2>&1 | head -5
