import { mkdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import type { PreviewEvent } from "./graph-converter.js";

// ---------------------------------------------------------------------------
// Subprocess support check (cached)
// ---------------------------------------------------------------------------

let SUBPROCESS_SUPPORTED: boolean | null = null;

export async function checkSubprocessSupport(): Promise<boolean> {
  if (SUBPROCESS_SUPPORTED !== null) return SUBPROCESS_SUPPORTED;
  try {
    const { LocalWorkspace } = await import("@pulumi/pulumi/automation");
    const testDir = "/tmp/pulumi-smoke-test";
    mkdirSync(testDir, { recursive: true });
    writeFileSync(`${testDir}/Pulumi.yaml`, "name: smoke-test\nruntime: nodejs\n");
    await LocalWorkspace.create({ workDir: testDir });
    SUBPROCESS_SUPPORTED = true;
  } catch {
    SUBPROCESS_SUPPORTED = false;
  }
  return SUBPROCESS_SUPPORTED;
}

// ---------------------------------------------------------------------------
// File-based program writer
// ---------------------------------------------------------------------------

const PULUMI_YAML = (name: string) =>
  `name: ${name}\nruntime: nodejs\ndescription: Generated infrastructure\n`;

const WORKDIR_PACKAGE_JSON = JSON.stringify(
  {
    name: "infra-stack",
    version: "1.0.0",
    dependencies: {
      "@pulumi/pulumi": "^3.0.0",
      "@pulumi/aws": "^6.0.0",
      "@pulumi/gcp": "^8.0.0",
    },
  },
  null,
  2
);

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2020",
      module: "commonjs",
      strict: true,
      outDir: "bin",
      rootDir: ".",
    },
    exclude: ["node_modules"],
  },
  null,
  2
);

export function writeProgram(workDir: string, code: string): void {
  mkdirSync(workDir, { recursive: true });
  writeFileSync(`${workDir}/index.ts`, code, "utf-8");
  writeFileSync(`${workDir}/package.json`, WORKDIR_PACKAGE_JSON, "utf-8");
  writeFileSync(`${workDir}/tsconfig.json`, TSCONFIG, "utf-8");
  writeFileSync(`${workDir}/Pulumi.yaml`, PULUMI_YAML(`infra-stack`), "utf-8");
}

// ---------------------------------------------------------------------------
// Automation API preview (primary path)
// ---------------------------------------------------------------------------

export async function runPreview(
  stackId: string,
  workDir: string
): Promise<PreviewEvent[]> {
  const { LocalWorkspace } = await import("@pulumi/pulumi/automation");

  const stack = await LocalWorkspace.createOrSelectStack(
    {
      stackName: "dev",
      workDir,
    },
    {
      workDir,
      envVars: {
        PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE ?? "hackathon",
        PULUMI_BACKEND_URL: `file:///tmp/pulumi-state-${stackId}`,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "dummy",
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "dummy",
        AWS_REGION: process.env.AWS_REGION ?? "us-east-1",
      },
    }
  );

  execSync("npm install --prefer-offline", { cwd: workDir, stdio: "ignore" });

  const events: PreviewEvent[] = [];
  await stack.preview({
    onEvent: (event: unknown) => {
      const e = event as { resourcePreEvent?: { metadata: PreviewEvent["metadata"] } };
      if (e.resourcePreEvent?.metadata) {
        events.push({ metadata: e.resourcePreEvent.metadata });
      }
    },
  });

  return events;
}

// ---------------------------------------------------------------------------
// Automation API deploy (primary path)
// ---------------------------------------------------------------------------

