const { createWorker } = require("tesseract.js");
const sharp = require("sharp");

let workerPromise;

async function getWorker() {
  if (!workerPromise) workerPromise = createWorker("tur+eng");
  return workerPromise;
}

async function recognizeImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("OCR için geçerli bir görsel bulunamadı.");
  try {
    const worker = await getWorker();
    const variants = await buildImageVariants(buffer);
    const results = [];
    for (const variant of variants) {
      for (const pageMode of ["6", "11"]) {
        await worker.setParameters({ tessedit_pageseg_mode: pageMode, preserve_interword_spaces: "1" });
        const result = await worker.recognize(variant);
        const text = result?.data?.text?.replace(/\r/g, "").trim() || "";
        results.push({ text, score: scoreText(text) });
      }
    }
    const best = results.sort((left, right) => right.score - left.score)[0];
    if (!best?.text || best.text.length < 10) throw new Error("Görselden yeterli metin çıkarılamadı.");
    return best.text;
  } catch (error) {
    workerPromise = null;
    throw error;
  }
}

async function buildImageVariants(buffer) {
  const metadata = await sharp(buffer).metadata();
  const width = Math.min(Math.max(metadata.width || 1200, 1200) * 2, 3600);
  const base = sharp(buffer).resize({ width, withoutEnlargement: false }).grayscale().normalize().sharpen();
  return [
    await base.clone().png().toBuffer(),
    await base.clone().negate().png().toBuffer(),
    await base.clone().negate().threshold(170).png().toBuffer()
  ];
}

function scoreText(text) {
  const normalized = text.toLocaleLowerCase("tr-TR");
  const usefulTerms = ["solutions", "engineer", "istanbul", "applicants", "application", "submitted", "freya", "full-time", "on-site"];
  const termScore = usefulTerms.reduce((score, term) => score + (normalized.includes(term) ? 30 : 0), 0);
  const readableChars = (text.match(/[a-zçğıöşü0-9]/gi) || []).length;
  return Math.min(text.length, 1000) + termScore + readableChars * 0.2;
}

async function closeOcrWorker() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

module.exports = { recognizeImage, closeOcrWorker };
