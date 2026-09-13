/*
 * Keep the public verification script in <head>, but do not mark the app as
 * ad-ready while it is showing a loading, empty, error, modal, or admin view.
 * Actual ad placement remains controlled by AdSense; this guard prevents our
 * UI from advertising empty rails as ad inventory.
 */
(() => {
  const adsenseScript = document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]');
  if (!adsenseScript) return;

  const hasMeaningfulContent = () => {
    const discoverView = document.querySelector("#discover-view");
    if (!discoverView || discoverView.classList.contains("hidden")) return false;
    const listingCards = document.querySelectorAll("#listing-grid .listing-card").length;
    const recentRows = document.querySelectorAll("#recent-list .recent-row").length;
    const insightRows = document.querySelectorAll("#repeated-jobs .ranking-row, #company-rankings .ranking-row").length;
    return listingCards > 0 || recentRows > 0 || insightRows > 0;
  };

  const sync = () => {
    document.documentElement.classList.toggle("ads-content-ready", hasMeaningfulContent());
  };

  window.addEventListener("cvghost:content-ready", sync);
  window.addEventListener("hashchange", sync);
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  sync();
})();
