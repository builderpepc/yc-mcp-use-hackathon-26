#!/bin/bash
set -e

# Ensure Pulumi CLI is on PATH (installed to ~/.pulumi/bin by default)
export PATH="$HOME/.pulumi/bin:$PATH"

echo "Paste your tunnel URL from 'npx @mcp-use/tunnel 3000' (e.g. https://xyz.local.mcp-use.run):"
read -r TUNNEL_URL

# Strip trailing slash if present
TUNNEL_URL="${TUNNEL_URL%/}"

# MCP_URL is the server root (NOT the /mcp endpoint) — mcp-use uses it as a base for widget asset URLs
sed -i "s|MCP_URL=.*|MCP_URL=${TUNNEL_URL}|" .env

echo "Updated .env with MCP_URL=${TUNNEL_URL}"
echo "Building..."

npm run build

echo ""
echo "Done! Connect Claude to:  ${TUNNEL_URL}/mcp"
echo "(Run 'npx @mcp-use/tunnel 3000' in another terminal if not already running)"
echo ""

npm run start
