(() => {
  const key = 'twistj-theme';
  const modes = ['system', 'light', 'dark'];
  const root = document.documentElement;
  let mode = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') mode = saved;
  } catch {}

  root.dataset.readingTheme = mode;
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('themeToggle');
    if (!button) return;
    const label = document.getElementById('themeIcon');

    function updateLabel() {
      label.textContent = mode[0].toUpperCase() + mode.slice(1);
    }

    button.addEventListener('click', () => {
      mode = modes[(modes.indexOf(mode) + 1) % modes.length];
      root.dataset.readingTheme = mode;
      updateLabel();
      try {
        if (mode === 'system') localStorage.removeItem(key);
        else localStorage.setItem(key, mode);
      } catch {}
    });

    updateLabel();
    button.hidden = false;
  }, { once: true });
})();
