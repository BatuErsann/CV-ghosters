(async function loadAds() {
  try {
    const response = await fetch("/api/ads-config", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const config = await response.json();
    if (!config.enabled || !config.client) return;

    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.adClient = config.client;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.client)}`;
    document.head.appendChild(script);
    document.documentElement.classList.add("ads-enabled");
  } catch {
    // Ads are optional; the core experience must remain available if blocked.
  }
})();
