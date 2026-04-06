// Navigation and interaction scripts for GVE Knowledgebase

document.addEventListener('DOMContentLoaded', function() {
  // Highlight current page in navigation
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('.nav-section a');
  
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || href === '#' + window.location.hash) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
  
  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
  
  // Collapsible sections
  document.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', function() {
      const parent = this.parentElement;
      parent.classList.toggle('expanded');
      
      // Update indicator
      const indicator = this.querySelector('.indicator');
      if (indicator) {
        indicator.textContent = parent.classList.contains('expanded') ? '▼' : '▶';
      }
    });
  });
  
  // Mobile sidebar toggle (if implemented)
  const sidebarToggle = document.querySelector('.sidebar-toggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function() {
      document.querySelector('.sidebar').classList.toggle('open');
    });
  }
  
  // Copy code blocks
  document.querySelectorAll('.code-block').forEach(block => {
    const button = document.createElement('button');
    button.className = 'copy-button';
    button.textContent = 'Copy';
    button.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 4px 12px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s;
    `;
    
    block.style.position = 'relative';
    block.appendChild(button);
    
    block.addEventListener('mouseenter', () => button.style.opacity = '1');
    block.addEventListener('mouseleave', () => button.style.opacity = '0');
    
    button.addEventListener('click', async () => {
      const code = block.textContent.replace('Copy', '').trim();
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied!';
      setTimeout(() => button.textContent = 'Copy', 2000);
    });
  });
});

// Search functionality (if search input exists)
function setupSearch() {
  const searchInput = document.querySelector('.search-input');
  if (!searchInput) return;
  
  searchInput.addEventListener('input', function() {
    const query = this.value.toLowerCase();
    const sections = document.querySelectorAll('.section');
    
    sections.forEach(section => {
      const text = section.textContent.toLowerCase();
      if (text.includes(query)) {
        section.style.display = 'block';
      } else {
        section.style.display = query ? 'none' : 'block';
      }
    });
  });
}
