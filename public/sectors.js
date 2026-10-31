(function (root, factory) {
  const catalog = factory();
  if (typeof module === "object" && module.exports) module.exports = catalog;
  else root.SectorCatalog = catalog;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const sectors = [
    { id: "SOFTWARE", label: "Yazılım ve Teknoloji" },
    { id: "DESIGN", label: "Tasarım ve Kreatif" },
    { id: "DATA", label: "Veri ve Analitik" },
    { id: "MARKETING", label: "Pazarlama ve İletişim" },
    { id: "SALES", label: "Satış ve İş Geliştirme" },
    { id: "FINANCE", label: "Finans ve Muhasebe" },
    { id: "HR", label: "İnsan Kaynakları" },
    { id: "ENGINEERING", label: "Mühendislik ve Üretim" },
    { id: "OPERATIONS", label: "Operasyon ve Lojistik" },
    { id: "HEALTH", label: "Sağlık" },
    { id: "EDUCATION", label: "Eğitim" },
    { id: "OTHER", label: "Diğer" }
  ];
  const isSector = (value) => sectors.some((sector) => sector.id === value);
  const label = (value) => sectors.find((sector) => sector.id === value)?.label || "Tüm sektörler";
  const normalize = (value) => String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
  function classifySector(record) {
    if (isSector(record.sector)) return record.sector;
    // Classify the role, not the employer's industry or unrelated skills in the
    // description. A designer at a software company still belongs to Design.
    const title = normalize(record.title);
    if (/\b(data|analytics|analitik|veri|business intelligence|bi developer)\b/.test(title)) return "DATA";
    if (/design|tasarim|grafik|graphic|\b(ui|ux|illustrator|animator|art director|creative|kreatif)\b/.test(title)) return "DESIGN";
    if (/yazilim|gelistirici|developer|software|frontend|front.end|backend|back.end|full.stack|devops|siber|cyber|\b(qa|test engineer|yapay zeka|ai|ml|machine learning|sre|it|bilisim|bilgisayar)\b/.test(title)) return "SOFTWARE";
    if (/marketing|pazarlama|iletisim|reklam|\b(seo|content|icerik|social media|sosyal medya|brand)\b/.test(title)) return "MARKETING";
    if (/sales|satis|is gelistirme|business development|account executive|musteri temsilci/.test(title)) return "SALES";
    if (/finance|finans|muhasebe|accountant|accounting|audit|denetim|bankaci/.test(title)) return "FINANCE";
    if (/insan kaynak|human resources|recruit|ise alim|talent|\bhr\b/.test(title)) return "HR";
    if (/doktor|doctor|hemsire|nurse|saglik|medical|eczaci|pharma/.test(title)) return "HEALTH";
    if (/ogretmen|teacher|egitim|instructor|trainer|akademisyen/.test(title)) return "EDUCATION";
    if (/operasyon|operations|lojistik|logistics|tedarik|supply chain|warehouse|depo/.test(title)) return "OPERATIONS";
    if (/muhendis|engineer|uretim|manufacturing|tekniker|teknisyen|mimar|architect/.test(title)) return "ENGINEERING";
    return "OTHER";
  }
  return { sectors, isSector, label, classifySector };
});
