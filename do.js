// do.js

document.addEventListener('DOMContentLoaded', () => {
  // Handles an event requiring concurrency mode.
  const modeSection = document.getElementById('mode');
  const modeOnHandler = () => {
    modeSection.classList.replace('covert', 'overt');
  };
  // Handles an event making concurrency mode inapplicable.
  const modeOffHandler = () => {
    modeSection.classList.replace('overt', 'covert');
  };
  document.getElementById('op-doc').addEventListener('change', modeOffHandler);
  document.getElementById('op-verdict').addEventListener('change', modeOffHandler);
  document.getElementById('op-take').addEventListener('change', modeOffHandler);
  document.getElementById('op-task').addEventListener('change', modeOnHandler);
  document.getElementById('op-case').addEventListener('change', modeOnHandler);
  document.getElementById('op-copy').addEventListener('change', modeOnHandler);
}, {once: true});
