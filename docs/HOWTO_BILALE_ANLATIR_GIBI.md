---
pdf_options:
  format: A4
  margin:
    top: 20mm
    bottom: 20mm
    left: 20mm
    right: 20mm
  displayHeaderFooter: true
  headerTemplate: '<div style="font-size: 1px;"></div>'
  footerTemplate: '<div style="font-size: 9px; font-family: Arial, sans-serif; width: 100%; text-align: right; padding-right: 20mm; color: #555555;"><strong>Kurt Adam Murat''a Özel Etsy Kılavuzu</strong></div>'
---

# Murat'a ("Kurt Adam'a") Anlatır Gibi: Lokal Yapay Zeka ile Etsy Rehberi

Muratçım, Kurt Adam kardeşim selamlar... 

Öncelikle şu konuda bir anlaşalım: Bu kuruluma başlamadan önce elindeki kadehi usulca masaya bırak. Şarabı fazla kaçırdıysan ya da hele hele o Rus vodkasına bulaştıysan (aman haaa!), bu kılavuzu hemen kapat, git uyu ve yarın sabah ayık kafayla aç. Yanlış yere tıklar, sonra "Kanka ekran mavi oldu" diye beni ararsın, hiç çekemem!


---

## 1. Büyük Resim: Olayımız Ne?

Bak güzel kardeşim, aylardır ChatGPT'ye ayrı para, Midjourney'e ayrı para, Canva'ya ayrı para bayılıp duruyorsun. Ay sonunda kredi kartı ekstresini görünce moralin bozuluyor, sonra gidip efkardan yine şişeye sarılıyorsun. Buna artık bir son veriyoruz.

Senin kasanın içindeki NVIDIA RTX ekran kartına 3 tane dijital amele (ajan) bağlayacağız:

- **1. Ajan (Yazı ve SEO Canavarı):** Çinlinin bozuk İngilizcesini alacak; Etsy'nin arama motoruna cuk oturan 140 harflik başlık, tam 13 etiket ve roman gibi ikna edici açıklama yazacak.
- **2. Ajan (Fotoğraf ve Mockup Ustası):** Fotoğraftaki Çince yazıları ve fabrika logolarını fırçayla siler gibi silecek, arkadaki çirkin fonu temizleyip lüks stüdyo masasına koyacak.
- **3. Ajan (Etsy Yayıncısı):** Hazırlanan her şeyi tek tıkla kopyalanacak hale getirecek ya da Printify üzerinden doğrudan Etsy mağazana taslak olarak fırlatacak.

**Maliyet:** Sıfır TL. Bana ismaryacagin BIRA'lari haric tutarim.  
**Aylık Abonelik:** Yok. BIRA demis miydim?
**Hız:** Işık hızı (RTX ekran kartın sağ olsun).

---

## 2. Adım 0: Ekran Kartını Kontrol Et (Oyunu Kapat, Vodkayı Bırak)

Kurt Adam, kuruluma geçmeden önce arkada açık bıraktığın Call of Duty'yi ya da Dota'yı bir zahmet kapat. Ekran kartının nefes alması lazım.

1. Klavyeden `Ctrl + Shift + Esc` yap, **Görev Yöneticisi** açılsın.
2. Sol menüden **Performans** sekmesine tıkla.
3. En alttaki **GPU (NVIDIA GeForce RTX ...)** yazısına tıkla.
4. Sağ altta **Ayrılmış GPU Belleği (Dedicated GPU Memory)** yazar:
   - **6 GB VRAM varsa:** İdare eder, şarabı dökmeden usulca ilerle.
   - **8 GB VRAM varsa:** Fıstık gibi! Standart kurulum, modelimiz yağ gibi kayar.
   - **12 GB veya 16 GB VRAM varsa:** Canavarsın Kurt Adam! Aynı anda hem resim çizer hem metin yazar, bana mısın demez.

*Küçük bir tüyo:* NVIDIA GeForce Experience veya NVIDIA App uygulamasını açıp sürücülerini bir güncelle. Güncel sürücü olmadan yapay zeka çalıştırmak, bozuk rot balansla otobana çıkmaya benzer Muratçım.

---

## 3. Adım 1: Yazı ve SEO Beynini Kuruyoruz (Ollama)
*(Süre: 3 Dakika - Tek Satır Kod Yok!)*

Şimdi bilgisayarına kendi yerel ChatGPT'ni kuruyoruz. Bak dikkatli oku, çok basit:

