const savedSector = localStorage.getItem("cvghost-sector") || "ALL";
const state = { listings: [], selectedId: null, mode: "ALL", query: "", sector: SectorCatalog.isSector(savedSector) ? savedSector : "ALL", contentController: new AbortController(), loadGeneration: 0, archiveReady: false, pendingReads: 0, archiveError: false };
const deviceId = localStorage.getItem("ilaniz-device-id") || (() => { const value = `device_${Date.now()}_${Math.random().toString(16).slice(2)}`; localStorage.setItem("ilaniz-device-id", value); return value; })();
let recentFilter = "all";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const formatDate = (value) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" }).format(new Date(value));
const formatSalary = (item) => item.salaryMin ? `${Number(item.salaryMin).toLocaleString("tr-TR")} – ${Number(item.salaryMax).toLocaleString("tr-TR")} ${item.salaryCurrency || ""}` : "";
const modeLabel = { REMOTE: "Uzaktan", HYBRID: "Hibrit", ONSITE: "Ofis", UNSPECIFIED: "Belirtilmemiş" };
const modeIcon = { REMOTE: "⌁", HYBRID: "⇄", ONSITE: "⌂", UNSPECIFIED: "·" };

async function api(path, options) {
  const requestOptions = options || {};
  const headers = requestOptions.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const contentRead = !requestOptions.method || requestOptions.method === "GET";
  const scopedRead = contentRead && /^\/api\/(stats|listings|recent|companies)(?:[/?]|$)/.test(path);
  const requestedSector = state.sector;
  if (scopedRead) {
    const url = new URL(path, location.origin);
    url.searchParams.set("sector", requestedSector);
    path = `${url.pathname}${url.search}`;
  }
  if (contentRead) { state.pendingReads += 1; updateArchiveState(); }
  try {
    const response = await fetch(path, { ...requestOptions, ...(scopedRead ? { signal: state.contentController.signal } : {}), headers: { ...headers, ...(requestOptions.headers || {}) } });
    const body = await response.json();
    if (scopedRead && requestedSector !== state.sector) throw new DOMException("Sektör değişti", "AbortError");
    if (!response.ok) { const error = new Error(body.error?.message || "Beklenmeyen bir hata oluştu."); error.payload = body; error.status = response.status; throw error; }
    return body;
  } catch (error) {
    if (contentRead && error.name !== "AbortError") showArchiveError();
    throw error;
  } finally {
    if (contentRead) { state.pendingReads -= 1; updateArchiveState(); }
  }
}

function updateArchiveState() {
  document.documentElement.dataset.archiveState = state.archiveError ? "error" : state.archiveReady && state.pendingReads === 0 ? "ready" : "loading";
  window.dispatchEvent(new Event("cvghost:content-ready"));
}

function showArchiveError() {
  state.archiveError = true;
  state.archiveReady = false;
  const status = $("#archive-status");
  status.innerHTML = `<strong>İlan arşivi şu anda yüklenemiyor</strong><p>Bağlantı geçici olarak kesilmiş olabilir. Biraz sonra yeniden deneyebilirsiniz.</p><button class="secondary-button" id="retry-archive">Yeniden dene</button>`;
  status.classList.remove("hidden");
  $("#retry-archive").addEventListener("click", loadInitialData);
  $$("#metrics .skeleton").forEach((item) => item.classList.remove("skeleton"));
  updateArchiveState();
}

async function loadInitialData() {
  const generation = ++state.loadGeneration;
  state.archiveReady = false;
  state.archiveError = false;
  $("#archive-status").classList.add("hidden");
  updateArchiveState();
  const results = await Promise.allSettled([
    api("/api/stats").then((stats) => { renderMetrics(stats); renderInsights(stats); }),
    loadListings(),
    loadRecent()
  ]);
  if (generation !== state.loadGeneration) return;
  if (results.some((result) => result.status === "rejected")) showArchiveError();
  else state.archiveReady = true;
  updateArchiveState();
}

