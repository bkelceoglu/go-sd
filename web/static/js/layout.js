// Workspace Layout Manager: Collapsible Sidebars, Responsive Showcase, & Focus Mode

export function initWorkspaceLayout() {
  const workspace = document.querySelector('.studio-workspace');
  if (!workspace) return;

  // Retrieve saved preferences or default to expanded
  let leftCollapsed = localStorage.getItem('go_sd_left_collapsed') === 'true';
  let rightCollapsed = localStorage.getItem('go_sd_right_collapsed') === 'true';

  // Toggle & Collapse Buttons
  const collapseLeftBtn = document.getElementById('collapseLeftBtn');
  const collapseRightBtn = document.getElementById('collapseRightBtn');
  const headerToggleLeftBtn = document.getElementById('headerToggleLeftBtn');
  const headerToggleRightBtn = document.getElementById('headerToggleRightBtn');
  const floatingExpandLeftBtn = document.getElementById('floatingExpandLeftBtn');
  const floatingExpandRightBtn = document.getElementById('floatingExpandRightBtn');

  function updateLayout() {
    if (leftCollapsed) {
      workspace.classList.add('collapse-left');
      if (headerToggleLeftBtn) headerToggleLeftBtn.classList.remove('active');
      if (floatingExpandLeftBtn) floatingExpandLeftBtn.classList.remove('hidden');
    } else {
      workspace.classList.remove('collapse-left');
      if (headerToggleLeftBtn) headerToggleLeftBtn.classList.add('active');
      if (floatingExpandLeftBtn) floatingExpandLeftBtn.classList.add('hidden');
    }

    if (rightCollapsed) {
      workspace.classList.add('collapse-right');
      if (headerToggleRightBtn) headerToggleRightBtn.classList.remove('active');
      if (floatingExpandRightBtn) floatingExpandRightBtn.classList.remove('hidden');
    } else {
      workspace.classList.remove('collapse-right');
      if (headerToggleRightBtn) headerToggleRightBtn.classList.add('active');
      if (floatingExpandRightBtn) floatingExpandRightBtn.classList.add('hidden');
    }

    localStorage.setItem('go_sd_left_collapsed', String(leftCollapsed));
    localStorage.setItem('go_sd_right_collapsed', String(rightCollapsed));

    // Notify components to recalculate responsive widths
    window.dispatchEvent(new Event('resize'));
  }

  // Toggle functions
  const toggleLeft = (force) => {
    leftCollapsed = (typeof force === 'boolean') ? force : !leftCollapsed;
    updateLayout();
  };

  const toggleRight = (force) => {
    rightCollapsed = (typeof force === 'boolean') ? force : !rightCollapsed;
    updateLayout();
  };

  // Wire event listeners
  if (collapseLeftBtn) collapseLeftBtn.addEventListener('click', () => toggleLeft(true));
  if (collapseRightBtn) collapseRightBtn.addEventListener('click', () => toggleRight(true));
  if (floatingExpandLeftBtn) floatingExpandLeftBtn.addEventListener('click', () => toggleLeft(false));
  if (floatingExpandRightBtn) floatingExpandRightBtn.addEventListener('click', () => toggleRight(false));
  if (headerToggleLeftBtn) headerToggleLeftBtn.addEventListener('click', () => toggleLeft());
  if (headerToggleRightBtn) headerToggleRightBtn.addEventListener('click', () => toggleRight());

  // Keyboard Shortcuts: Alt+1 (Left), Alt+2 (Right), Alt+F (Focus Mode)
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === '1') {
      e.preventDefault();
      toggleLeft();
    } else if (e.altKey && e.key === '2') {
      e.preventDefault();
      toggleRight();
    } else if (e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      const anyOpen = (!leftCollapsed || !rightCollapsed);
      toggleLeft(anyOpen);
      toggleRight(anyOpen);
    }
  });

  // Initial layout application
  updateLayout();
}
