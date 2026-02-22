
# InfraPilot

A simple solution for non-technical builders to get their projects deployed on the cloud by chatting with the AI they already use.

## How it works

1. User adds our MCP App  
2. User describes what they’re trying to deploy  
3. AI provides an interactive infrastructure diagram where the user can ask questions or suggest changes  
4. User clicks “Deploy” button when satisfied  
5. AI guides user through setting up a Pulumi account if this is their first time, then remembers their credentials  
6. The user can then deploy directly to AWS or GCP from within their AI chat

## Potential additions

- The user could connect their AI to other MCPs like GitHub MCP so their AI has direct access to understand what infrastructure is needed  
- Pulumi MCP, GCP/AWS MCP could provide additional context and abilities

---
# MCP Server built with mcp-use

This is an MCP server project bootstrapped with [`create-mcp-use-app`](https://mcp-use.com/docs/typescript/getting-started/quickstart).

## Getting Started

First, run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000/inspector](http://localhost:3000/inspector) with your browser to test your server.

You can start building by editing the entry file. Add tools, resources, and prompts — the server auto-reloads as you edit.

## Learn More

To learn more about mcp-use and MCP:

- [mcp-use Documentation](https://mcp-use.com/docs/typescript/getting-started/quickstart) — guides, API reference, and tutorials

## Deploy on Manufact Cloud

```bash
npm run deploy
```
