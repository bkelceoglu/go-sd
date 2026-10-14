# 🛍️ Agentic Etsy (Lokal & Açık Kaynaklı Çok Ajanlı Otomasyon)

Bu proje, Etsy satıcılarının aylık yüzlerce dolar ödedikleri yapay zeka araçlarını (ChatGPT, Midjourney vb.) kendi **Windows RTX ekran kartlı masaüstü bilgisayarlarında**, **tamamen ücretsiz, sınırsız ve açık kaynaklı hazır araçlarla** çalıştırmalarını sağlar.

---

## 🎯 Ne İşe Yarar?
1. **Dropshipping İş Akışı:**
   - **Ajan 1:** Çin tedarikçi verisini (1688, AliExpress vb.) okur; Etsy SEO uyumlu 140 karakterlik başlık, tam 13 adet etiket ve satış odaklı açıklama yazar.
   - **Ajan 2:** Ürün fotoğraflarındaki Çince yazıları ve filigranları siler, arka planı temizler, estetik stüdyo fonuna oturtur (2000x2000 piksel).
   - **Ajan 3:** Etsy'ye yükleme taslağı ve toplu CSV dosyası hazırlar.

2. **Print on Demand (POD) İş Akışı:**
   - **Ajan 1:** Fikri alır, Midjourney kalitesinde tişört/kupa/poster deseni üretir (Fooocus).
   - **Ajan 2:** Tasarım için Etsy SEO başlığı, 13 etiket, beden rehberi ve kumaş detaylarını yazar.
   - **Ajan 3:** Printify / Etsy üzerinden güvenle yayına alır.

---

## 🚀 Hızlı Başlangıç & Kurulum Rehberi
Sıfırdan, tek satır kod yazmadan Windows üzerinde kurmak için hazırlanan kılavuzlar:
- 📕 **Arkadaşınıza Gönderebileceğiniz PDF:** [HOWTO_BILALE_ANLATIR_GIBI.pdf](file:///home/caveman/codes/agentic_etsy/HOWTO_BILALE_ANLATIR_GIBI.pdf) *(Kopya: [bilale_anlatir_gibi.pdf](file:///home/caveman/codes/agentic_etsy/bilale_anlatir_gibi.pdf))*
- 📖 **Markdown Kılavuz:** [HOWTO_BILALE_ANLATIR_GIBI.md](file:///home/caveman/codes/agentic_etsy/HOWTO_BILALE_ANLATIR_GIBI.md)

---

## 📂 Dizin Yapısı
- 📖 [HOWTO_BILALE_ANLATIR_GIBI.md](file:///home/caveman/codes/agentic_etsy/HOWTO_BILALE_ANLATIR_GIBI.md) - Adım adım resimli/detaylı Windows kurulum ve kullanım rehberi.
- 📋 [prompts/](file:///home/caveman/codes/agentic_etsy/prompts/)
  - [agent1_dropship_seo.md](file:///home/caveman/codes/agentic_etsy/prompts/agent1_dropship_seo.md) - Dropship SEO ve Metin Ajanı Sistem Promptu
  - [agent2_dropship_visual.md](file:///home/caveman/codes/agentic_etsy/prompts/agent2_dropship_visual.md) - Görsel Temizleme ve Mockup Ajanı Yönergesi
  - [agent1_pod_designer.md](file:///home/caveman/codes/agentic_etsy/prompts/agent1_pod_designer.md) - POD Görsel ve Desen Tasarım Ajanı Promptu
  - [agent2_pod_seo.md](file:///home/caveman/codes/agentic_etsy/prompts/agent2_pod_seo.md) - POD SEO ve Açıklama Yazarı Promptu
  - [agent3_etsy_publisher.md](file:///home/caveman/codes/agentic_etsy/prompts/agent3_etsy_publisher.md) - Etsy Yayınlama ve Hesap Güvenliği Rehberi
- 🔄 [workflows/](file:///home/caveman/codes/agentic_etsy/workflows/)
  - [dropship_workflow.json](file:///home/caveman/codes/agentic_etsy/workflows/dropship_workflow.json) - n8n hazır içe aktarılabilir Dropshipping iş akışı
  - [pod_workflow.json](file:///home/caveman/codes/agentic_etsy/workflows/pod_workflow.json) - n8n hazır içe aktarılabilir POD iş akışı
- 📊 [templates/](file:///home/caveman/codes/agentic_etsy/templates/)
  - [etsy_listing_template.csv](file:///home/caveman/codes/agentic_etsy/templates/etsy_listing_template.csv) - Etsy Toplu Ürün Yükleme CSV Formatı
