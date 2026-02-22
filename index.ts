import { MCPServer, object, text, widget } from "mcp-use/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { generatePulumiCode, updatePulumiCode } from "./src/generate-code.js";
import {
  buildGraphFromEvents,
  type PreviewEvent,
} from "./src/graph-converter.js";
import {
  checkSubprocessSupport,
  parseResourcesFromCode,
  runDeploy,
  runPreview,
  writeProgram,
} from "./src/pulumi-stack.js";
import { estimateMonthlyCost, totalEstimatedCost } from "./src/cost-estimator.js";
import { getStack, setStack } from "./src/stack-store.js";
import { setPulumiSession, getPulumiSession } from "./src/pulumi-session.js";

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new MCPServer({
  name: "yc-mcp-use-hackathon-26",
  title: "Infrastructure Visualizer",
  version: "1.0.0",
  description:
    "Design and visualize cloud infrastructure through natural language. Generates Pulumi TypeScript programs and renders interactive React Flow graphs.",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
  favicon: "favicon.ico",
  websiteUrl: "https://mcp-use.com",
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["512x512"],
    },
  ],
});

// Check subprocess support at startup (cached)
let subprocessSupported = false;
checkSubprocessSupport().then((result) => {
  subprocessSupported = result;
  console.log(
    `Pulumi subprocess support: ${result ? "enabled" : "disabled (static parser fallback)"}`
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function generateGraph(
  pulumiCode: string,
  stackId: string,
  workDir: string
) {
  let events: PreviewEvent[];
  try {
    writeProgram(workDir, pulumiCode);
    events = await runPreview(stackId, workDir);
  } catch {
    events = parseResourcesFromCode(pulumiCode);
  }

  const { nodes, edges } = buildGraphFromEvents(events);

  const enrichedNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      estimatedCost: estimateMonthlyCost(node.data.resourceType),
    },
  }));

  const cost = totalEstimatedCost(enrichedNodes.map((n) => n.data.resourceType));
  return { nodes: enrichedNodes, edges, cost };
}

// ---------------------------------------------------------------------------
// Tool: generate_infrastructure
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "generate_infrastructure",
    description:
      "Generate an interactive cloud infrastructure diagram from a natural language description. Use this when the user wants to design, plan, or visualize cloud infrastructure.",
    schema: z.object({
      description: z
        .string()
        .describe(
          "Natural language description of the infrastructure, e.g. 'A Next.js app with Postgres database and S3 file storage'"
        ),
    }),
    widget: {
      name: "infrastructure-graph",
      invoking: "Generating infrastructure…",
      invoked: "Infrastructure graph ready",
    },
  },
  async ({ description }) => {
    const stackId = randomUUID().replace(/-/g, "").slice(0, 10);
    const workDir = `/tmp/infra-${stackId}`;

    const pulumiCode = await generatePulumiCode(description);
    const { nodes, edges, cost } = await generateGraph(pulumiCode, stackId, workDir);

    setStack({
      stackId,
      pulumiCode,
      workDir,
      nodes,
      edges,
      deployStatus: "idle",
      createdAt: new Date().toISOString(),
    });

    return widget({
      props: {
        nodes,
        edges,
        stackId,
        totalEstimatedCost: cost,
        description,
        subprocessSupported,
      },
      output: text(
        `Generated infrastructure with ${nodes.length} resources. Estimated cost: ~$${cost}/mo. Stack ID: ${stackId}`
      ),
    });
  }
);

// ---------------------------------------------------------------------------
// Tool: update_infrastructure
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "update_infrastructure",
    description:
      "Update an existing infrastructure diagram based on a change description. Use this when the user wants to add, remove, or modify resources in an existing design.",
    schema: z.object({
      change_description: z
        .string()
        .describe(
          "Description of the change to make, e.g. 'Add a Redis cache cluster' or 'Replace RDS with DynamoDB'"
        ),
      stack_id: z
        .string()
        .describe("The stack ID returned by generate_infrastructure"),
    }),
    widget: {
      name: "infrastructure-graph",
      invoking: "Updating infrastructure…",
      invoked: "Infrastructure updated",
    },
  },
  async ({ change_description, stack_id }) => {
    const record = getStack(stack_id);
    if (!record) {
      return text(
        `Error: Stack "${stack_id}" not found. Please call generate_infrastructure first.`
      );
    }

    const newCode = await updatePulumiCode(record.pulumiCode, change_description);
    const { nodes, edges, cost } = await generateGraph(newCode, stack_id, record.workDir);

    setStack({
      ...record,
      pulumiCode: newCode,
      nodes,
      edges,
    });

    return widget({
      props: {
        nodes,
        edges,
        stackId: stack_id,
        totalEstimatedCost: cost,
        description: change_description,
        subprocessSupported,
      },
      output: text(
        `Updated infrastructure: ${nodes.length} resources, ~$${cost}/mo. Stack ID: ${stack_id}`
      ),
    });
  }
);

