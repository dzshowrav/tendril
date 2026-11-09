#!/usr/bin/env tsx
import {
  getTendrilPaths,
  loadAuth,
  getEffectiveApiKey,
  PROVIDER_PRESETS,
  createProviderAdapter,
  ToolSpec,
  Message,
} from '../packages/core/src/index.js';

async function main() {
  const providerId = process.argv[2];
  const userPrompt = process.argv[3] || 'say hi';

  if (!providerId) {
    console.log('Usage: tsx scripts/try-provider.ts <provider> [prompt]');
    console.log('Available preset providers:', Object.keys(PROVIDER_PRESETS).join(', '));
    process.exit(1);
  }

  const preset = PROVIDER_PRESETS[providerId];
  if (!preset) {
    console.error(`Unknown provider: ${providerId}`);
    console.error('Available preset providers:', Object.keys(PROVIDER_PRESETS).join(', '));
    process.exit(1);
  }

  const paths = getTendrilPaths();
  const auth = loadAuth(paths.authPath);
  const apiKey = getEffectiveApiKey(providerId, auth);

  if (preset.apiKeyRequired && !apiKey) {
    console.error(`Error: Missing API key for provider "${providerId}".`);
    console.error(
      `Please set TENDRIL_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY or save it in ${paths.authPath}.`,
    );
    process.exit(1);
  }

  const adapter = createProviderAdapter(preset.type, {
    apiKey: apiKey || '',
    baseUrl: preset.baseUrl,
  });

  console.log(`\n=== Round 1: Streaming prompt "${userPrompt}" to ${preset.name} (${preset.defaultModel}) ===\n`);

  const round1Messages: Message[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: userPrompt }],
    },
  ];

  for await (const event of adapter.stream({
    model: preset.defaultModel,
    system: 'You are a helpful coding assistant.',
    messages: round1Messages,
    maxOutputTokens: 256,
  })) {
    if (event.type === 'text_delta') {
      process.stdout.write(event.text);
    } else if (event.type === 'usage') {
      console.log(`\n\n[Usage: ${event.inputTokens} input, ${event.outputTokens} output]`);
    } else if (event.type === 'stop') {
      console.log(`[Stop reason: ${event.reason}]`);
    } else if (event.type === 'error') {
      console.error(`\n[Stream error: ${event.error.message}]`);
    }
  }

  console.log(`\n=== Round 2: Forced Tool-Call Round Trip ===\n`);

  const tools: ToolSpec[] = [
    {
      name: 'get_current_time',
      description: 'Get the current time in a given timezone',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'Timezone identifier (e.g. UTC, Asia/Dhaka)' },
        },
        required: ['timezone'],
      },
    },
  ];

  const round2Messages: Message[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'What is the current time in Tokyo? You MUST call the get_current_time tool with timezone "Asia/Tokyo".',
        },
      ],
    },
  ];

  let toolCalled = false;

  for await (const event of adapter.stream({
    model: preset.defaultModel,
    system: 'You are a helpful assistant with access to tools.',
    messages: round2Messages,
    tools,
    maxOutputTokens: 256,
  })) {
    if (event.type === 'text_delta') {
      process.stdout.write(event.text);
    } else if (event.type === 'tool_use_start') {
      console.log(`\n-> Tool Use Start: ${event.name} (id: ${event.id})`);
    } else if (event.type === 'tool_use_input_delta') {
      process.stdout.write(event.delta);
    } else if (event.type === 'tool_use_end') {
      toolCalled = true;
      console.log(`\n-> Tool Use End: ${event.name}`);
      console.log(`   Parsed input:`, JSON.stringify(event.input, null, 2));
    } else if (event.type === 'usage') {
      console.log(`[Usage: ${event.inputTokens} input, ${event.outputTokens} output]`);
    } else if (event.type === 'stop') {
      console.log(`[Stop reason: ${event.reason}]`);
    } else if (event.type === 'error') {
      console.error(`[Error: ${event.error.message}]`);
    }
  }

  if (toolCalled) {
    console.log('\nSUCCESS: Forced tool call round trip completed and parsed properly!\n');
  } else {
    console.log('\nNOTE: Model did not invoke the tool in this run.\n');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
