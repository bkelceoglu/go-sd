# GoCV CUDA, Go AI Ekosistemi ve Intel Arc Mimarisi Araştırma Raporu

**Tarih:** 14 Ekim 2026  
**Proje:** `go-sd` (Go tabanlı Yüksek Başarımlı AI Görsel Üretim ve Stüdyo Platformu)  
**Araştırma Konusu:** `gocv.io/x/gocv/cuda` paketi ile model yükleme, AI çıkarımı (inference) ve donanım uyumluluğu.

---

## 1. Yönetici Özeti (Executive Summary)

Bu araştırma, Go dilinde OpenCV CUDA modüllerini sarmalayan `gocv.io/x/gocv/cuda` paketinin derin öğrenme (Deep Learning) ve üretken yapay zeka (Generative AI - Stable Diffusion / SDXL) alanındaki uygulanabilirliğini, donanım gereksinimlerini ve projemizdeki olası kullanım senaryolarını incelemektedir.

### Temel Bulgular:
1. **Stable Diffusion / SDXL İçin:** `gocv.io/x/gocv/cuda` **kullanılamaz**. OpenCV DNN modülü, çok bileşenli iteratif difüzyon mimarilerini (Dual CLIP, Cross-Attention UNet/DiT, latent schedulers, VAE) desteklemez.
2. **Görüntü İşleme ve Klasik AI (YOLO, ResNet, OCR) İçin:** **Kullanılabilir.** ONNX veya Caffe/TensorFlow formatındaki tek yönlü (feed-forward) modeller CUDA çekirdeklerinde yüksek FPS ile çalıştırılabilir.
3. **Intel Arc (XPU) Uyumluluğu:** `gocv/cuda` paketi doğrudan **çalışmaz**. Çünkü tescilli NVIDIA CUDA sürücüsüne (`libcudart.so`) bağımlıdır. Intel Arc GPU'lar ise **OneAPI / Level Zero / SYCL** ekosistemini kullanır. Intel donanımları için doğru OpenCV karşılığı **OpenVINO Backend**'dir.

---

## 2. GoCV CUDA (`gocv.io/x/gocv/cuda`) Mimarisi

GoCV, OpenCV 4.x C++ API'sini CGo (C-Go FFI) köprüleri üzerinden Go'ya taşır. `cuda` alt paketi ise OpenCV'nin `opencv2/cuda*.hpp` başlıklarını (headers) bağlar:

* **Bellek Yönetimi:** `cuda.GpuMat` veri yapısı, pikselleri ana bellek (RAM) yerine doğrudan GPU VRAM'inde tutar. CPU $\leftrightarrow$ GPU veri transfer maliyetini sıfırlayarak işlem yapar.
* **Görüntü İşleme Modülleri:** `cudaimgproc` (renk dönüşümleri, kenar tespiti), `cudafilters` (Gaussian, Sobel filtreleme), `cudawarping` (perspektif ve boyutlandırma).
* **DNN Entegrasyonu:** `gocv.dnn` modülüyle entegre olarak `Net.SetPreferableBackend(gocv.NetBackendCUDA)` ve `Net.SetPreferableTarget(gocv.NetTargetCUDA)` bayraklarıyla modelleri CUDA'ya devreder.

---

## 3. Stable Diffusion (SD/SDXL) Neden OpenCV DNN ile Yüklenemez?

Klasik bir yapay zeka modeli ile Difüzyon modelinin mimari farkı:

```
[Klasik Model (YOLO/ResNet)]
Girdi Görseli (3x640x640) ---> [Tek Yönlü Derin Ağ] ---> Çıktı Tensörü (Kutular/Sınıflar)
(OpenCV DNN bunu tek bir hesaplama grafiği (graph) olarak kolayca çalıştırır)

[Üretken Model (Stable Diffusion XL)]
1. Prompt ---------> [CLIP ViT-L + OpenCLIP BigG Text Encoders] (Metin Vektörleri)
2. Rastgele Latent -> [20-50 İterasyonluk Döngü (Scheduler: Euler A / DPM++)]
                           |---> UNet / DiT (Zaman adımı + Cross-Attention)
                           |<--- Gürültü Tahmini (Classifier-Free Guidance)
3. Çözülen Latent -> [VAE Decoder] ---> 1024x1024 RGB Görsel
(OpenCV DNN döngüsel scheduler, dinamik dikkat katmanları ve çoklu model orkestrasyonunu desteklemez)
```

