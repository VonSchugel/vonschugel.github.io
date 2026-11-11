// Set the saved theme before paint; the site stays usable if storage is blocked.
(() => {
  try {
    const theme = localStorage.getItem('marqicci-theme');
    if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  } catch { /* Private browsing can block storage. */ }
})();
