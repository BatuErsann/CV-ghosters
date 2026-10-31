// Verification uses a meta tag. Advertising requires a configured manual unit
// and a successfully loaded archive. Auto Ads must stay disabled in AdSense.
(() => {
  const placement = document.querySelector("#content-ad");
  if (!placement) return;
  let config;
  let requested = false;
  let unit;
  let scriptLoaded = false;
  let unitStarted = false;
  const eligible = () => {
    const view = document.querySelector("#discover-view");
    return document.documentElement.dataset.archiveState === "ready"
      && !view.classList.contains("hidden")
      && document.querySelector("#submit-modal").classList.contains("hidden")
      && Boolean(view.querySelector("#listing-grid .listing-card"));
  };
  const sync = () => {
    const allowed = Boolean(config?.enabled && eligible());
    placement.hidden = !allowed;
    if (!allowed) return;
    if (scriptLoaded && !unitStarted) {
      unitStarted = true;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
    if (requested) return;
    requested = true;
    unit = document.createElement("ins");
    unit.className = "adsbygoogle";
    unit.style.display = "block";
    unit.dataset.adClient = config.client;
    unit.dataset.adSlot = config.slot;
    unit.dataset.adFormat = "auto";
    unit.dataset.fullWidthResponsive = "true";
    placement.append(unit);
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.client}`;
    script.addEventListener("load", () => { scriptLoaded = true; sync(); }, { once: true });
    script.addEventListener("error", () => { placement.hidden = true; }, { once: true });
    document.head.append(script);
  };
  window.addEventListener("cvghost:content-ready", sync);
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true });
  fetch("/api/ads-config").then((response) => response.ok ? response.json() : null).then((value) => {
    if (!value?.enabled || !/^ca-pub-\d+$/.test(value.client) || !/^\d{10}$/.test(value.slot)) return;
    config = value;
    sync();
  }).catch(() => { placement.hidden = true; });
})();
