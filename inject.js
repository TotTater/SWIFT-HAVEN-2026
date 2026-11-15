// These functions run INSIDE your windows' pages (window.haven comes from preload.js).

function captionOverlay() {
  if (document.getElementById('haven-caption')) return;

  const style = document.createElement('style');
  style.textContent = `
    #haven-caption {
      position: fixed;
      left: 50%;
      bottom: 7%;
      transform: translateX(-50%);
      max-width: 70%;
      padding: 10px 22px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      font-family: system-ui, 'Segoe UI', sans-serif;
      text-align: center;
      opacity: 0;
      transition: opacity 0.25s;
      pointer-events: none;
      z-index: 99999;
    }
    #haven-caption.show { opacity: 1; }
    #haven-caption .hc-main { font-size: 28px; font-weight: 600; line-height: 1.25; }
    #haven-caption .hc-sub  { font-size: 15px; opacity: 0.7; margin-top: 4px; font-style: italic; }
  `;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.id = 'haven-caption';

  const main = document.createElement('div');
  main.className = 'hc-main';

  const sub = document.createElement('div');
  sub.className = 'hc-sub';

  box.appendChild(main);
  box.appendChild(sub);
  document.body.appendChild(box);

  let hideTimer;

  window.haven.onReaction(data => {
    if (!data || !data.text) return;

    main.textContent = data.text;
    sub.textContent = data.activity || '';
    sub.style.display = data.activity ? 'block' : 'none';

    box.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => box.classList.remove('show'), 4500);
  });
}


function goalPanel() {
  if (document.getElementById('haven-goal')) return;

  const style = document.createElement('style');
  style.textContent = `
    #haven-goal {
      position: fixed; left: 0; right: 0; bottom: 0;
      box-sizing: border-box; padding: 12px;
      background: rgba(20, 20, 32, 0.96); color: #fff;
      font: 14px/1.3 system-ui, sans-serif;
      border-top: 1px solid #444; z-index: 99999;
    }
    @media (max-width: 200px) { #haven-goal { display: none; } }
    #haven-goal input {
      width: 100%; box-sizing: border-box; padding: 8px; margin: 6px 0;
      border-radius: 6px; border: 1px solid #666; background: #111; color: #fff;
    }
    #haven-goal button {
      padding: 7px 12px; border: 0; border-radius: 6px; margin-right: 6px;
      background: #ff7eb6; color: #111; font-weight: 600; cursor: pointer;
    }
    #haven-goal button.alt { background: #444; color: #fff; }
    #haven-goal .hg-status { opacity: 0.8; font-size: 12px; margin-top: 8px; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'haven-goal';
  panel.innerHTML =
    '<strong>Set your goal</strong>' +
    '<input id="hg-input" maxlength="200" placeholder="e.g. Reach the Nether in Minecraft">' +
    '<button id="hg-set">Set goal</button>' +
    '<button id="hg-clear" class="alt">Clear</button>' +
    '<button id="hg-pause" class="alt">Pause</button>' +
    '<div class="hg-status" id="hg-status"></div>';
  document.body.appendChild(panel);

  const input = panel.querySelector('#hg-input');
  const statusEl = panel.querySelector('#hg-status');
  const pauseBtn = panel.querySelector('#hg-pause');

  let goal = '';
  let affinity = 0;
  let paused = false;

  function render(message) {
    statusEl.textContent =
      (goal ? 'Goal: ' + goal : 'No goal - just hanging out') +
      '  |  \u2665 ' + affinity +
      (message ? '  |  ' + message : '');
  }

  async function saveGoal(text) {
    await window.haven.setGoal(text);
    goal = text;
    render();
  }

  panel.querySelector('#hg-set').addEventListener('click', () => {
    saveGoal(input.value.trim());
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveGoal(input.value.trim());
  });

  panel.querySelector('#hg-clear').addEventListener('click', () => {
    input.value = '';
    saveGoal('');
  });

  pauseBtn.addEventListener('click', async () => {
    if (!paused) {
      await window.haven.stopWatching();
      paused = true;
      pauseBtn.textContent = 'Resume';
      render('paused');
    } else {
      const result = await window.haven.startWatching();
      if (result.ok) {
        paused = false;
        pauseBtn.textContent = 'Pause';
        render();
      } else {
        render(result.message);
      }
    }
  });

  window.haven.onReaction(data => {
    if (data && typeof data.affinity === 'number') {
      affinity = data.affinity;
      render();
    }
  });

  (async () => {
    goal = await window.haven.getGoal();
    affinity = await window.haven.getAffinity();
    input.value = goal;
    render();
  })();
}

const asScript = fn => `(${fn.toString()})()`;

module.exports = {
  CAPTION_SCRIPT: asScript(captionOverlay),
  GOAL_PANEL_SCRIPT: asScript(goalPanel)
};