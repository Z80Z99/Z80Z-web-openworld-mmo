import { Client } from "colyseus.js";

const clientCount = Number(process.env.LOAD_CLIENTS ?? "500");
const durationMs = Number(process.env.LOAD_DURATION_MS ?? "10000");
const joinTimeoutMs = Number(process.env.LOAD_JOIN_TIMEOUT_MS ?? "15000");
const runTimeoutMs = Number(process.env.LOAD_RUN_TIMEOUT_MS ?? "120000");
const joinBatchSize = Number(process.env.LOAD_JOIN_BATCH_SIZE ?? "25");
const joinBatchDelayMs = Number(process.env.LOAD_JOIN_BATCH_DELAY_MS ?? "100");
const serverUrl = process.env.LOAD_SERVER_URL ?? "ws://127.0.0.1:2567";
const roomName = process.env.LOAD_ROOM_NAME ?? "GameRoom";
const probeCount = Math.min(5, clientCount);

const startedAt = performance.now();
const clients = [];
const joinLatencies = [];
const messageLatencies = [];
const tickLatencies = [];
const pendingMovement = new Map();
let joinFailures = 0;
const joinErrors = new Map();
let messageCount = 0;
let stateChangeCount = 0;
let probeCountSent = 0;
let timedOut = false;

const runTimer = setTimeout(() => {
  timedOut = true;
  printResult();
  process.exit(3);
}, runTimeoutMs);

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((percentileValue / 100) * sorted.length));
  return sorted[index];
}

function timeout(promise, timeoutValue, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutValue}ms`)), timeoutValue);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function joinOne(index) {
  const client = new Client(serverUrl);
  const joinStartedAt = performance.now();
  try {
    const room = await timeout(client.joinOrCreate(roomName), joinTimeoutMs, `client ${index} join`);
    joinLatencies.push(performance.now() - joinStartedAt);
    room.state.players.onAdd((player, sessionId) => {
      stateChangeCount += 1;
      player.onChange(() => {
        stateChangeCount += 1;
        if (sessionId === room.sessionId) {
          const sentAt = pendingMovement.get(sessionId);
          if (sentAt !== undefined) {
            tickLatencies.push(performance.now() - sentAt);
            pendingMovement.delete(sessionId);
          }
        }
      });
    });
    room.onMessage("auth_success", () => {
      messageCount += 1;
    });
    room.onMessage("chat", (message) => {
      messageCount += 1;
      if (typeof message?.content === "string" && message.content.startsWith("load-probe-")) {
        const sentAt = Number(message.content.slice("load-probe-".length));
        if (Number.isFinite(sentAt)) messageLatencies.push(performance.now() - sentAt);
      }
    });
    room.onMessage("*", () => {
      messageCount += 1;
    });
    clients.push(room);
    return room;
  } catch (error) {
    joinFailures += 1;
    const message = error instanceof Error ? error.message : String(error);
    joinErrors.set(message, (joinErrors.get(message) ?? 0) + 1);
    return null;
  }
}

function createResult() {
  const finishedAt = performance.now();
  const durationSeconds = (finishedAt - startedAt) / 1000;
  return {
    serverUrl,
    roomName,
    requestedClients: clientCount,
    joinedClients: clients.length,
    joinFailures,
    joinErrors: Object.fromEntries(joinErrors),
    timedOut,
    targetMet: clients.length >= 500 && joinFailures === 0 && !timedOut,
    configuredHoldSeconds: durationMs / 1000,
    elapsedSeconds: durationSeconds,
    joinLatencyMs: {
      count: joinLatencies.length,
      p50: percentile(joinLatencies, 50),
      p95: percentile(joinLatencies, 95),
      max: percentile(joinLatencies, 100),
    },
    chatProbe: {
      sent: probeCountSent,
      echoed: messageLatencies.length,
      p50Ms: percentile(messageLatencies, 50),
      p95Ms: percentile(messageLatencies, 95),
      maxMs: percentile(messageLatencies, 100),
    },
    tickLatencyMs: {
      samples: tickLatencies.length,
      p50: percentile(tickLatencies, 50),
      p95: percentile(tickLatencies, 95),
      max: percentile(tickLatencies, 100),
    },
    observedMessages: messageCount,
    observedStateChanges: stateChangeCount,
    throughputPerSecond: {
      messages: messageCount / durationSeconds,
      stateChanges: stateChangeCount / durationSeconds,
    },
    harnessMemory: process.memoryUsage(),
  };
}

function printResult(extra = {}) {
  console.log(JSON.stringify({ ...createResult(), ...extra }, null, 2));
}

async function main() {
  const joins = [];
  for (let offset = 0; offset < clientCount; offset += joinBatchSize) {
    const batchCount = Math.min(joinBatchSize, clientCount - offset);
    const batch = await Promise.all(
      Array.from({ length: batchCount }, (_, index) => joinOne(offset + index)),
    );
    joins.push(...batch);
    if (offset + batchCount < clientCount) {
      await new Promise((resolve) => setTimeout(resolve, joinBatchDelayMs));
    }
  }
  const joinedRooms = joins.filter((room) => room !== null);
  const probeRooms = joinedRooms.slice(0, probeCount);
  for (const room of probeRooms) {
    const sentAt = performance.now();
    probeCountSent += 1;
    room.send("chat", { type: "chat", content: `load-probe-${sentAt}` });
  }

  const holdStartedAt = performance.now();
  let movementSequence = 0;
  while (performance.now() - holdStartedAt < durationMs) {
    for (const room of joinedRooms) {
      pendingMovement.set(room.sessionId, performance.now());
      room.send("move", { x: movementSequence % 2 === 0 ? 0.1 : 0, y: 0 });
      messageCount += 1;
    }
    movementSequence += 1;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const cleanupStartedAt = performance.now();
  await Promise.allSettled(clients.map((room) => timeout(room.leave(), 5000, "room leave")));
  clearTimeout(runTimer);
  printResult({
    outboundMoveMessages: joinedRooms.length * Math.ceil(durationMs / 1000),
    cleanupSeconds: (performance.now() - cleanupStartedAt) / 1000,
  });
  if (joinFailures > 0 || joinedRooms.length < clientCount) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