function setupSectorFilter() {
  const options = SectorCatalog.sectors.map((sector) => `<option value="${sector.id}">${sector.label}</option>`).join("");
  $("#sector-filter").innerHTML = `<option value="ALL">Tüm sektörler</option>${options}`;
  $("#sector-filter").value = state.sector;
  const sectorField = document.createElement("label");
  sectorField.innerHTML = `İlanın sektörü <span>Onay ekranında değiştirebilirsiniz</span><select name="sector" id="submission-sector"><option value="">Başlıktan otomatik belirle</option>${options}</select>`;
  $("#submit-form").insertBefore(sectorField, $("#submit-form .form-hint"));
  const updateLabel = () => {
    $("#sector-scope").textContent = state.sector === "ALL" ? "İlanlar ve sıralamalar tüm sektörleri kapsıyor." : `${SectorCatalog.label(state.sector)}: ilanlar ve sıralamalar bu alanla sınırlı.`;
  };
  updateLabel();
  $("#sector-filter").addEventListener("change", async (event) => {
    state.contentController.abort();
    state.contentController = new AbortController();
    state.sector = event.target.value;
    state.selectedId = null;
    localStorage.setItem("cvghost-sector", state.sector);
    updateLabel();
    for (const selector of ["#metrics", "#listing-grid", "#repeated-jobs", "#company-rankings", "#recent-list", "#activity-feed", "#stats-board", "#company-directory"]) $(selector).replaceChildren();
    $("#detail-panel").innerHTML = `<div class="empty-detail"><h3>İlanlar yükleniyor</h3><p>${escapeHtml(SectorCatalog.label(state.sector))}</p></div>`;
    $("#company-detail-panel").innerHTML = `<div class="empty-detail"><h3>Bir şirket seçin</h3><p>Seçili sektördeki ilan geçmişini görmek için bir şirket seçin.</p></div>`;
    if (location.hash.startsWith("#company=")) history.replaceState({}, "", "#companies");
    await loadInitialData();
    const view = $(".nav-item.active")?.dataset.view;
    try {
      if (view === "timeline") await loadActivity();
      if (view === "stats") await loadStats();
      if (view === "companies") await loadCompanies();
    } catch (error) { if (error.name !== "AbortError") showToast(error.message); }
  });
}

function initials(company) { return company.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }

function renderMetrics(stats) {
  const metrics = [
    ["Arşivdeki ilan", stats.listingCount, "toplam kayıt", ""],
    ["Aktif ilan", stats.activeCount, "şu an takipte", "metric-accent"],
    ["Topluluk doğrulaması", stats.verificationCount, "güven sinyali", ""]
  ];
  $("#metrics").innerHTML = metrics.map(([label, value, note, accent]) => `<div class="metric-card"><div class="metric-top"><span>${label}</span>${accent ? `<i class="${accent}"></i>` : `<span class="metric-change">canlı</span>`}</div><div class="metric-value">${value}</div><div class="metric-top" style="margin-top:7px"><span>${note}</span></div></div>`).join("");
}

function renderInsights(stats) {
  const repeatedJobs = stats.repeatedJobs || [];
  const rankings = stats.companyRankings || [];
  $("#repeated-jobs").innerHTML = repeatedJobs.length ? repeatedJobs.map((item, index) => `<div class="ranking-row"><span class="rank-number">0${index + 1}</span><div class="ranking-main"><strong>${escapeHtml(item.title)}</strong><small>${item.companies} şirket · ${item.activeCount} aktif ilan</small></div><b>${item.versions}<small>sürüm</small></b></div>`).join("") : `<div class="ranking-empty">Henüz yeterli tekrar verisi yok.</div>`;
  $("#company-rankings").innerHTML = rankings.length ? rankings.map((item, index) => `<div class="ranking-row"><span class="rank-number company-rank">${index + 1}</span><div class="ranking-main"><strong>${escapeHtml(item.company)}</strong><small>${item.listings} ilan · ${item.activeCount} aktif</small></div><b>${item.verifications}<small>doğrulama</small></b></div>`).join("") : `<div class="ranking-empty">Henüz şirket verisi yok.</div>`;
}

function renderListings() {
  const grid = $("#listing-grid");
  if (!state.listings.length) { grid.innerHTML = state.query || state.mode !== "ALL" || state.sector !== "ALL" ? `<div class="empty-detail"><h3>Bu seçimde ilan bulunamadı</h3><p>Seçtiğiniz sektörde henüz kayıt olmayabilir. Sektörü veya arama filtrelerini değiştirebilirsiniz.</p></div>` : `<div class="empty-detail"><h3>Henüz ilan kaydı yok</h3><p>İlan ekran görüntünüzü ekleyip bilgileri onaylayarak arşive ilk katkıyı yapabilirsiniz.</p></div>`; return; }
  grid.innerHTML = state.listings.map((item) => `<article class="listing-card ${item.id === state.selectedId ? "active" : ""}" data-id="${item.id}">
    <div class="card-top"><div class="company-line"><div class="company-avatar">${initials(item.company)}</div>${escapeHtml(item.company)}</div><span class="status ${item.status === "ACTIVE" ? "active" : "review"}">${item.status === "ACTIVE" ? "Aktif" : "İnceleme"}</span></div>
    <h3>${escapeHtml(item.title)}</h3><div class="listing-sector">${escapeHtml(SectorCatalog.label(item.sector))}</div><div class="card-meta"><span>⌖ ${escapeHtml(item.location)}</span><span>${modeIcon[item.workMode] || "·"} ${modeLabel[item.workMode] || item.workMode}</span></div>
    ${item.salaryMin ? `<div class="salary">${formatSalary(item)}</div>` : ""}
    <div class="card-footer"><span>${item.versionCount > 1 ? `${item.versionCount} sürüm · ` : ""}${formatDate(item.lastSeenAt)} güncellendi</span><span class="verification">✓ ${item.verifications}</span></div>
  </article>`).join("");
  $$(".listing-card").forEach((card) => card.addEventListener("click", () => selectListing(card.dataset.id).catch(showReadError)));
}