export async function runDeploy(
  workDir: string,
  stackId: string,
  pulumiToken: string,
  pulumiOrg: string,
  onLog: (line: string) => void,
  escEnvironment?: string
): Promise<void> {
  const { LocalWorkspace } = await import("@pulumi/pulumi/automation");

  // Use Pulumi Cloud as the state backend.
  // AWS credentials are NOT passed here — they must be configured in the
  // user's Pulumi Cloud account via ESC (Environments, Secrets, and Configuration).
  // Pulumi Cloud will inject them automatically when the deployment runs.
  const projectName = `infra-${stackId}`;
  const stack = await LocalWorkspace.createOrSelectStack(
    { stackName: "dev", workDir },
    {
      workDir,
      projectSettings: {
        name: projectName,
        runtime: "nodejs",
        backend: { url: "https://api.pulumi.com" },
      },
      envVars: {
        PULUMI_ACCESS_TOKEN: pulumiToken,
        PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE ?? "hackathon",
        // AWS credentials (pass through from server env if present)
        ...(process.env.AWS_ACCESS_KEY_ID && {
          AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        }),
        ...(process.env.AWS_SECRET_ACCESS_KEY && {
          AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        }),
        ...(process.env.AWS_REGION && { AWS_REGION: process.env.AWS_REGION }),
        // GCP credentials (pass through from server env if present)
        ...(process.env.GOOGLE_CREDENTIALS && {
          GOOGLE_CREDENTIALS: process.env.GOOGLE_CREDENTIALS,
        }),
        ...(process.env.GOOGLE_PROJECT && {
          GOOGLE_PROJECT: process.env.GOOGLE_PROJECT,
        }),
        ...(process.env.GOOGLE_REGION && {
          GOOGLE_REGION: process.env.GOOGLE_REGION,
        }),
      },
    }
  );

  // Attach ESC environment so Pulumi Cloud injects cloud credentials at deploy time.
  // addEnvironments() takes only the bare environment name — the org is derived
  // from the PULUMI_ACCESS_TOKEN. Strip any org/path prefix the user may have included.
  if (escEnvironment) {
    const envName = escEnvironment.split("/").pop()!;
    onLog(`[info] Attaching ESC environment: ${envName}`);
    await stack.addEnvironments(envName);
  }

  onLog("[info] Installing dependencies...");
  execSync("npm install --prefer-offline", { cwd: workDir, stdio: "ignore" });

  await stack.up({
    onOutput: (line: string) => onLog(line),
    onEvent: (event: unknown) => {
      const e = event as { diagnosticEvent?: { message?: string; severity?: string } };
      if (e.diagnosticEvent?.message) {
        onLog(`[${e.diagnosticEvent.severity ?? "info"}] ${e.diagnosticEvent.message}`);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Static parser fallback (no subprocess)
// ---------------------------------------------------------------------------

export function parseResourcesFromCode(code: string): PreviewEvent[] {
  // Match variable-assigned resource declarations:
  //   const varName = new aws.module.Resource("resourceName", ...)
  // Capture: varName, provider, module, type, resourceName, and match start index.
  const declPattern =
    /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(aws|gcp|azure)\.(\w+)\.(\w+)\s*\(\s*["'`]([^"'`]+)["'`]/g;

  interface Decl {
    varName: string;
    resourceType: string;
    urn: string;
    start: number;
  }

  const decls: Decl[] = [];
  const seenUrns = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = declPattern.exec(code)) !== null) {
    const [, varName, provider, mod, type, name] = m;
    if (!varName || !provider || !mod || !type || !name) continue;

    const resourceType = `${provider}:${mod.toLowerCase()}/${type.toLowerCase()}:${type}`;
    const urn = `urn:pulumi:dev::infra::${resourceType}::${name}`;

    if (!seenUrns.has(urn)) {
      seenUrns.add(urn);
      decls.push({ varName, resourceType, urn, start: m.index });
    }
  }

  // Build base events (no edges yet)
  const events: PreviewEvent[] = decls.map((d) => ({
    metadata: { urn: d.urn, type: d.resourceType, op: "create" },
  }));

  // Infer dependencies by scanning each resource's code region for references
  // to other resource variables (e.g. `vpc.id`, `subnet.id`, `dependsOn: [db]`)
  decls.forEach((decl, i) => {
    // The "body" of this resource spans from its declaration to the next one
    const bodyEnd = i + 1 < decls.length ? decls[i + 1].start : code.length;
    const body = code.slice(decl.start, bodyEnd);

    const deps: string[] = [];

    decls.forEach((other, j) => {
      // Only consider resources declared before this one (they can be referenced)
      if (j >= i) return;

      // Match property access (vpc.id, subnet.arn) or array element (dependsOn: [vpc])
      const propAccess = new RegExp(`\\b${other.varName}\\s*\\.`, "g");
      const arrayRef = new RegExp(`\\b${other.varName}\\b`, "g");

      if (propAccess.test(body) || arrayRef.test(body)) {
        deps.push(other.urn);
      }
    });

    if (deps.length > 0) {
      events[i].metadata.dependencies = deps;
    }
  });

  return events;
}
