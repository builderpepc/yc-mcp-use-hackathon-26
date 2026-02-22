import {
  ReactFlow,
  Background,
  Controls,
  type NodeTypes,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { McpUseProvider, useCallTool, useWidget, type WidgetMetadata } from "mcp-use/react";
import React, { useEffect, useRef, useState } from "react";
import "../styles.css";
import { LogPanel } from "./components/LogPanel";
import { ResourceNode, type ResourceNodeData } from "./components/ResourceNode";
import { propSchema, stateSchema } from "./types";
import type { InfraGraphProps, InfraGraphState } from "./types";

export const widgetMetadata: WidgetMetadata = {
  description:
    "Interactive cloud infrastructure visualization with deploy support",
  props: propSchema,
  exposeAsTool: false,
  metadata: {
    prefersBorder: false,
    invoking: "Generating infrastructure graph…",
    invoked: "Infrastructure graph ready",
    csp: {
      resourceDomains: [],
    },
  },
};

const nodeTypes: NodeTypes = {
  resourceNode: ResourceNode as React.ComponentType<any>,
};

const InfrastructureGraph: React.FC = () => {
  const { props, isPending, state, setState, sendFollowUpMessage } =
    useWidget<InfraGraphProps, InfraGraphState>();

  const {
    callTool: deployStack,
    data: deployData,
    isPending: isDeploying,
  } = useCallTool("deploy");

  const prevIsDeploying = useRef(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [askInput, setAskInput] = useState("");
  const [editInput, setEditInput] = useState("");

  useEffect(() => {
    if (prevIsDeploying.current && !isDeploying && deployData) {
      const result = deployData.structuredContent as
        | { status: string; message?: string; logs: string[] }
        | undefined;
      if (result) {
        if (result.status === "not_configured") {
          // Reset widget to idle and ask the AI to walk the user through Pulumi setup
          setState({ deployStatus: "idle", logs: [] });
          sendFollowUpMessage(
            "The user clicked the Deploy button but Pulumi isn't configured yet. " +
            "Please help them set up Pulumi so they can deploy:\n" +
            "1. Ask them to get a free Pulumi Cloud account at app.pulumi.com if they don't have one\n" +
            "2. Ask them to create an access token at app.pulumi.com/account/tokens\n" +
            "3. Ask for their Pulumi org name (shown top-left after login)\n" +
            "4. Call configure_pulumi with their access token and org name\n" +
            "5. Then guide them on adding their AWS or GCP credentials to a Pulumi ESC environment\n" +
            "Be friendly and guide them step by step."
          );
        } else {
          setState({
            deployStatus: result.status as InfraGraphState["deployStatus"],
            logs: result.logs ?? [],
          });
        }
      }
    }
    prevIsDeploying.current = isDeploying;
  }, [isDeploying, deployData]);

  const handleDeploy = () => {
    if (!props?.stackId) return;
    setState({ deployStatus: "deploying", logs: [] });
    deployStack({ stackId: props.stackId });
  };

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setAskInput("");
    setEditInput("");
  };

  const handlePaneClick = () => setSelectedNodeId(null);

  if (isPending || !props) {
    return (
      <McpUseProvider>
        <div className="bg-surface-elevated border border-default rounded-3xl p-8">
          <div className="h-4 w-56 bg-default/10 rounded animate-pulse mb-3" />
          <div className="h-3 w-40 bg-default/10 rounded animate-pulse mb-6" />
          <div className="h-64 bg-default/5 rounded-2xl animate-pulse" />
        </div>
      </McpUseProvider>
    );
  }

  const { nodes, edges, stackId, totalEstimatedCost, description } = props;
  const deployStatus = isDeploying ? "deploying" : (state?.deployStatus ?? "idle");
  const logs = state?.logs ?? [];

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : null;
  const selectedData = selectedNode?.data as ResourceNodeData | undefined;

  const costPct =
    selectedData?.estimatedCost != null && totalEstimatedCost > 0
      ? Math.round((selectedData.estimatedCost / totalEstimatedCost) * 100)
      : null;

  const canDeploy =
    deployStatus !== "deploying" &&
    deployStatus !== "deployed";

  const deployButtonLabel =
    deployStatus === "deploying"
      ? "Deploying…"
      : deployStatus === "deployed"
      ? "Deployed ✓"
      : "Deploy";

  return (
    <McpUseProvider>
      <div className="bg-surface-elevated border border-default rounded-3xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 flex items-start justify-between border-b border-subtle">
          <div className="flex-1 min-w-0 mr-4">
            <h2 className="text-base font-semibold text-default truncate">
              Infrastructure Graph
            </h2>
            <p className="text-sm text-secondary mt-0.5 line-clamp-2">{description}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-secondary">
                <span className="font-medium text-default">{nodes.length}</span> resources
              </span>
              <span className="text-xs text-secondary">
                ~
                <span className="font-medium text-default">
                  ${totalEstimatedCost}
                </span>
                /mo est.
              </span>
              <span className="text-xs text-tertiary font-mono truncate max-w-24">
                {stackId}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDeploy}
              disabled={!canDeploy}
              className={`
                px-4 py-2 rounded-xl text-sm font-medium transition-all
                ${
                  deployStatus === "deployed"
                    ? "bg-green-100 text-green-700 cursor-default"
                    : canDeploy
                    ? "bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }
              `}
            >
              {deployButtonLabel}
            </button>
          </div>
        </div>

        {/* React Flow Graph */}
        <div style={{ height: 480 }}>
          {nodes.length === 0 ? (
            <div className="flex items-center justify-center h-full text-secondary text-sm">
              No resources found. Try describing your infrastructure again.
            </div>
          ) : (
            <ReactFlow
              nodes={nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId }))}
              edges={edges.map((e) => ({
                ...e,
                style: { stroke: "#94a3b8", strokeWidth: 1.5 },
                markerEnd: { type: "arrowclosed" as const, color: "#94a3b8" },
              }))}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.3}
              maxZoom={2}
              nodesDraggable={true}
              nodesConnectable={false}
              selectNodesOnDrag={false}
              proOptions={{ hideAttribution: true }}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
            >
              <Background color="#e2e8f0" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>

        {/* Node Detail Panel */}
        {selectedData && (
          <div className="border-t border-gray-200 bg-white px-5 py-4">
            {/* Header row: resource name + type badge + close */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-900 truncate">
                    {selectedData.label}
                  </span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
                    {selectedData.shortType}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  {selectedData.estimatedCost != null ? (
                    selectedData.estimatedCost === 0 ? (
                      <span className="text-green-600 font-medium">Free</span>
                    ) : (
                      <>
                        <span>
                          <span className="font-medium text-gray-700">
                            ${selectedData.estimatedCost}
                          </span>
                          /mo
                        </span>
                        {costPct !== null && (
                          <span className="text-gray-400">{costPct}% of total</span>
                        )}
                      </>
                    )
                  ) : (
                    <span className="text-gray-400">Cost unknown</span>
                  )}
                  <span className="text-gray-400 capitalize">{selectedData.provider}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1 shrink-0"
                aria-label="Close"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Ask a question */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Ask a question
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={askInput}
                    onChange={(e) => setAskInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && askInput.trim()) {
                        sendFollowUpMessage(
                          `Regarding the "${selectedData.label}" ${selectedData.shortType} in my infrastructure: ${askInput.trim()}`
                        );
                        setAskInput("");
                        setSelectedNodeId(null);
                      }
                    }}
                    placeholder="e.g. What ports should I open?"
                    className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <button
                    disabled={!askInput.trim()}
                    onClick={() => {
                      if (!askInput.trim()) return;
                      sendFollowUpMessage(
                        `Regarding the "${selectedData.label}" ${selectedData.shortType} in my infrastructure: ${askInput.trim()}`
                      );
                      setAskInput("");
                      setSelectedNodeId(null);
                    }}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium shrink-0"
                  >
                    Ask
                  </button>
                </div>
              </div>

              {/* Request a change */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Request a change
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={editInput}
                    onChange={(e) => setEditInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && editInput.trim()) {
                        sendFollowUpMessage(
                          `Update my infrastructure (stack ID: ${stackId}): for the "${selectedData.label}" ${selectedData.shortType}, ${editInput.trim()}`
                        );
                        setEditInput("");
                        setSelectedNodeId(null);
                      }
                    }}
                    placeholder="e.g. Use a t3.medium instance"
                    className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  />
                  <button
                    disabled={!editInput.trim()}
                    onClick={() => {
                      if (!editInput.trim()) return;
                      sendFollowUpMessage(
                        `Update my infrastructure (stack ID: ${stackId}): for the "${selectedData.label}" ${selectedData.shortType}, ${editInput.trim()}`
                      );
                      setEditInput("");
                      setSelectedNodeId(null);
                    }}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium shrink-0"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Log Panel */}
        <LogPanel logs={logs} deployStatus={deployStatus} />
      </div>
    </McpUseProvider>
  );
};

export default InfrastructureGraph;