async function loadListings() {
  const params = new URLSearchParams({ q: state.query, mode: state.mode });
  const data = await api(`/api/listings?${params}`);
  state.listings = data.items;
  if (!state.selectedId && state.listings[0]) state.selectedId = state.listings[0].id;
  if (state.selectedId && !state.listings.some((item) => item.id === state.selectedId)) state.selectedId = state.listings[0]?.id || null;
  renderListings();
  if (state.selectedId) await renderDetail(state.selectedId);
  else $("#detail-panel").innerHTML = `<div class="empty-detail"><h3>Gösterilecek ilan yok</h3><p>Farklı bir arama veya filtre deneyin.</p></div>`;
  window.dispatchEvent(new Event("cvghost:content-ready"));
}

async function loadRecent() {
  const data = await api(`/api/recent?deviceId=${encodeURIComponent(deviceId)}`);
  const items = recentFilter === "mine" ? data.items.filter((item) => item.isMine) : data.items;
  $("#recent-list").innerHTML = items.length ? items.slice(0, 8).map((item) => `<article class="recent-row" data-listing-id="${item.listingId}"><div class="recent-status ${item.applicationInsight?.tone || "neutral"}">${item.applicationInsight?.type === "POOL_SIGNAL" ? "!" : "✓"}</div><div class="recent-main"><div><strong>${escapeHtml(item.title)}</strong><span class="recent-company">${escapeHtml(item.company)}</span></div><p>${escapeHtml(item.applicationInsight?.detail || "Başvuru hareketi kaydedildi.")}</p><small>${item.appliedAt ? `Başvuru: ${formatDate(item.appliedAt)}` : "Başvuru tarihi yok"}${item.repostedAt ? ` · Yeniden yayın: ${formatDate(item.repostedAt)}` : ""} · ${item.hasEvidence ? "OCR kanıtı var" : "Kanıt yok"}</small></div><span class="recent-arrow">→</span></article>`).join("") : `<div class="recent-empty">${recentFilter === "mine" ? "Bu cihazdan henüz kayıt eklenmedi." : "Henüz son eklenen kayıt yok."}<button class="text-button" id="empty-submit">İlk kanıtı ekle →</button></div>`;
  $$(".recent-row").forEach((row) => row.addEventListener("click", () => selectListing(row.dataset.listingId).catch(showReadError)));
  $("#empty-submit")?.addEventListener("click", openSubmit);
  window.dispatchEvent(new Event("cvghost:content-ready"));
}

async function selectListing(id) { state.selectedId = id; renderListings(); await renderDetail(id); }

async function renderDetail(id) {
  const data = await api(`/api/listings/${id}`);
  const item = data.listing;
  const eventRows = data.timeline.slice(0, 5).map((event) => `<div class="change-item"><i class="change-dot"></i><div><strong>${escapeHtml(event.label)}</strong><p>${escapeHtml(event.detail)} · ${formatDate(event.at)}</p></div></div>`).join("");
  $("#detail-panel").innerHTML = `<div class="detail-header"><div class="company-line"><div class="company-avatar">${initials(item.company)}</div>${escapeHtml(item.company)}<span class="status ${item.status === "ACTIVE" ? "active" : "review"}">${item.status === "ACTIVE" ? "Aktif" : "İnceleme"}</span></div><h2>${escapeHtml(item.title)}</h2><div class="detail-meta"><span>⌖ ${escapeHtml(item.location)}</span><span>${modeIcon[item.workMode]} ${modeLabel[item.workMode]}</span><span>İlk görülme: ${formatDate(item.firstSeenAt)}</span></div></div><div class="detail-tabs"><button class="active">Geçmiş</button><button>Kaynak</button><button>İstatistik</button></div><div class="detail-body"><div class="change-list">${eventRows || "<p>Henüz timeline olayı yok.</p>"}</div><div class="detail-actions"><button class="secondary-button" id="verify-button">✓ İlanı doğrula</button><button class="secondary-button" id="source-button">↗ Kaynağı aç</button><button class="secondary-button" id="report-button">⚑ Raporla</button></div></div>`;
  $("#verify-button").addEventListener("click", async () => { await api(`/api/listings/${id}/verify`, { method: "POST", body: JSON.stringify({ userId: "demo-user" }) }); showToast("Doğrulamanız kaydedildi."); await loadListings(); });
  $("#source-button").addEventListener("click", () => item.sourceUrl ? window.open(item.sourceUrl, "_blank", "noopener") : showToast("Bu kayıtta kaynak URL bulunmuyor."));
  $("#report-button").addEventListener("click", async () => { const reason = window.prompt("Bu ilanı neden raporluyorsunuz?", "Yanlış veya güncel olmayan bilgi"); if (!reason) return; await api(`/api/listings/${id}/report`, { method: "POST", body: JSON.stringify({ reason }) }); showToast("Rapor moderasyon kuyruğuna alındı."); });
}