1. Tarayıcını aç, `ollama.com/download/windows` adresine gir.
2. Kocaman **"Download for Windows"** butonuna bas.
3. İnen `OllamaSetup.exe` dosyasına çift tıkla, "Next Next" de bitir. Sağ altta saatin yanında küçük beyaz bir lama simgesi belirecek.
4. Şimdi klavyeden `Windows Tuşu + R` yap, çıkan kutucuğa `cmd` yaz ve Enter'a bas (Siyah pencere açılacak, korkma hacker olmadın).
5. Şu komutu oraya yapıştır ve Enter'a bas:
   ```bash
   ollama run qwen2.5:7b
   ```
6. Model inmeye başlayacak (yaklaşık 4.7 GB). İnene kadar git kendine bir çay koy (votka değil, çay!).
7. *Neden Qwen 2.5 7B seçtik?* Çünkü Alibaba yaptı bunu. Çinlilerin AliExpress'teki o saçma sapan İngilizce ürün başlıklarını dünyada bu modelden daha iyi anlayan yok! Hem de harika İngilizce SEO ve akıcı Türkçe yazar.
8. Yazılar akmayı bitirip ekranda `>>> Send a message` yazınca model kurulmuş demektir. Pencereyi kapatabilirsin, arkada tıkır tıkır çalışır.

---

## 4. Adım 2: Görsel ve Çizim Stüdyosu (Fooocus - Kod Mod Yok!)
*(Süre: 5 Dakika - Midjourney'e Elveda)*

Şimdi geldik en seveceğin bölüme. Resim çizen, Çince yazıları silen ve tişört mockup'ı giydiren programı kuruyoruz:

1. `github.com/lllyasviel/Fooocus` adresine git.
2. Sayfada biraz aşağı in, **">>> Click Here to Download <<<"** yazısına tıkla. Hazır ZIP dosyası inecek.
3. İnen zip dosyasını Masaüstüne çıkart.
4. Klasörün içine gir, orada `run.bat` diye bir dosya göreceksin. Çift tıkla ona!
5. İlk açılışta modelleri otomatik indirir, biraz bekle. Bittiğinde tarayıcında `http://127.0.0.1:7865` adresinde stüdyo açılacak.
6. **Çin Ürünündeki Yazıları Silme Hilesi:**
   - Sayfanın altındaki **Input Image** kutucuğunu işaretle.
   - **Inpaint or Outpaint** sekmesine tıkla.
   - AliExpress'ten aldığın resmi oraya sürükle.
   - Üzerindeki Çince yazıyı veya fabrika logosunu fareyle fırça gibi boya.
   - "Generate" butonuna bas. Yapay zeka yazıyı yok edip altındaki deseni kusursuz tamamlar!

---

## 5. Adım 3: İki Dakikada Yönetim Paneli (AnythingLLM)

Kurt Adam, bütün bunları birleştirecek, one ring to bind them all in the darkness..:) .

1. `useanything.com/download` adresinden Windows için programı indir ve kur.
2. Programı aç. Sol alttaki **Ayarlar (Dişli çark) -> LLM Provider** kısmına gel.
3. Listeden **Ollama** seçeneğini tıkla. Model kutusundan `qwen2.5:7b`'yi seç ve "Save" de.
4. Sol menüden yeni bir çalışma alanı (Workspace) aç, adına `Etsy Canavarı` yaz.
5. Çalışma alanı ayarlarına gir, "System Prompt" kısmına sana klasörde verdiğim `prompts/agent1_dropship_seo.md` dosyasındaki metni kopyala-yapıştır yap.
6. **İşte bu kadar!** Artık Çin sitesindeki ürünün linkini veya açıklamasını buraya atacaksın; o sana saniyeler içinde başlığı, 13 etiketi ve açıklamayı dökecek.

---

## 6. Canlı Örnek 1: Dropshipping (Çin'den Alıp Etsy'ye Çakma)

AliExpress'te bir ahşap takı kutusu buldun diyelim Murat. Çinli satıcı başlığa ne yazmış?  
`"2024 New hot selling solid wood jewelry box ring necklace storage case China factory supplier"`

Bunu alıp AnythingLLM'e yapıştırdın. Bak Ajan 1 sana ne veriyor:

- **Etsy Başlığı (126 Karakter - 140 sınırını asla aşmaz):**  
  `Vintage Wooden Jewelry Box, Handcrafted Keepsake Organizer, Rustic Ring and Necklace Storage Case, Boho Gift for Her`