Bu nedenle Stable Diffusion modelleri (`.safetensors`, `.ckpt`) OpenCV DNN veya `gocv/cuda` ile doğrudan yüklenemez ve çalıştırılamaz.

---

## 4. Donanım Matrisi: NVIDIA CUDA vs. Intel Arc (XPU)

| Kriter | NVIDIA Sistemler | Intel Arc Sistemler (Bizim Donanımımız) |
| :--- | :--- | :--- |
| **Sürücü Altyapısı** | NVIDIA Proprietary Driver | Linux i915 / Xe KMD + Level Zero Loader |
| **Düşük Seviye API** | CUDA Runtime (`libcudart.so`) | Intel OneAPI / Level Zero (`libze_loader.so`) |
| **GoCV CUDA Desteği** | ✅ Tam Destek | ❌ Desteklenmez (CUDA sürücüsü bulunamaz) |
| **Doğal Hızlandırıcı** | Tensor Cores | XMX (Xe Matrix eXtensions) Engines |
| **Önerilen C/C++ Motoru** | TensorRT, cuDNN | **OpenVINO, Intel IPEX (SYCL)** |

Intel Arc GPU'larda Go veya C++ seviyesinde yüksek başarımlı çıkarım yapmak için **OpenVINO** veya **SYCL** tabanlı kütüphaneler zorunludur.

---

## 5. Go Ekosisteminde Neler Yapılabilir?

### A. Klasik Computer Vision ve Görüntü İşleme (NVIDIA & OpenVINO)
Eğer sistemde uygun donanım ve derlenmiş kütüphaneler varsa:
1. **Ultra Hızlı Post-Processing:** Üretilen görsellerin boyutlandırılması, keskinleştirilmesi, akıllı kırpılması (smart-cropping) GPU üzerinde 1 milisaniyenin altında yapılır.
2. **ControlNet Ön İşlemcileri:** Canny kenar tespiti, derinlik haritalama (Depth preprocessor) gibi adımlar görsel üretime girmeden önce Go içinde milisaniyeler seviyesinde hazırlanabilir.
3. **Super-Resolution (Upscaling):** Real-ESRGAN gibi ONNX modelleri GoCV DNN üzerinden çalıştırılarak üretilen 1024x1024 görseller 4K çözünürlüğe anında yükseltilebilir.

### B. Go ile AI Inference Alternatifleri

1. **GoCV + OpenVINO Backend (Intel Arc Uyumlu):**
   * OpenCV, Intel OpenVINO backend (`NetBackendOpenVINO` / `NetTargetOpenVINO`) ile derlendiğinde ONNX modellerini Intel Arc XPU üzerinde çalıştırabilir.
2. **ONNX Runtime Go (`github.com/yalue/onnxruntime_go`):**
   * Microsoft'un resmi Go bağlayıcısı. OpenVINO Execution Provider (EP) veya TensorRT EP ile doğrudan Go içinden saf C++ hızında inference sunar.
3. **`stable-diffusion.cpp` (Go CGo Bindings):**
   * GGML tabanlı saf C/C++ difüzyon motoru. Vulkan ve SYCL desteğiyle Intel Arc üzerinde CPU bağımsız çalışabilir.
4. **Mevcut Mimarimiz (Go HTTP/SSE Master + Headless IPEX/Diffusers Worker):**
   * Go'nun eşzamanlılık (concurrency) ve network gücünü, Intel Arc için optimize edilmiş en güncel PyTorch/IPEX `torch.bfloat16` motoruyla birleştirir.
   * Günümüz AI dünyasındaki en esnek (LoRA, SDXL, Inpainting, ControlNet) ve ticari olarak en kararlı modeldir.

---

## 6. Sıradaki Adım: OpenVINO Entegrasyonu

Bir sonraki aşamada araştırılacak ve geliştirilecek başlıklar:
* **Intel OpenVINO GenAI API:** Stable Diffusion ve SDXL modellerini OpenVINO formatına IR (`.xml`, `.bin`) dönüştürerek Intel Arc üzerinde çalıştırma kabiliyeti.
* **Go $\leftrightarrow$ OpenVINO Entegrasyonu:** Go'dan OpenVINO C/C++ API'sine doğrudan bağlanma veya `onnxruntime_go` ile OpenVINO Execution Provider çalıştırma fizibilitesi.
