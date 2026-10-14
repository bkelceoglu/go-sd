# GoCV CUDA, Go AI Ekosistemi ve Intel Arc / OpenVINO Mimarisi Araştırma Raporu

**Tarih:** 14 Ekim 2026  
**Proje:** `go-sd` (Go tabanlı Yüksek Başarımlı AI Görsel Üretim ve Stüdyo Platformu)  
**Donanım Platformu:** Intel Core™ Ultra 9 288V (Lunar Lake)  
- **GPU:** Intel(R) Arc(TM) Graphics (Xe2 iGPU - XMX Matris Hızlandırıcılar)  
- **NPU:** Intel(R) AI Boost (40+ TOPS Bağımsız Sinir İşlem Birimi)  
- **CPU:** Intel(R) Core(TM) Ultra 9 288V  
**Kurulu Altyapı:** OpenVINO 2026.1.0, OpenVINO GenAI 2026.1.0, `/lib/libopenvino_c.so`

---

## 1. Yönetici Özeti (Executive Summary)

Bu araştırma, Go dilinde OpenCV CUDA modüllerini sarmalayan `gocv.io/x/gocv/cuda` paketinin derin öğrenme (Deep Learning) ve üretken yapay zeka (Generative AI - Stable Diffusion / SDXL) alanındaki uygulanabilirliğini, donanım gereksinimlerini ve sistemimizdeki **Intel Arc + NPU** mimarisine uygun **OpenVINO** çözümlerini incelemektedir.

### Temel Bulgular:
1. **Stable Diffusion / SDXL İçin GoCV CUDA:** **Kullanılamaz**. OpenCV DNN modülü, çok bileşenli iteratif difüzyon mimarilerini (Dual CLIP, Cross-Attention UNet/DiT, latent schedulers, VAE) desteklemez.
2. **Intel Arc (XPU) Uyumluluğu:** `gocv/cuda` paketi doğrudan **çalışmaz**. Çünkü tescilli NVIDIA CUDA sürücüsüne (`libcudart.so`) bağımlıdır.
3. **Intel Donanımları İçin Doğru Çözüm (OpenVINO):** Sistemimizde hazır bulunan **Intel OpenVINO 2026.1** ve **OpenVINO GenAI**, Intel Arc GPU (XMX) ve Intel AI Boost NPU'yu doğrudan donanım seviyesinde destekler.
4. **Go Entegrasyonu:** `/lib/libopenvino_c.so` sayesinde saf CGo ile sıfır Python bağımlılığıyla veya `onnxruntime_go` (OpenVINO Execution Provider) ile ultra hafif çıkarım mimarileri kurulabilir.

---

## 2. GoCV CUDA (`gocv.io/x/gocv/cuda`) Mimarisi ve Sınırları

GoCV, OpenCV 4.x C++ API'sini CGo köprüleri üzerinden Go'ya taşır:
* **Bellek Yönetimi:** `cuda.GpuMat` veri yapısı, pikselleri doğrudan GPU VRAM'inde tutar.
* **DNN Sınırları:** OpenCV DNN tek yönlü (feed-forward) konvolüsyonel ağlar (YOLO, ResNet, OCR) için tasarlanmıştır.

### Stable Diffusion Neden OpenCV DNN ile Çalışmaz?
Difüzyon modelleri tek bir tensör grafiği değildir:
1. **Dual CLIP:** Metinleri anlamsal uzaya gömer (Transformer mimarisi).
2. **Latent UNet / DiT:** 20-50 adımlık zaman döngüsünde (timestep) Cross-Attention ile gürültü tahmin eder.
3. **Schedulers:** Euler A, DPM++ gibi dinamik diferansiyel denklem çözücüleridir.
4. **VAE Decoder:** Latent uzaydan piksel uzayına dönüşüm yapar.
OpenCV DNN'in bu dinamik döngüsel orkestrasyonu yönetecek pipeline yeteneği bulunmamaktadır.

---

## 3. Donanım Matrisi: NVIDIA CUDA vs. Intel Arc (XPU & NPU)

| Kriter | NVIDIA Sistemler | Intel Lunar Lake (Bizim Donanımımız) |
| :--- | :--- | :--- |
| **İşlemci / GPU** | NVIDIA RTX Serisi | **Intel Core Ultra 9 288V + Arc Xe2 Graphics** |
| **Bağımsız NPU** | Yok | **Intel AI Boost (40+ NPU TOPS)** |
| **Düşük Seviye API** | CUDA Runtime (`libcudart.so`) | **OneAPI / Level Zero (`libze_loader.so`)** |
| **GoCV CUDA Desteği**| ✅ Tam Destek | ❌ Desteklenmez (CUDA sürücüsü bulunamaz) |
| **Doğal Hızlandırıcı** | Tensor Cores | **XMX (Xe Matrix eXtensions) + NPU Engines** |
| **Önerilen Motor** | TensorRT, cuDNN | **OpenVINO 2026.1, OpenVINO GenAI, IPEX** |

