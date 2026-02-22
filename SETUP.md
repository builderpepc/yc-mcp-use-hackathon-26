# Infrastructure Visualizer — Setup Guide

This MCP server lets users design and deploy cloud infrastructure (AWS or GCP) through natural language. It runs on Manufact Cloud and uses OpenAI to generate Pulumi programs, which are visualized as interactive graphs inside your AI chat.

---

## Required Accounts

| Account | Purpose | Cost |
|---|---|---|
| [Manufact Cloud](https://manufact.com) | Hosts the MCP server | Free tier available |
| [Pulumi Cloud](https://app.pulumi.com) | Stores deployment state; brokers cloud credentials | Free tier available |
| [OpenAI](https://platform.openai.com) | GPT-4o generates the Pulumi TypeScript programs | Pay-per-use |
| AWS or GCP | Where infrastructure is actually deployed | Pay-per-use |

---

## Step 1 — Manufact Cloud Environment Variables

In your Manufact Cloud dashboard, set the following environment variables for your deployed server:

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | **Yes** | OpenAI API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `PULUMI_CONFIG_PASSPHRASE` | **Yes** | Any string (e.g. `my-passphrase`). Encrypts local Pulumi state files. |
| `MCP_URL` | **Yes** | Your Manufact deployment URL (e.g. `https://your-server.manufact.com`) |

**These are the only server-side environment variables needed.** AWS/GCP credentials are never stored on the server — they live in Pulumi Cloud (see Step 3).

---

## Step 2 — Deploy the Server

```bash
npm install
npm run deploy
```

After deploy, confirm subprocess support works by calling the `pulumi_smoke_test` tool in your AI client. You should see `"Pulumi subprocess: CONFIRMED"`. If you see `"FAILED"`, visualization still works but the Deploy button will be disabled.

---

## Step 3 — Pulumi Cloud Setup (per user)

Each user of the MCP server needs a Pulumi Cloud account and a personal access token. This is what allows the server to deploy infrastructure on the user's behalf without ever storing their cloud credentials.

### 3a. Create a Pulumi Cloud account

Sign up at [app.pulumi.com](https://app.pulumi.com) — the free Individual tier is sufficient.

### 3b. Get a Pulumi access token

1. Go to **[app.pulumi.com/account/tokens](https://app.pulumi.com/account/tokens)**
2. Click **Create token**
3. Give it a name (e.g. `infra-visualizer`)
4. Copy the token — it starts with `pul-`

### 3c. Configure the MCP server with your token

Call the `configure_pulumi` tool in your AI client:

```
configure_pulumi(
  accessToken: "pul-xxxxxxxxxxxx",
  org: "your-pulumi-org-name"
)
```

Your org name appears in the URL when you log into Pulumi Cloud: `app.pulumi.com/<org-name>`.

This token is stored in memory for the current session only. You will need to call `configure_pulumi` again in new sessions or after server restarts.

---

## Step 4 — Cloud Provider Credentials (AWS or GCP)

Credentials are stored in **Pulumi ESC** (Environments, Secrets, Configuration) — they never leave Pulumi Cloud. The server uses your Pulumi token to inject credentials at deploy time.

### AWS

#### 4a. Create an IAM user with programmatic access

1. Go to **AWS Console → IAM → Users → Create user**
2. Attach the `AdministratorAccess` policy (or a scoped policy for your use case)
3. Go to **Security credentials → Create access key**
4. Select **"Application running outside AWS"**
5. Copy the **Access Key ID** and **Secret Access Key**

#### 4b. Store credentials in Pulumi ESC

1. Go to **[app.pulumi.com/environments](https://app.pulumi.com/environments)**
2. Create a new environment named `aws-credentials` (or any name)
3. Add the following YAML:

```yaml
values:
  environmentVariables:
    AWS_ACCESS_KEY_ID: "AKIA..."
    AWS_SECRET_ACCESS_KEY:
      fn::secret: "your-secret-key"
    AWS_REGION: "us-east-1"
```

4. Click **Save**
5. Note your environment path: `<org>/aws-credentials`

### GCP

#### 4a. Create a service account

1. Go to **GCP Console → IAM & Admin → Service Accounts → Create**
2. Grant the **Editor** role (or more granular roles)
3. Go to **Keys → Add Key → Create new key → JSON**
4. Download the JSON key file

#### 4b. Store credentials in Pulumi ESC

1. Create a new ESC environment named `gcp-credentials`
2. Add the following YAML (paste the entire JSON key as a secret):

```yaml
values:
  environmentVariables:
    GOOGLE_CREDENTIALS:
      fn::secret: |
        {
          "type": "service_account",
          "project_id": "your-project",
          ...
        }
    GOOGLE_PROJECT: "your-gcp-project-id"
    GOOGLE_REGION: "us-central1"
```

3. Click **Save**

---

## Step 5 — Connect ESC to Your Pulumi Stacks (optional but recommended)

To have credentials automatically injected into every stack deploy, link your ESC environment to a stack default:

1. In Pulumi Cloud, go to your organization's **Environments** page
2. Open your credentials environment
3. Under **Consuming stacks**, add a wildcard or specific stack

Alternatively, the server will pass the ESC environment name directly when running `pulumi up` — no manual linking needed for the current implementation.

---

## User Flow

Once set up, the typical usage inside your AI client:

1. **Generate infrastructure:**
   > "Create a Next.js app with a Postgres database, Redis cache, and S3 bucket"

   The graph appears inline with estimated monthly costs.

2. **Refine the design:**
   > "Add a CloudFront CDN in front of the S3 bucket"

   The graph updates with new nodes.

3. **Ask questions about resources:**
   Click any node in the graph → type a question in the "Ask a question" box (e.g. "What is this for?")

4. **Request changes via the graph:**
   Click any node → type in the "Request a change" box (e.g. "Make this a Multi-AZ RDS cluster")

5. **Deploy:**
   Click the **Deploy** button. The log panel streams deploy output. Nodes turn green when created, red on failure.

---

## Summary of Environment Variables

| Variable | Where | Required | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | Manufact dashboard | Yes | GPT-4o code generation |
| `PULUMI_CONFIG_PASSPHRASE` | Manufact dashboard | Yes | Any string, encrypts local state |
| `MCP_URL` | Manufact dashboard | Yes | Your Manufact deployment URL |
| Pulumi access token | Set via `configure_pulumi` tool | Yes | Per user, per session |
| AWS/GCP credentials | Pulumi ESC | Yes (for deploy) | Never stored on server |
