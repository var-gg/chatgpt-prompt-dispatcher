export function createMcpSubmitToolDefinition() {
  return {
    name: 'submit_chatgpt_prompt',
    description: 'Submit a prepared prompt into a local logged-in ChatGPT web session and return only the submission receipt.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        promptFile: { type: 'string' },
        mode: { type: 'string', enum: ['auto', 'latest', 'instant', 'thinking', 'pro'] },
        project: { type: 'string' },
        newChat: { type: 'boolean' },
        attachments: { type: 'array', items: { type: 'string' } },
        profile: { type: 'string' },
        dryRun: { type: 'boolean' },
        screenshotPath: { type: 'string' },
        browserProfileDir: { type: 'string' }
      },
      additionalProperties: false
    }
  };
}

export async function invokeMcpSubmit(_options = {}) {
  throw new Error('MCP skeleton only: wire this to the core CLI without adding response scraping or hidden API behavior.');
}