async function loadActivity() {
  const data = await api("/api/listings");
  const events = data.items.flatMap((item) => (item.versionCount > 1 ? [{ item, type: "VERSION_ADDED", label: "İlan geçmişi güncellendi", detail: `${item.company} · ${item.title}`, at: item.lastSeenAt }] : [{ item, type: "FIRST_SEEN", label: "Yeni ilan arşive alındı", detail: `${item.company} · ${item.title}`, at: item.firstSeenAt }])).sort((a, b) => new Date(b.at) - new Date(a.at));
  $("#activity-feed").innerHTML = events.map((event) => `<div class="activity-row"><div class="activity-icon">${event.type === "VERSION_ADDED" ? "↻" : "＋"}</div><div><h3>${event.label}</h3><p>${escapeHtml(event.detail)}</p></div><time>${formatDate(event.at)}</time></div>`).join("");
}

async function loadStats() {
  const stats = await api("/api/stats");
  $("#stats-board").innerHTML = [["İlan arşivi", stats.listingCount, "Toplam normalize edilmiş kayıt"], ["Değişiklik oranı", `${Math.round(stats.changeRate * 100)}%`, "Birden fazla sürümü olan ilanlar"], ["Topluluk güveni", stats.verificationCount, "Toplam doğrulama sinyali"], ["Aktif ilan", stats.activeCount, "Takibi devam eden ilanlar"], ["Şirket çeşitliliği", stats.companyCount, "Arşivde temsil edilen şirket"]].map(([label, value, note]) => `<div class="stat-big"><h3>${label}</h3><strong>${value}</strong><p>${note}</p></div>`).join("");
}

async function loadCompanies() {
  const data = await api("/api/companies");
  $("#company-directory").innerHTML = data.items.length ? data.items.map((company, index) => `<article class="company-card" data-company-key="${company.key}"><div class="company-card-top"><span class="company-rank-badge">${String(index + 1).padStart(2, "0")}</span><div class="company-avatar large">${initials(company.name)}</div><span class="company-card-arrow">→</span></div><h3>${escapeHtml(company.name)}</h3><p>${company.listingCount} ilan · ${company.repeatedCount} tekrar eden kayıt</p><div class="company-card-stats"><span>${company.totalVersions} sürüm</span><span>${company.poolSignals} havuz sinyali</span></div></article>`).join("") : `<div class="recent-empty">Henüz şirket kaydı yok.</div>`;
  $$(".company-card").forEach((card) => card.addEventListener("click", () => openCompany(decodeURIComponent(card.dataset.companyKey)).catch(showReadError)));
  if (location.hash.startsWith("#company=")) await openCompany(decodeURIComponent(location.hash.slice(9)));
}

