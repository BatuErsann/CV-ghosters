(() => {
  const form = document.querySelector("#submit-form");
  const manualForm = document.querySelector("#manual-form");
  const result = document.querySelector("#form-result");
  const fallback = document.querySelector("#manual-fallback");
  const confirmation = document.querySelector("#confirmation-panel");
  const confirmationDetails = document.querySelector("#confirmation-details");
  const submitButton = form?.querySelector("button[type=submit]");
  const confirmButton = document.querySelector("#confirm-submission");
  const deviceId = localStorage.getItem("ilaniz-device-id") || "device-local";
  let pendingPreview = null;

  function setProcessing(isProcessing, label = "OCR analiz ediliyor...") {
    if (!submitButton) return;
    submitButton.disabled = isProcessing;
    submitButton.innerHTML = isProcessing ? `<span class="loading-spinner"></span>${label}` : `OCR ile analiz et <span>→</span>`;
  }

  function showResult(message, tone) {
    result.classList.remove("hidden");
    result.style.background = tone === "error" ? "#fff0ed" : tone === "warning" ? "#fff7e8" : "#edf8e8";
    result.style.color = tone === "error" ? "#a15747" : tone === "warning" ? "#936b2e" : "#527c58";
    result.innerHTML = message;
  }

  function showPreview(data) {
    pendingPreview = data;
    setProcessing(false);
    form.classList.add("hidden");
    fallback.classList.add("hidden");
    confirmation.classList.remove("hidden");
    const item = data.preview;
    confirmationDetails.innerHTML = `<div><span>Pozisyon</span><strong>${item.title || "—"}</strong></div><div><span>Şirket</span><strong>${item.company || "—"}</strong></div><div><span>Lokasyon</span><strong>${item.location || "—"}</strong></div><div><span>Çalışma modeli</span><strong>${item.workMode || "—"}</strong></div><div><span>CV durumu</span><strong>${document.querySelector('[name="cvViewedStatus"]').selectedOptions[0].textContent}</strong></div><div class="confirmation-signal"><span>Son durum</span><strong>${data.applicationInsight?.label || "Takipte"}</strong><small>${data.applicationInsight?.detail || "Başvuru hareketi izleniyor."}</small></div>`;
    showResult("<strong>OCR tamamlandı.</strong><br>Kaydetmeden önce son durumu kontrol edin.", "warning");
  }

  async function confirmPreview() {
    if (!pendingPreview) return;
    const cvViewedStatus = document.querySelector('[name="cvViewedStatus"]').value;
    if (confirmButton) { confirmButton.disabled = true; confirmButton.innerHTML = `<span class="loading-spinner"></span> Kaydediliyor...`; }
    try {
      const response = await api(`/api/submissions/${pendingPreview.previewToken}/confirm`, { method: "POST", body: JSON.stringify({ deviceId, cvViewedStatus }) });
      confirmation.classList.add("hidden");
      await finish(response, "Kayıt onaylandı");
    } catch (error) {
      if (confirmButton) { confirmButton.disabled = false; confirmButton.innerHTML = `Durumu onayla <span>→</span>`; }
      showResult(error.message, "error");
    }
  }

  async function finish(data, successMessage) {
    showResult(`<strong>${successMessage}</strong><br>${data.applicationInsight?.detail || "Başvuru kanıtı kaydedildi."}`, "success");
    await loadListings();
    await loadRecent();
    await selectListing(data.listing.id);
    showToast("Son durum son eklenenlere eklendi.");
    setTimeout(closeSubmit, 1800);
  }

  function showFallback(error) {
    setProcessing(false);
    fallback.classList.remove("hidden");
    confirmation.classList.add("hidden");
    const missing = error.payload?.error?.missingFields || [];
    document.querySelector("#fallback-message").textContent = `Eksik alanlar: ${missing.join(", ")}. Alanları doldurun; kaynak linkiyle kontrol edeceğiz.`;
    showResult("<strong>OCR bazı alanları okuyamadı.</strong><br>Eksik alanları tamamlayıp kaynak linkiyle doğrulayın.", "warning");
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const data = new FormData(form);
    data.append("deviceId", deviceId);
    setProcessing(true);
    result.classList.add("hidden");
    try {
      const response = await api("/api/submissions", { method: "POST", body: data });
      showPreview(response);
    } catch (error) {
      setProcessing(false);
      if (error.payload?.error?.code === "OCR_INCOMPLETE") return showFallback(error);
      showResult(error.message, "error");
    }
  }, true);

  manualForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const sourceForm = new FormData(form);
    const manual = new FormData(manualForm);
    sourceForm.append("deviceId", deviceId);
    for (const [key, value] of manual.entries()) sourceForm.append(key, value);
    if (!sourceForm.get("sourceUrl")) return showResult("OCR başarısız olduğu için doğrulama linki gerekli.", "error");
    try {
      const response = await api("/api/submissions", { method: "POST", body: sourceForm });
      showPreview(response);
    } catch (error) {
      showResult(error.message, "error");
    }
  }, true);

  document.querySelector("#confirm-submission")?.addEventListener("click", confirmPreview);
  document.querySelector("#cancel-confirmation")?.addEventListener("click", () => { confirmation.classList.add("hidden"); form.classList.remove("hidden"); showResult("Düzenlemek için form açık bırakıldı.", "warning"); });

  ["#open-submit", "#sidebar-submit"].forEach((selector) => document.querySelector(selector)?.addEventListener("click", () => {
    fallback.classList.add("hidden");
    confirmation.classList.add("hidden");
    form.classList.remove("hidden");
    setProcessing(false);
    result.classList.add("hidden");
    manualForm?.reset();
    pendingPreview = null;
  }, true));
})();
