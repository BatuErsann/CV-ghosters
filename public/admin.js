const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const formatDate = (value) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

function showLoginError(message) {
  $("#login-error").textContent = message;
  $("#login-error").classList.remove("hidden");
}

function showAdminApp() {
  $("#login-panel").classList.add("hidden");
  $("#admin-app").classList.remove("hidden");
  loadAdminListings().catch((error) => { $("#admin-list").innerHTML = `<div class="empty error">${escapeHtml(error.message)}</div>`; });
}

async function loadAdminListings() {
  const response = await fetch("/api/admin/listings");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Admin verileri yüklenemedi.");
  $("#admin-summary").innerHTML = `<div><strong>${data.items.length}</strong><span>toplam ilan</span></div><div><strong>${data.reportCount}</strong><span>açık rapor</span></div><div><strong>${data.items.filter((item) => item.evidenceCount > 0).length}</strong><span>kanıtlı ilan</span></div>`;
  $("#admin-list").innerHTML = data.items.length ? data.items.map((item) => `<article class="admin-row"><div class="admin-row-main"><div class="admin-row-top"><span class="status ${item.status === "ACTIVE" ? "active" : "review"}">${item.status === "ACTIVE" ? "Aktif" : "İnceleme"}</span><small>Son görülme: ${formatDate(item.lastSeenAt)}</small></div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.company)} · ${escapeHtml(item.location)}</p><div class="admin-meta"><span>${item.versionCount} sürüm</span><span>${item.submissionCount} gönderim</span><span>${item.evidenceCount} kanıt</span><span class="${item.reportCount ? "has-reports" : ""}">${item.reportCount} rapor</span></div>${item.reports.length ? `<div class="report-list">${item.reports.map((report) => `<span>⚑ ${escapeHtml(report.reason)}</span>`).join("")}</div>` : ""}</div><button class="delete-button" data-id="${item.id}">İlanı sil</button></article>`).join("") : `<div class="empty">İlan bulunmuyor.</div>`;
  document.querySelectorAll(".delete-button").forEach((button) => button.addEventListener("click", () => deleteListing(button.dataset.id)));
}

async function deleteListing(id) {
  if (!window.confirm("Bu ilanı, bağlı gönderimleri ve raporlarını silmek istediğinize emin misiniz?")) return;
  const response = await fetch(`/api/admin/listings/${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "İlan silinemedi.");
  await loadAdminListings();
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Giriş başarısız.");
    window.adminChallenge = data.challengeToken;
    $("#login-form").classList.add("hidden");
    $("#twofa-form").classList.remove("hidden");
    $("#twofa-form input").focus();
  } catch (error) { showLoginError(error.message); }
});

$("#twofa-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const response = await fetch("/api/admin/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken: window.adminChallenge, code: form.get("code") }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "2FA doğrulaması başarısız.");
    showAdminApp();
  } catch (error) { showLoginError(error.message); }
});

$("#logout-button").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.reload();
});

(async function init() {
  try {
    const response = await fetch("/api/admin/session");
    if (response.ok) showAdminApp();
  } catch { /* giriş ekranı gösterilir */ }
})();
