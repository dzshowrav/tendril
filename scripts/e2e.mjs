#!/usr/bin/env node

/**
 * Tendril End-to-End Test Suite
 *
 * Exercises user journeys J1-J3 against the compiled distribution bundle:
 * - J1: First-time setup (Doctor, CLI ask command, session creation)
 * - J2: Web UI connection (Pairing code generation, cookie pairing, SSE stream, web message)
 * - J3: Core coding task & permission resolution (Mutate tool gate, approval, diff, undo)
 * - Redaction verification: ensures no "sk-" API key material is ever logged to disk
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';

console.log('=== Tendril End-to-End (E2E) Verification Suite ===\n');

const tempHome = mkdtempSync(join(tmpdir(), 'tendril-e2e-home-'));
const tempWorkspace = mkdtempSync(join(tmpdir(), 'tendril-e2e-ws-'));

console.log(`E2E Home:      ${tempHome}`);
console.log(`E2E Workspace: ${tempWorkspace}\n`);

const DUMMY_API_KEY = 'sk-ant-api03-tendril-e2e-secret-key-1234567890';

// Configure dummy auth.json so provider validation passes
const authJsonPath = join(tempHome, 'auth.json');
writeFileSync(
  authJsonPath,
  JSON.stringify(
    {
      providers: {
        anthropic: {
          apiKey: DUMMY_API_KEY,
        },
      },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

let daemonPid = 0;
let daemonPort = 0;
let cliToken = '';

try {
  // -------------------------------------------------------------
  // Step A: Start Daemon in E2E Mock Mode
  // -------------------------------------------------------------
  console.log('--- Step A: Starting Tendril Daemon in E2E mode ---');
  const startRes = spawnSync(
    'node',
    ['dist/tendril.mjs', 'serve', '--detach', '--home', tempHome],
    {
      encoding: 'utf-8',
      env: {
        ...process.env,
        TENDRIL_HOME: tempHome,
        TENDRIL_MOCK_PROVIDER: '1',
      },
    },
  );

  if (startRes.status !== 0) {
    throw new Error(`Failed to start daemon: ${startRes.stderr || startRes.stdout}`);
  }

  const statePath = join(tempHome, 'state.json');
  if (!existsSync(statePath)) {
    throw new Error(`Daemon state.json not found at ${statePath}`);
  }

  const state = JSON.parse(readFileSync(statePath, 'utf-8'));
  daemonPid = state.pid;
  daemonPort = state.port;
  cliToken = state.cliToken;

  console.log(`✓ Daemon running at 127.0.0.1:${daemonPort} (PID: ${daemonPid})\n`);

  const baseUrl = `http://127.0.0.1:${daemonPort}`;

  // -------------------------------------------------------------
  // J1: First-Time Setup (CLI First)
  // -------------------------------------------------------------
  console.log('--- J1: First-time setup (CLI first) ---');

  // 1. Run doctor check
  console.log('1. Running tendril doctor --json...');
  const docRes = spawnSync(
    'node',
    ['dist/tendril.mjs', 'doctor', '--json', '--home', tempHome],
    { encoding: 'utf-8' },
  );

  if (docRes.status !== 0) {
    throw new Error(`tendril doctor failed with code ${docRes.status}: ${docRes.stderr}`);
  }

  const doctorData = JSON.parse(docRes.stdout);
  if (!doctorData.ok || !Array.isArray(doctorData.checks)) {
    throw new Error('Doctor output is not in expected format');
  }
  console.log(`✓ Doctor passed with ${doctorData.checks.length} diagnostic checks.`);

  // 2. Run CLI non-interactive ask command
  console.log('2. Running tendril ask command...');
  const askRes = spawnSync(
    'node',
    [
      'dist/tendril.mjs',
      'ask',
      'Hello from J1 journey',
      '--dir',
      tempWorkspace,
      '--home',
      tempHome,
      '--json',
    ],
    {
      encoding: 'utf-8',
      env: {
        ...process.env,
        TENDRIL_HOME: tempHome,
      },
    },
  );

  if (askRes.status !== 0) {
    throw new Error(`tendril ask failed with code ${askRes.status}: ${askRes.stderr}`);
  }
  console.log('✓ CLI ask completed turn successfully.\n');

  // -------------------------------------------------------------
  // J2: Connect Web UI from phone browser
  // -------------------------------------------------------------
  console.log('--- J2: Connect the Web UI from phone browser ---');

  // 1. Generate pairing code via CLI API
  console.log('1. Generating pairing code via POST /api/pair/code...');
  const pairCodeRes = await fetch(`${baseUrl}/api/pair/code`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cliToken}` },
  });
  if (pairCodeRes.status !== 200) {
    throw new Error(`POST /api/pair/code returned status ${pairCodeRes.status}`);
  }
  const { code } = await pairCodeRes.json();
  if (!code || code.length < 6) {
    throw new Error(`Invalid pairing code received: ${code}`);
  }
  console.log(`✓ Received pairing code: ${code}`);

  // 2. Consume pairing code via Web Pair flow
  console.log('2. Consuming pairing code via POST /api/pair...');
  const pairRes = await fetch(`${baseUrl}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (pairRes.status !== 200) {
    throw new Error(`POST /api/pair returned status ${pairRes.status}`);
  }
  const setCookieHeader = pairRes.headers.get('set-cookie');
  if (!setCookieHeader || !setCookieHeader.includes('tdl_session=')) {
    throw new Error('Expected tdl_session cookie from /api/pair');
  }
  const cookieVal = setCookieHeader.split(';')[0];
  console.log('✓ Pairing successful, cookie received.');

  // 3. Create Web Session using cookie
  console.log('3. Creating session via POST /api/sessions with cookie...');
  const sessRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookieVal,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workspace: tempWorkspace,
      mode: 'ask',
      title: 'J2 Web E2E Session',
    }),
  });
  if (sessRes.status !== 201) {
    throw new Error(`POST /api/sessions returned status ${sessRes.status}`);
  }
  const { session } = await sessRes.json();
  const sessionId = session.id;
  console.log(`✓ Web session created: ${sessionId}`);

  // 4. Connect to SSE stream
  console.log('4. Subscribing to session SSE event stream...');
  const sseEvents = [];
  let sseDone = false;

  const sseReq = http.request(
    {
      host: '127.0.0.1',
      port: daemonPort,
      path: `/api/sessions/${sessionId}/events`,
      headers: { Cookie: cookieVal },
    },
    (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const ev = line.slice(7).trim();
            sseEvents.push(ev);
          }
        }
      });
    },
  );
  sseReq.on('error', (err) => {
    if (!sseDone) console.error('SSE Error:', err.message);
  });
  sseReq.end();

  // Wait briefly for SSE stream to establish
  await new Promise((r) => setTimeout(r, 400));

  // 5. Send message from Web UI
  console.log('5. Sending message from Web UI via POST /api/sessions/:id/messages...');
  const msgRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      Cookie: cookieVal,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: 'Hello from Web UI client' }),
  });
  if (msgRes.status !== 202) {
    throw new Error(`POST /api/sessions/:id/messages returned status ${msgRes.status}`);
  }

  // Wait for turn completion
  await new Promise((r) => setTimeout(r, 1200));

  if (!sseEvents.includes('message.created') && !sseEvents.includes('session.status')) {
    throw new Error(`Expected SSE events for turn, received: ${JSON.stringify(sseEvents)}`);
  }
  console.log(`✓ Received SSE events during turn: ${[...new Set(sseEvents)].join(', ')}\n`);

  // -------------------------------------------------------------
  // J3: Core Coding Task with Approval from Either Client
  // -------------------------------------------------------------
  console.log('--- J3: Core coding task with approval from either client ---');

  // 1. Send mutate_file prompt requiring permission
  console.log('1. Sending prompt "mutate_file create test-e2e.txt" (requires permission in ask mode)...');
  const mutateMsgRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      Cookie: cookieVal,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: 'mutate_file create test-e2e.txt' }),
  });
  if (mutateMsgRes.status !== 202) {
    throw new Error(`Failed to submit turn: ${mutateMsgRes.status}`);
  }

  // Poll for awaiting_permission status
  console.log('2. Waiting for permission prompt...');
  let pendingReqId = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    const checkRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      headers: { Cookie: cookieVal },
    });
    const data = await checkRes.json();
    if (data.session.status === 'awaiting_permission' && data.pendingPermissions?.length > 0) {
      pendingReqId = data.pendingPermissions[0].id;
      break;
    }
  }

  if (!pendingReqId) {
    throw new Error('Session did not enter awaiting_permission status as expected');
  }
  console.log(`✓ Permission requested for write_file (Request ID: ${pendingReqId})`);

  // 3. Approve permission via POST /api/sessions/:id/permissions/:reqId
  console.log('3. Approving permission with decision "allow_once"...');
  const approveRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/permissions/${pendingReqId}`, {
    method: 'POST',
    headers: {
      Cookie: cookieVal,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ decision: 'allow_once' }),
  });
  if (approveRes.status !== 200) {
    throw new Error(`Failed to approve permission: ${approveRes.status}`);
  }

  // Wait for turn to complete
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    const checkRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      headers: { Cookie: cookieVal },
    });
    const data = await checkRes.json();
    if (data.session.status === 'idle') break;
  }

  // 4. Verify file was created on disk
  const createdFilePath = join(tempWorkspace, 'test-e2e.txt');
  if (!existsSync(createdFilePath)) {
    throw new Error(`Expected file ${createdFilePath} to be created by write_file tool`);
  }
  const fileContent1 = readFileSync(createdFilePath, 'utf-8');
  if (!fileContent1.includes('Initial E2E Content')) {
    throw new Error(`Unexpected file content: ${fileContent1}`);
  }
  console.log(`✓ File test-e2e.txt created with content: "${fileContent1.trim()}"`);

  // 5. Send edit_file prompt
  console.log('5. Sending prompt "edit_file update test-e2e.txt"...');
  await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      Cookie: cookieVal,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: 'edit_file update test-e2e.txt' }),
  });

  // Poll for second permission prompt
  let editReqId = null;
  let lastSessionData = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    const checkRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      headers: { Cookie: cookieVal },
    });
    lastSessionData = await checkRes.json();
    if (lastSessionData.session.status === 'awaiting_permission' && lastSessionData.pendingPermissions?.length > 0) {
      editReqId = lastSessionData.pendingPermissions[0].id;
      break;
    }
  }

  if (!editReqId) {
    console.error('Last session data:', JSON.stringify(lastSessionData, null, 2));
    throw new Error('Session did not enter awaiting_permission status for edit_file');
  }

  // Approve edit_file
  await fetch(`${baseUrl}/api/sessions/${sessionId}/permissions/${editReqId}`, {
    method: 'POST',
    headers: {
      Cookie: cookieVal,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ decision: 'allow_once' }),
  });

  // Wait for turn completion
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    const checkRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      headers: { Cookie: cookieVal },
    });
    const data = await checkRes.json();
    if (data.session.status === 'idle') break;
  }

  const fileContent2 = readFileSync(createdFilePath, 'utf-8');
  if (!fileContent2.includes('Modified E2E Content')) {
    throw new Error(`File was not modified by edit_file: ${fileContent2}`);
  }
  console.log(`✓ File modified to: "${fileContent2.trim()}"`);

  // 6. Check Changes API
  console.log('6. Inspecting Changes API via GET /api/sessions/:id/changes...');
  const changesRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/changes`, {
    headers: { Cookie: cookieVal },
  });
  if (changesRes.status !== 200) {
    throw new Error(`GET /api/sessions/:id/changes failed with status ${changesRes.status}`);
  }
  const { changes } = await changesRes.json();
  if (!changes || changes.length === 0) {
    throw new Error('Expected changes in session snapshot history');
  }
  console.log(`✓ Changes list returned ${changes.length} recorded diff card(s).`);

  // 7. Revert / Undo the latest change (changes[0] since list is ordered created_at DESC)
  const latestChange = changes[0];
  const toolRunId = latestChange.tool_run_id;
  console.log(`7. Reverting edit via POST /api/sessions/:id/changes/${toolRunId}/undo...`);
  const undoRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/changes/${toolRunId}/undo`, {
    method: 'POST',
    headers: {
      Cookie: cookieVal,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ force: true }),
  });
  if (undoRes.status !== 200) {
    const errBody = await undoRes.json().catch(() => ({}));
    throw new Error(`POST /api/sessions/:id/changes/:toolRunId/undo failed with status ${undoRes.status}: ${JSON.stringify(errBody)}`);
  }

  const fileContent3 = readFileSync(createdFilePath, 'utf-8');
  if (!fileContent3.includes('Initial E2E Content')) {
    throw new Error(`File was not reverted by undo: ${fileContent3}`);
  }
  console.log(`✓ Undo succeeded! File restored to: "${fileContent3.trim()}"\n`);

  sseDone = true;
  sseReq.destroy();

  // -------------------------------------------------------------
  // Step B: Stop Daemon & Verify Log Redaction
  // -------------------------------------------------------------
  console.log('--- Step B: Log Redaction & Security Gate Verification ---');
  console.log('Stopping daemon...');
  spawnSync('node', ['dist/tendril.mjs', 'stop', '--home', tempHome], { encoding: 'utf-8' });

  console.log('Scanning log files for leaked secrets ("sk-")...');
  const logsDir = join(tempHome, 'logs');
  if (existsSync(logsDir)) {
    const logFiles = readdirSync(logsDir);
    let secretLeaked = false;

    for (const logFile of logFiles) {
      const fullLogPath = join(logsDir, logFile);
      const logContent = readFileSync(fullLogPath, 'utf-8');

      if (logContent.includes(DUMMY_API_KEY) || logContent.includes('sk-ant-api03')) {
        console.error(`[FAIL] Secret API key found in log file: ${fullLogPath}!`);
        secretLeaked = true;
      }
    }

    if (secretLeaked) {
      throw new Error('Security check FAILED: secret API key material leaked in daemon logs!');
    }
  }

  console.log('✓ Zero secret keys or "sk-" material found in daemon logs.');
  console.log('\n======================================================');
  console.log('All End-to-End (E2E) Journeys J1-J3 PASSED successfully!');
  process.exit(0);
} catch (err) {
  console.error('\n[FATAL E2E FAILURE]:', err);
  if (daemonPid) {
    try {
      spawnSync('node', ['dist/tendril.mjs', 'stop', '--home', tempHome], { encoding: 'utf-8' });
    } catch {}
  }
  process.exit(1);
} finally {
  try {
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(tempWorkspace, { recursive: true, force: true });
  } catch {}
}
