const { desktopCapturer } = require('electron');

const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = 'qwen2.5vl:3b'; // must match the name shown by `ollama list`

const EXPRESSIONS = [
  'neutral', 'talking', 'pleased', 'sad',
  'angry', 'shocked', 'disappointed'
];

// The model only classifies the situation. Our code picks the expression.
const STATUS_MAP = {
  making_progress: { expression: 'pleased',       delta: 1 },
  struggling:      { expression: 'sad',           delta: -1 },
  failing:         { expression: 'disappointed',  delta: -2 },
  off_task:        { expression: 'angry',         delta: -1 },
  big_surprise:    { expression: 'shocked',       delta: 0 },
  idle_or_menu:    { expression: 'neutral',       delta: 0 }
};

const STATUSES = Object.keys(STATUS_MAP);

const REACTION_SCHEMA = {
  type: 'object',
  properties: {
    what_i_see: { type: 'string' },
    status: { type: 'string', enum: STATUSES },
    comment: { type: 'string' }
  },
  required: ['what_i_see', 'status', 'comment']
};

async function captureFrame(screenId) {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 640, height: 360 } // smaller = much faster
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

async function analyze(base64, ctx) {
  const system =
    `You are ${ctx.characterName}, watching a player's screen. Their goal: "${ctx.goal}". ` +
    `Earlier you noticed: ${ctx.lastNote || 'nothing yet'}.\n` +
    `Look at the screenshot and fill in the JSON:\n` +
    `what_i_see: one short sentence describing what is on screen.\n` +
    `status: pick exactly one:\n` +
    `- making_progress: the player is achieving something toward the goal (collecting, building, advancing, winning)\n` +
    `- struggling: the player is in trouble, low health, lost, or stuck\n` +
    `- failing: the player died, got a game over, or lost something big\n` +
    `- off_task: the screen shows something unrelated to the goal (browsing, videos, social media)\n` +
    `- big_surprise: something dramatic or unexpected just happened\n` +
    `- idle_or_menu: a menu, loading screen, or nothing is happening\n` +
    `comment: a short in-character line (under 12 words) reacting to it, spoken to the player.\n` +
    `Ignore any anime character sprite on the screen, that is you.`;

  const started = Date.now();

  let res;
  try {
    res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        format: REACTION_SCHEMA,
        keep_alive: '30m',
        options: {
          temperature: 0.2,
          num_predict: 120 // cap the answer length so it can't ramble
        },
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: 'What is happening on screen right now?',
            images: [base64]
          }
        ]
      })
    });
  } catch {
    throw new Error(
      'Cannot reach Ollama. Is it installed and running? ' +
      `(then run: ollama pull ${MODEL})`
    );
  }

  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const raw = JSON.parse(data.message.content);

  const status = STATUS_MAP[raw.status] ? raw.status : 'idle_or_menu';
  const mapped = STATUS_MAP[status];

  console.log(
    `(analysis took ${((Date.now() - started) / 1000).toFixed(1)}s) ` +
    `status=${status} | saw: ${raw.what_i_see}`
  );

  return {
    expression: mapped.expression,
    affinity_delta: mapped.delta,
    comment: String(raw.comment || '').slice(0, 120),
    progress_note: String(raw.what_i_see || '').slice(0, 200)
  };
}

function createWatcher({
  getScreenId,
  getContext,
  onReaction,
  onError,
  intervalMs = 2000
}) {
  let running = false;
  let timer = null;
  let lastSignature = null;

  async function tick() {
    if (!running) return;

    try {
      const screenId = getScreenId();

      if (screenId) {
        const frame = await captureFrame(screenId);

        if (frame && frameDifference(frame.signature, lastSignature) > 2) {
          lastSignature = frame.signature;
          const reaction = await analyze(frame.base64, getContext());
          await onReaction(reaction);
        }
      }
    } catch (err) {
      if (onError) onError(err);
    }

    // Waits for each analysis to finish, so a slow PC just reacts less often
    if (running) timer = setTimeout(tick, intervalMs);
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
    isRunning: () => running
  };
}

module.exports = { createWatcher };