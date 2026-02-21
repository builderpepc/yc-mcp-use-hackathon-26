# Infrastructure Visualizer — Architecture & Stack

## Overview

An MCP App that lets non-technical users design, visualize, and deploy cloud infrastructure through natural language. The user describes their project in plain English; an AI generates a Pulumi infrastructure program; and an interactive graph renders inline inside the chat — showing all cloud resources before anything is deployed. A single Deploy button kicks off the actual deployment and streams live logs back into the UI.

---

## Target User

Non-technical founders and indie developers who are shipping projects but lack the knowledge to deploy them securely and scalably. They are using Claude on the web (claude.ai) or ChatGPT — not local tools like Claude Desktop or Cursor.

---

## Full Stack

| Layer | Technology |
|---|---|
| MCP server runtime | Node.js + TypeScript |
| MCP framework | `@modelcontextprotocol/sdk` |
| MCP Apps framework | `@modelcontextprotocol/ext-apps` |
| UI graph library | React Flow |
| IaC engine | Pulumi Automation API (`@pulumi/pulumi`) |
| State + credential hosting | Pulumi Cloud (free tier) |
| Remote deployment runner | Pulumi Deployments |
| Code generation (nested agent) | OpenAI API |
| Server hosting | Railway / Render / Fly.io |

---

## Architecture Diagram

```
Claude.ai / ChatGPT (web)
        ↕ MCP over HTTPS
Your hosted MCP Server (Node.js on Railway/Render/Fly.io)
        ↕ OpenAI API          ← generates Pulumi TypeScript code
        ↕ Pulumi Automation API  ← runs preview() and up()
        ↕ Pulumi Cloud API
            → State backend (free tier)
            → Pulumi Deployments (stores user credentials, runs pulumi up)
                → AWS / GCP / Azure
```

---

## MCP Tools Exposed

### `generate_infrastructure(description: string)`
Called by the user's AI when the user describes their project. The server calls the OpenAI API with the description to generate a Pulumi TypeScript program, runs `stack.preview()` via the Automation API to get a structured resource list, converts that into React Flow graph data, and returns a rendered MCP App to the host.

### `update_infrastructure(change_description: string)`
Called when the user requests modifications to their architecture (e.g. "add a Redis cache"). Regenerates the Pulumi program, re-runs preview, and returns a refreshed MCP App with the updated graph.

### `deploy()`
Triggered by the Deploy button inside the MCP App UI (not via chat message). Calls `stack.up()` through Pulumi Deployments and streams structured log output back into the MCP App's live log panel.

---

## User Flows

### Flow 1 — First-time setup
1. User installs and connects the MCP server to their AI client (one-time)
2. User connects their cloud provider credentials to Pulumi Cloud (one-time, through Pulumi's own UI)
3. User is ready — no CLI, no local tooling required

### Flow 2 — Designing an architecture
1. User describes their project in natural language:
   *"I'm building a Next.js app with a Postgres database and file uploads"*
2. The user's AI (Claude / ChatGPT) decides to call `generate_infrastructure`
3. The MCP server calls the OpenAI API with the description → receives a Pulumi TypeScript program
4. The Automation API runs `stack.preview()` on the generated program → returns a structured resource list
5. The server converts the resource list into React Flow nodes and edges
6. The server returns an MCP App bundle to the host
7. The host (Claude.ai) renders the interactive graph inline in the conversation
8. The user sees their full cloud architecture visualized — EC2/Lambda, RDS, S3, etc. — with friendly labels, icons, and estimated monthly costs per resource

### Flow 3 — Iterating on the architecture
1. User clicks a node in the graph and asks in chat: *"Do I actually need this NAT Gateway?"*
2. The user's AI explains the resource in plain English, in context
3. User says: *"Remove it and use a simpler networking setup"*
4. The user's AI calls `update_infrastructure` with the change description
5. The graph re-renders with the updated architecture
6. This loop continues until the user is satisfied

### Flow 4 — Deploying
1. User clicks the **Deploy** button inside the MCP App UI
2. The MCP App sends a tool call back to the server via the MCP postMessage channel
3. The server triggers `stack.up()` via the Pulumi Deployments API
4. The MCP App's log panel streams live deployment output — resources appearing one by one
5. On completion, the graph updates node states to reflect what's live
6. The user's infrastructure is deployed — no terminal, no YAML, no manual steps

---

## Key Differentiators from Existing Tooling

**vs. Pulumi Cloud console:** Pulumi's graph view is post-deployment only. This app shows architecture *before* anything is deployed, in the same interface where the design conversation is happening.

**vs. Pulumi's existing MCP server:** Tool-based only, no MCP Apps support, no visual feedback loop, oriented toward technical users with existing stacks.

**vs. talking to an AI directly about infrastructure:** Text descriptions of architecture are hard to verify and easy to misunderstand. A visual graph gives the non-technical user genuine comprehension and control.

**vs. a standalone web app:** The graph lives inside the conversation. Every chat message can reshape it. The user never switches context.

---

## Hackathon Scope Notes

The trickiest integration on the day is **Pulumi Deployments** — triggering a remote run and streaming logs back into the MCP App requires a polling loop or webhook. If time is short, a viable fallback for the demo is running `stack.up()` directly on the server process with demo credentials pre-configured, framing Pulumi Deployments as the production path in the pitch.

The nested agent (OpenAI) is used only for code generation. The user's AI (Claude on claude.ai) handles all conversation, tool invocation decisions, and resource explanation.