- **Tam 13 Adet Etiket (Her biri 20 karakterin altında!):**  
  `wooden jewelry box`, `keepsake organizer`, `ring storage case`, `necklace holder`, `rustic home decor`, `boho gift for her`, `handcrafted box`, `vintage jewelry box`, `bridesmaid gift`, `anniversary present`, `wood memory box`, `trinket box`, `tabletop organizer`
- **Açıklama:** Kutu malzemesi, iç kadife kaplama, ölçüler ve hediye paketi notuyla alıcıyı ikna eden harika bir İngilizce metin.
- **Ajan 2 (Fooocus):** Fotoğraftaki Çince logoyu sildi, kutuyu şık bir mermer sehpanın üstüne koydu (2000x2000 px).
- **Ajan 3:** Başlığı, etiketleri ve resmi Etsy paneline yüklemen için hazır hale getirdi.

### Etsy'nin Kırmızı Çizgileri (Aklında Tut!):
1. **Başlık:** En fazla 140 karakter! 1 harf bile geçmeyeceksin.
2. **Etiketler:** İstisnasız tam 13 adet olacak. 12 tane yapma, 14 yapma, tam 13! Ve her biri en fazla 20 karakter olacak.
3. **Görsel:** En az 2000x2000 piksel ve üzerinde tek bir Çince harf olmayacak.

---

## 7. Canlı Örnek 2: Print on Demand (Tişört ve Kupa Tasarımı)

Şimdi geldik en keyifli işe Kurt Adam. Tişört veya kupa basıp satacaksın:

1. Aklına bir fikir geldi: *"Retro 90'lar tarzında kahve içen sevimli kedi."*
2. Fooocus'u açtın, prompt kutusuna şunu yapıştırdın:
   ```
   cute ginger cat drinking hot coffee, 90s vintage anime aesthetic, retro t-shirt graphic, bold linework, vibrant pastel colors, isolated on solid white background
   ```
3. "Generate" dedin. 15 saniyede 4K kalitesinde baskıya hazır desen çıktı!
4. AnythingLLM'deki Ajan 2'ye tasarımı söyledin; o sana anında başlığı hazırladı:  
   `Retro Coffee Cat Graphic T-Shirt, 90s Vintage Aesthetic Kitty Tee, Cute Animal Lover Gift, Cozy Comfort Colors Shirt`
5. [Printify.com](https://printify.com)'a girdin (ücretsizdir), tişört modelini seçtin, deseni göğsüne koydun.
6. **"Publish to Etsy"** butonuna bastın; ürün 10 saniye sonra Etsy mağazanda satışta!

---

## 8. Etsy Güvenliği: Banlanıp Dımdızlak Kalmama Rehberi

Bak burayı sarhoş kafayla okuma Murat, çok ciddiyim. Etsy şakaya gelmez: Semsiye acilmiyor netekim. Gerci sende acilir bence de tam emin olmadim.

Bu agent'lar basi bos birakmaya gelmez. Arada kontrol et. Goz ucuyla bak. Ilgilen onlarla. Elektrigini, suyunu eksik etme. Bir sorun olursa fisi elinde tut ki hizlica cekebilesin. hahaha 

---

## 9. Kafan Karışırsa / Sorun Çıkarsa Ne Yapacaksın? En Son Kelimeyi OKU! :) 

- **Ollama "Out of Memory" dedi:** Ekran kartının belleği doldu demektir. `cmd` ekranında `ollama run qwen2.5:3b` yaz, daha hafif 3B modele geç.
- **Fooocus kaplumbağa gibi yavaş:** Arkada Cyberpunk veya oyun açık kaldı demektir. Oyunu kapat! GPU sadece Fooocus'a çalışsın.
- **Ollama yanıt vermiyor:** Başlat menüsünden Ollama'yı tekrar tıkla, simgesi saatin yanına gelsin.
- **Etiket 20 harfi geçmiş:** Modele "Kardeşim en fazla 20 karakter dedik, kısalt şunu" de, anında düzeltir.

---

### Son Söz:
Muratçım; donanımın sağlam, araçların hazır, kılavuzun elinde. Aylık aboneliklere havaya para saçmayı bırak, şu sistemi kur ve Etsy'de satışlara başla. 

Takıldığın bir yer olursa Rus vodkasına sarılmadan önce ara beni! Yok lan arama... Arama... Arama... :) 
