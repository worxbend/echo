(() => {
  'use strict';

  const root = document.documentElement;
  const themeToggle = document.querySelector('[data-theme-toggle]');
  const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let explicitTheme = null;
  try {
    const saved = localStorage.getItem('echo-theme');
    if (saved === 'light' || saved === 'dark') explicitTheme = saved;
  } catch { /* The page remains usable when storage is unavailable. */ }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    const next = theme === 'dark' ? 'light' : 'dark';
    themeToggle.setAttribute('aria-label', `Switch to ${next} theme`);
    themeToggle.title = `Switch to ${next} theme`;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#101b32' : '#f0f3f8';
    themeToggle.querySelector('path').setAttribute('d', theme === 'dark'
      ? 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'
      : 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z');
  }
  applyTheme(explicitTheme ?? (preferredTheme.matches ? 'dark' : 'light'));
  themeToggle.hidden = false;
  themeToggle.addEventListener('click', () => {
    explicitTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(explicitTheme);
    try { localStorage.setItem('echo-theme', explicitTheme); } catch { /* Session-only choice. */ }
  });
  preferredTheme.addEventListener('change', event => {
    if (!explicitTheme) applyTheme(event.matches ? 'dark' : 'light');
  });

  const scenes = {
    notification: { label: 'Notification badge', rows: ['......A.', '.CCCCCA.', '.C...C.A', '.C...C..', '.C...C..', '.CCCCC..', '..WA....', '........'] },
    success: { label: 'All clear — sample pixel art', rows: ['........', '......C.', '.....CC.', '.W..CC..', '.WW.C...', '..WWW...', '...W....', '........'] },
    heartbeat: { label: 'Heartbeat — sample pixel art', rows: ['........', '.AA.AA..', 'AAAAAAA.', 'AAAAAAA.', '.AAAAA..', '..AAA...', '...A....', '........'] },
  };
  const tones = { '.': 'off', C: 'cyan', A: 'amber', W: 'white' };
  const pixels = [...document.querySelectorAll('[data-matrix] > span')];
  const sceneButtons = [...document.querySelectorAll('button[data-scene]')];
  const caption = document.getElementById('scene-caption');
  for (const button of sceneButtons) {
    button.addEventListener('click', () => {
      const scene = scenes[button.dataset.scene];
      if (!scene) return;
      [...scene.rows.join('')].forEach((tone, index) => { pixels[index].dataset.tone = tones[tone]; });
      for (const control of sceneButtons) control.setAttribute('aria-pressed', String(control === button));
      caption.textContent = scene.label;
    });
  }
  document.querySelector('.scene-controls').hidden = false;

  const status = document.querySelector('[data-copy-status]');
  for (const button of document.querySelectorAll('button[data-copy]')) {
    button.hidden = false;
    const label = button.textContent;
    button.addEventListener('click', async () => {
      const code = document.getElementById(button.dataset.copy);
      button.disabled = true;
      button.textContent = 'Copying…';
      status.textContent = '';
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(code.textContent.trim());
        button.textContent = 'Copied';
        status.textContent = 'Copied to clipboard. Review the commands before running them.';
      } catch {
        button.textContent = label;
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(code);
        selection?.removeAllRanges();
        selection?.addRange(range);
        status.textContent = 'Clipboard access is unavailable. The command is selected; copy it with Ctrl+C or your browser’s copy action.';
      } finally {
        button.disabled = false;
      }
    });
  }
})();
