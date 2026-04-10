// MCP tool definitions and handlers for Vibe Check
// 6 read-mostly tools: get_tree, get_health, get_activity, get_stats, trigger_review, start_scaffold

export function getToolDefinitions() {
  return [
    {
      name: 'get_tree',
      description: 'Get the current file tree structure with health badges for the watched project',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_health',
      description: 'Get health badges and branch status for a specific path or the whole project',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Optional path to check health for. If omitted, returns whole project health.',
          },
        },
      },
    },
    {
      name: 'get_activity',
      description: 'Get recent file change events from the current session',
      inputSchema: {
        type: 'object',
        properties: {
          since: {
            type: 'number',
            description: 'Only return events after this Unix timestamp (milliseconds)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of events to return (default 50)',
          },
        },
      },
    },
    {
      name: 'get_stats',
      description: 'Get session statistics: files created, modified, deleted, hottest branch',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'trigger_review',
      description: 'Trigger a second opinion code review of the current session changes',
      inputSchema: {
        type: 'object',
        properties: {
          provider: {
            type: 'string',
            description: 'Which AI to review with: "claude", "openai", or a local model ID. Defaults to "claude".',
          },
          scope: {
            type: 'string',
            description: 'Review scope: "latest" for all session changes, or a path to review a subtree.',
          },
        },
      },
    },
    {
      name: 'start_scaffold',
      description: 'Generate a scaffold prompt for a new project based on a plain English description',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'What the user wants to build, in plain English',
          },
          provider: {
            type: 'string',
            description: 'Which AI to generate scaffold with. Defaults to "claude".',
          },
        },
        required: ['description'],
      },
    },
  ];
}

export function createToolHandlers(state, options = {}) {
  const { reviewFn, scaffoldFn } = options;

  return {
    async get_tree() {
      const tree = state.getTreeData();
      return { content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }] };
    },

    async get_health(args) {
      const tree = state.getTreeData();

      if (args.path) {
        // Find specific node
        const node = findNode(tree, args.path);
        if (!node) {
          return { content: [{ type: 'text', text: `No node found at path: ${args.path}` }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ path: args.path, badges: node.badges || [], children: (node.children || []).length }) }] };
      }

      const stats = state.getStats();
      return { content: [{ type: 'text', text: JSON.stringify({ stats, snapshot: state.getSnapshot() }) }] };
    },

    async get_activity(args) {
      const events = state.getRecentEvents(args.since, args.limit || 50);
      return { content: [{ type: 'text', text: JSON.stringify(events) }] };
    },

    async get_stats() {
      const stats = state.getStats();
      return { content: [{ type: 'text', text: JSON.stringify(stats) }] };
    },

    async trigger_review(args) {
      if (!reviewFn) {
        return { content: [{ type: 'text', text: 'Review function not configured. Provide an API key via --api-key or environment variable.' }] };
      }
      const result = await reviewFn(args.provider || 'claude', args.scope || 'latest');
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
    },

    async start_scaffold(args) {
      if (!scaffoldFn) {
        return { content: [{ type: 'text', text: 'Scaffold function not configured. Provide an API key via --api-key or environment variable.' }] };
      }
      const result = await scaffoldFn(args.description, args.provider || 'claude');
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
    },
  };
}

function findNode(tree, targetPath) {
  if (!tree) return null;
  if (tree.path === targetPath) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNode(child, targetPath);
      if (found) return found;
    }
  }
  return null;
}
