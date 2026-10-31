# CV ghostlayanlar

Başvuru sonrası iş ilanı hareketlerini ve yeniden yayınlanma sinyallerini izleyen ilk çalıştırılabilir dikey dilim.

## Çalıştırma

Node.js 18 veya üzeri yeterlidir:

```text
npm start
```

Ardından `http://localhost:3000` adresini açın.

## Bu sürümde çalışan akışlar

- İlanları arama ve çalışma modeline göre filtreleme
- İlan detayını ve değişiklik timeline'ını görüntüleme
- PNG, JPG ve WEBP ilan görsellerinden Türkçe/İngilizce OCR ile metin çıkarma
- OCR veya manuel metin gönderiminden temel alanları çıkarma
- Linki eşleştirme sinyali olarak kullanmadan deterministic/heuristic benzer ilan eşleştirme
- Başvuru tarihi, yeniden yayınlanma tarihi ve CV görüntülenme durumunu kaydetme
- “Aday havuzu sinyali” üretme
- Son eklenenler ve bu cihazdan eklenen kayıtları listeleme
- Açıklanabilir eşleşme sonucu ve skor üretme
- Topluluk doğrulaması ekleme
- Yeni ilan sürümü ve değişiklik olayı oluşturma
- Topluluk istatistiklerini görüntüleme
- JSON tabanlı yerel geliştirme verisi

## Mimari not

Bu ilk dikey dilim harici bağımlılık kullanmadan Node.js yerleşik HTTP sunucusuyla çalışır. `src/domain.js` içindeki domain fonksiyonları Prisma/PostgreSQL katmanına taşınabilecek şekilde ayrıştırılmıştır. `server.js` içindeki `data/store.json` yalnızca yerel demo/pilot içindir; üretim öncesinde PostgreSQL, Prisma migration'ları, object storage, gerçek job kuyruğu ve OCR sağlayıcısı eklenmelidir.

Görsel OCR akışı `POST /api/submissions` multipart isteği üzerinden çalışır. İlk sürüm PNG, JPG ve WEBP görsellerini Türkçe+İngilizce Tesseract worker ile işler. Başvuru ekran görüntüsü kanıt olarak yerel `data/evidence` klasörüne kaydedilir. Eşleştirme URL’ye değil OCR içeriğine dayanır. PDF OCR ve üretim object storage yaşam döngüsü sonraki dilimde eklenmelidir.

## Kontroller

```text
npm test
npm run check
```

İlk çalıştırmada `data/store.json` otomatik oluşturulur. Bu dosya yerel demo verisini içerir.

## Üretim ve reklamlar

Vercel'de `DATABASE_URL` kalıcı PostgreSQL veritabanını göstermelidir. Supabase projesi duraklatılırsa panelden Resume ile geri alınır. Bağlantı hatasından sonra sunucu sonraki istekte yeniden dener; veriler yerine demo kayıtlar döndürülmez. `/api/readiness` veritabanına gerçek bir sorgu yapar ve bağlantı yoksa 503 döndürür. `/api/health` yalnızca HTTP sunucusunun çalıştığını belirtir.

Yeni üretim arşivleri boş başlar. Üç eski geliştirme örneği herkese açık ilan, şirket ve istatistik sonuçlarından hariç tutulur; depodaki kayıtlar ve yerel OCR denemeleri silinmez veya otomatik taşınmaz. Gerçek kayıtlar görsel yükleme ve kullanıcı onayı akışıyla eklenir.

AdSense sahiplik doğrulaması `PUBLIC_ADSENSE_CLIENT` ile oluşturulan meta etiketi ve `/ads.txt` üzerinden yapılır. AdSense panelinde otomatik reklamlar kapalı kalmalıdır. `PUBLIC_ADSENSE_SLOT` boşken reklam betiği hiç yüklenmez. Onaylı bir manuel görüntülü reklam birimi tanımlandığında reklam yalnızca başarıyla yüklenmiş, ilan içeren keşif görünümünde istenir; boş sonuçlarda, hata/yüklenme durumlarında ve kanıt ekleme penceresinde gizlenir. Otomatik reklamları açmak bu sayfa kontrolünü geçersiz kılar.
