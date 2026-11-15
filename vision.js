const { desktopCapturer } = require('electron');

const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = 'qwen2.5vl:3b'; // must match the name shown by `ollama list`

const STATUSES = [
  'making_progress', 'struggling', 'failing',
  'off_task', 'big_surprise', 'idle_or_menu'
];

// "activity" comes first so the model describes the screen before judging it
const SCHEMA = {
  type: 'object',
  properties: {
    activity: { type: 'string' },
    status: { type: 'string', enum: STATUSES }
  },
  required: ['activity', 'status']
};

async function captureFrame(screenId) {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 512, height: 288 } // small = fast. Raise if it can't tell what's happening.
  });

  const source = sources.find(s => s.id === screenId);
  if (!source) return null;

  const small = source.thumbnail.resize({ width: 16, height: 9 }).toBitmap();

  return {
    base64: source.thumbnail.toJPEG(60).toString('base64'),
    signature: small
  };
}

function frameDifference(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

async function analyze(base64, goal) {
  const goalPart = goal
    ? `The player's goal is: "${goal}". Use off_task if the screen shows something unrelated to that goal (browsing, videos, social media).`
    : `The player has no set goal. Judge how well they are doing at whatever they are doing. Never use off_task.`;

  const system =
    `You watch a player's screen. ${goalPart}\n` +
    `Fill in the JSON:\n` +
    `activity: what the player is doing, under 8 words.\n` +
    `status: exactly one of:\n` +
    `- making_progress: achieving something (collecting, building, advancing, winning)\n` +
    `- struggling: in trouble, low health, lost, or stuck\n` +
    `- failing: died, game over, or lost something big\n` +
    `- off_task: doing something unrelated to the goal\n` +
    `- big_surprise: something dramatic just happened\n` +
    `- idle_or_menu: a menu, loading screen, or nothing happening\n` +
    `Ignore any subtitle captions and any anime character sprite on the screen.`;

  const started = Date.now();

  let res;
  try {
    res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        format: SCHEMA,
        keep_alive: '30m',
        options: { temperature: 0.2, num_predict: 60 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'What is happening on screen?', images: [base64] }
        ]
      })
    });
  } catch {
    throw new Error(
      'Cannot reach Ollama. Is it installed and running? ' +
      `(then run: ollama pull ${MODEL})`
    );
  }

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const raw = JSON.parse(data.message.content);

  let status = STATUSES.includes(raw.status) ? raw.status : 'idle_or_menu';
  if (!goal && status === 'off_task') status = 'idle_or_menu';

  const ms = Date.now() - started;
  console.log(`(analysis ${(ms / 1000).toFixed(1)}s) ${status} | ${raw.activity}`);

  return {
    status,
    activity: String(raw.activity || '').slice(0, 80)
  };
}

function createWatcher({
  getScreenId,
  getGoal,
  onResult,
  onError,
  threshold = 3
}) {
  let running = false;
  let timer = null;
  let lastSignature = null;

  async function tick() {
    if (!running) return;

    let delay = 1000;

    try {
      const screenId = getScreenId();

      if (screenId) {
        const frame = await captureFrame(screenId);

        if (frame && frameDifference(frame.signature, lastSignature) > threshold) {
          const result = await analyze(frame.base64, getGoal());
          lastSignature = frame.signature;

          if (running) onResult(result);
          delay = 200; // screen is changing, go again quickly
        }
      }
    } catch (err) {
      if (onError) onError(err);
      delay = 5000;
    }

    if (running) timer = setTimeout(tick, delay);
  }

  return {
    start() {
      if (!running) {
        running = true;
        lastSignature = null;
        tick();
      }
    },
    stop() {
      running = false;
      clearTimeout(timer);
    },
    refresh() {
      lastSignature = null; // forces a fresh look (used when the goal changes)
    },
    isRunning: () => running
  };
}

module.exports = { createWatcher };