async function openCompany(companyName) {
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === "companies"));
  ["discover", "timeline", "stats", "companies"].forEach((name) => $(`#${name}-view`).classList.toggle("hidden", name !== "companies"));
  history.replaceState({}, "", `#company=${encodeURIComponent(companyName)}`);
  const data = await api(`/api/companies/${encodeURIComponent(companyName)}`);
  const company = data.company;
  $("#company-detail-panel").innerHTML = `<div class="company-detail-header"><button class="back-button" id="back-companies">← Şirketler</button><div class="company-detail-brand"><div class="company-avatar large">${initials(company.name)}</div><div><h2>${escapeHtml(company.name)}</h2><p>${company.listingCount} ilan · ${company.totalVersions} sürüm</p></div></div><div class="company-detail-metrics"><div><strong>${company.repeatedCount}</strong><span>tekrar eden ilan</span></div><div><strong>${company.activeCount}</strong><span>aktif ilan</span></div><div><strong>${company.poolSignals}</strong><span>havuz sinyali</span></div></div></div><div class="company-listing-list"><div class="company-list-title">İlan geçmişi</div>${company.listings.map((listing) => `<article class="company-listing-row" data-listing-id="${listing.id}"><div><strong>${escapeHtml(listing.title)}</strong><small>${escapeHtml(listing.location)} · ${modeLabel[listing.workMode] || listing.workMode}</small></div><div class="company-listing-right"><span class="repeat-pill ${listing.repeatCount ? "has-repeat" : ""}">${listing.repeatCount ? `${listing.repeatCount} tekrar` : "İlk kayıt"}</span><small>${formatDate(listing.lastSeenAt)}</small></div></article>`).join("")}</div>`;
  $("#back-companies").addEventListener("click", () => { history.replaceState({}, "", "#companies"); $("#company-detail-panel").innerHTML = `<div class="empty-detail"><div class="empty-orb">⌂</div><h3>Bir şirket seçin</h3><p>Şirketin ilan tekrarlarını ve son durumunu görmek için listeden bir şirket seçin.</p></div>`; });
  $$(".company-listing-row").forEach((row) => row.addEventListener("click", () => { state.selectedId = row.dataset.listingId; document.querySelector('[data-view="discover"]').click(); renderDetail(row.dataset.listingId); }));
}

function openSubmit() { $("#submit-modal").classList.remove("hidden"); $("#form-result").classList.add("hidden"); $("#submit-form").reset(); }
function closeSubmit() { $("#submit-modal").classList.add("hidden"); }
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.remove("hidden"); setTimeout(() => toast.classList.add("hidden"), 2600); }
function showReadError(error) { if (error.name !== "AbortError") showToast(error.message); }

function setupNavigation() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", async () => {
    const view = button.dataset.view;
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
    ["discover", "timeline", "stats", "companies"].forEach((name) => $(`#${name}-view`).classList.toggle("hidden", name !== view));
    try {
      if (view === "timeline") await loadActivity();
      if (view === "stats") await loadStats();
      if (view === "companies") await loadCompanies();
    } catch (error) { showReadError(error); }
    updateArchiveState();
  }));
}

$("#open-submit").addEventListener("click", openSubmit); $("#sidebar-submit").addEventListener("click", openSubmit); $("#close-submit").addEventListener("click", closeSubmit);
$("#submit-modal").addEventListener("click", (event) => { if (event.target.id === "submit-modal") closeSubmit(); });
$("#search").addEventListener("input", (event) => { state.query = event.target.value; loadListings().catch(showReadError); });
$$('.filter').forEach((button) => button.addEventListener("click", () => { $$('.filter').forEach((item) => item.classList.toggle("selected", item === button)); state.mode = button.dataset.mode; loadListings().catch(showReadError); }));
$$('[data-recent-filter]').forEach((button) => button.addEventListener("click", async () => { recentFilter = button.dataset.recentFilter; $$('[data-recent-filter]').forEach((item) => item.classList.toggle("selected", item === button)); await loadRecent().catch(showReadError); }));
$("#submit-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const result = $("#form-result"); const file = form.get("evidence"); const hasFile = file && file.size > 0; form.append("deviceId", deviceId); try { let body; if (hasFile) { body = form; } else { body = JSON.stringify({ sourceUrl: form.get("sourceUrl"), rawText: "", inputType: "TEXT", deviceId, appliedAt: form.get("appliedAt"), repostedAt: form.get("repostedAt"), cvViewedStatus: form.get("cvViewedStatus") }); } const data = await api("/api/submissions", { method: "POST", body }); result.classList.remove("hidden"); result.style.background = "#edf8e8"; result.style.color = "#527c58"; result.innerHTML = `<strong>OCR tamamlandı</strong><br>${data.applicationInsight?.label || "Başvuru hareketi kaydedildi"}: ${data.applicationInsight?.detail || "Kayıt havuza eklendi."}`; await loadListings(); await loadRecent(); state.selectedId = data.listing.id; await renderDetail(data.listing.id); showToast("Başvuru kanıtı son eklenenlere eklendi."); setTimeout(closeSubmit, 1800); } catch (error) { result.classList.remove("hidden"); result.style.background = "#fff0ed"; result.style.color = "#a15747"; result.textContent = error.message; } });

window.addEventListener("hashchange", () => { if (location.hash.startsWith("#company=")) openCompany(decodeURIComponent(location.hash.slice(9))).catch(showReadError); });
setupSectorFilter();
setupNavigation();
loadInitialData();