---

## 4. OpenVINO Nedir ve Neden Kritik?

**OpenVINO (Open Visual Inference and Neural Network Optimization)**, Intel'in işlemcilerini, Arc harici/dahili ekran kartlarını ve NPU yongalarını donanım seviyesinde sürmek için geliştirdiği C++ tabanlı yüksek başarımlı çıkarım motorudur.

### Temel Üstünlükleri:
1. **Sıfır PyTorch Yükü:** PyTorch gibi gigabaytlarca yer kaplayan bağımlılıkları ve Python GIL kilidini ortadan kaldırır.
2. **IR Formatı (`.xml` + `.bin`):** Model ağırlıklarını ve topolojisini donanıma özel optimize derlenmiş grafiklere dönüştürür.
3. **XMX ve NPU Optimizasyonu:** Matris çarpımlarını doğrudan Intel Arc'ın XMX çekirdeklerinde ve AI Boost NPU'da koşturur.
4. **OpenVINO GenAI:** LLM ve Difüzyon (SD 1.5, SDXL, Flux, LCM) modelleri için C++ ile yazılmış özel ultra hafif üretim motorudur.

---

## 5. Go + OpenVINO İkilisiyle Neler Yapılabilir?

### A. Saf CGo ile C API Entegrasyonu (`libopenvino_c.so`) — *Zero Python*
* Sistemde kurulu `/lib/libopenvino_c.so` kütüphanesi CGo üzerinden doğrudan Go ikili dosyasına (`bin/go-sd`) bağlanabilir.
* Model yükleme (`ov_core_read_model`), derleme (`ov_core_compile_model`) ve inference doğrudan Go goroutine'leri içinden yönetilir.
* Bellek tüketimi megabaytlar düzeyine iner, başlangıç süresi mikrosaniyelere düşer.

### B. Hibrit Donanım Dağıtımı (Heterogeneous Execution: GPU + NPU + CPU)
OpenVINO'nun çoklu aygıt koordinasyonu (`HETERO:GPU,NPU,CPU` veya `AUTO`):
* **CLIP Text Encoders:** **Intel AI Boost NPU** üzerinde sıfır GPU yükü ve minimum güç tüketimiyle çalıştırılır.
* **Difüzyon Çekirdeği (UNet / DiT):** **Intel Arc GPU (XMX)** üzerinde maksimum performansla koşturulur.
* **VAE Decoder:** **CPU veya NPU**'ya aktarılabilir.
* Bu dağıtım sayesinde Arc GPU VRAM'i şişmez ve bellek darboğazı önlenir.

### C. Süper Çözünürlük (4K Upscaling - Real-ESRGAN)
* Üretilen 1024x1024 görseller OpenVINO FP16/INT8 modeli ile Go içinde **200-300 ms** sürede 4096x4096 (4K) ticari baskı kalitesine yükseltilebilir.

### D. Akıllı Arka Plan Silme (Rembg) ve CLIP Vektör Arama
* BiRefNet/Rembg modelleri NPU üzerinde transparan PNG üretimi için çalıştırılabilir.
* OpenVINO CLIP ile üretilen görseller Go içinde anında vektörize edilerek anlamsal görsel galerisi araması sağlanabilir.

---

## 6. Doğrulama ve Entegrasyon Yol Haritası

1. **Aşama 1 (Donanım & Çalışma Ortamı Doğrulaması):**
   - Intel Arc GPU (`GPU`) ve Intel AI Boost NPU (`NPU`) cihazlarının OpenVINO GenAI ve OpenVINO Core üzerinde fonksiyonel test edilmesi.
2. **Aşama 2 (Difüzyon ve Çıkarım Kıyaslaması):**
   - SD / SDXL modelinin OpenVINO formatında derlenip GPU/NPU çıkarım hızının (it/s) ve VRAM kullanımının IPEX ile kıyaslanması.
3. **Aşama 3 (Go-SD Çift Motor Mimarisi):**
   - Kullanıcıya model yönetiminde motor seçimi sunulması:
     - `Engine A: Intel IPEX (PyTorch bfloat16)`
     - `Engine B: Intel OpenVINO GenAI (Native C++/IR)`