// ---------------------------------------------------------------------------
// Tool: configure_pulumi
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "configure_pulumi",
    description:
      "Connect a user's Pulumi Cloud account so the Deploy button can provision real infrastructure. " +
      "Before calling this tool, collect three things from the user: " +
      "(1) their Pulumi access token from app.pulumi.com/account/tokens, " +
      "(2) their Pulumi org name (top-left corner after login), " +
      "(3) their Pulumi ESC environment reference in 'project/env-name' format (e.g. 'my-project/aws-credentials') — " +
      "ask them to check app.pulumi.com/environments for the project and environment name, " +
      "or help them create one if they don't have one yet. " +
      "Cloud credentials stay in Pulumi ESC and are never passed through this server.",
    schema: z.object({
      access_token: z
        .string()
        .describe("Pulumi Cloud access token from app.pulumi.com/account/tokens"),
      org: z
        .string()
        .describe("Your Pulumi Cloud organization name (shown top-left after login)"),
      esc_environment: z
        .string()
        .optional()
        .describe(
          "The Pulumi ESC environment reference containing cloud credentials. " +
          "Format: 'env-name' if the environment is in the default project, or 'project/env-name' if it is in a named project. " +
          "Do NOT include the org name prefix — it is derived from the access token automatically. " +
          "Ask the user to check app.pulumi.com/environments to find their environment's project and name. " +
          "Example: if Pulumi shows project='my-project' and env='my-env', pass 'my-project/my-env'. " +
          "If omitted, credentials must be available in the server environment instead."
        ),
    }),
  },
  async ({ access_token, org, esc_environment }) => {
    // Validate the token by hitting the Pulumi Cloud user endpoint
    try {
      const resp = await fetch("https://api.pulumi.com/api/user", {
        headers: { Authorization: `token ${access_token}`, Accept: "application/vnd.pulumi+8" },
      });
      if (!resp.ok) {
        return text(
          `Invalid Pulumi access token (HTTP ${resp.status}). ` +
          `Check your token at app.pulumi.com/account/tokens and try again.`
        );
      }
      const user = (await resp.json()) as { githubLogin?: string; name?: string };
      const display = user.name ?? user.githubLogin ?? org;
      setPulumiSession(access_token, org, esc_environment);

      const escLine = esc_environment
        ? `ESC environment: ${org}/${esc_environment} — credentials will be injected automatically at deploy time.`
        : `No ESC environment set. Credentials will be read from the server environment (.env).\n` +
          `To use ESC instead, call configure_pulumi again with esc_environment set to your environment name.`;

      return text(
        `Pulumi connected ✓ — logged in as ${display} (org: ${org}).\n\n` +
        escLine + `\n\n` +
        `To set up a Pulumi ESC environment with cloud credentials:\n\n` +
        `For AWS:\n` +
        `  1. Go to app.pulumi.com → Environments → Create environment\n` +
        `  2. Add: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION under environmentVariables\n` +
        `  3. Call configure_pulumi again with esc_environment: "aws-credentials"\n\n` +
        `For GCP:\n` +
        `  1. Go to app.pulumi.com → Environments → Create environment\n` +
        `  2. Add: GOOGLE_CREDENTIALS (full service account JSON), GOOGLE_PROJECT, GOOGLE_REGION\n` +
        `  3. Call configure_pulumi again with esc_environment: "gcp-credentials"\n\n` +
        `Once configured, the Deploy button will provision real infrastructure under your account.`
      );
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      return text(`Failed to reach Pulumi Cloud: ${err}`);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: deploy
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "deploy",
    description:
      "Deploy a generated infrastructure stack to AWS or GCP using Pulumi. Called by the infrastructure graph widget's Deploy button.",
    schema: z.object({
      stackId: z.string().describe("The stack ID to deploy"),
    }),
  },
  async ({ stackId }) => {
    const record = getStack(stackId);
    if (!record) {
      return object({
        status: "failed",
        message: `Stack "${stackId}" not found`,
        logs: [],
      });
    }

    const session = getPulumiSession();
    if (!session) {
      return object({
        status: "not_configured",
        message: "Pulumi is not configured.",
        logs: [],
      });
    }

    if (!subprocessSupported) {
      return object({
        status: "failed",
        message:
          "Pulumi CLI is not available on this server. Install it with: curl -fsSL https://get.pulumi.com | sh",
        logs: [
          "[error] Pulumi CLI not found. Run: curl -fsSL https://get.pulumi.com | sh, then restart the server.",
        ],
      });
    }

    const logs: string[] = [];

    // Trim logs for the tool response to stay within token limits.
    // Drop [debug] lines (pure noise) and cap at 80 lines, truncating each to 200 chars.
    const trimLogs = (raw: string[]) =>
      raw
        .filter((l) => !l.startsWith("[debug]"))
        .slice(-80)
        .map((l) => (l.length > 200 ? l.slice(0, 197) + "…" : l));

    try {
      setStack({ ...record, deployStatus: "deploying" });

      await runDeploy(record.workDir, stackId, session.accessToken, session.org, (line) => {
        logs.push(line.trim());
      }, session.escEnvironment);

      setStack({ ...record, deployStatus: "deployed" });

      const created = logs.filter(
        (l) => l.toLowerCase().includes("created") || l.includes("+")
      ).length;

      return object({
        status: "deployed",
        message: `Deployed successfully. ~${created} resources created.`,
        logs: trimLogs(logs),
      });
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      logs.push(`[error] ${err}`);
      setStack({ ...record, deployStatus: "failed" });

      return object({
        status: "failed",
        message: `Deploy failed: ${err}`,
        logs: trimLogs(logs),
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Smoke test (temporary — remove after Manufact Cloud subprocess test)
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "pulumi_smoke_test",
    description:
      "Test whether Pulumi subprocess execution is supported in this environment",
    schema: z.object({}),
  },
  async () => {
    try {
      const { LocalWorkspace } = await import("@pulumi/pulumi/automation");
      const { mkdirSync, writeFileSync } = await import("fs");
      const dir = "/tmp/pulumi-smoke-test-manual";
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/Pulumi.yaml`, "name: smoke\nruntime: nodejs\n");
      await LocalWorkspace.create({ workDir: dir });
      return text("Pulumi subprocess: CONFIRMED");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return text(`Pulumi subprocess FAILED: ${msg}`);
    }
  }
);

// ---------------------------------------------------------------------------

server.listen().then(() => {
  console.log("Infrastructure Visualizer MCP server running");
});
