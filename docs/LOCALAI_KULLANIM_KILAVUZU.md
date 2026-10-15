# LocalAI Kapsamlı Kullanım ve Kurulum Kılavuzu (2026 Güncel)

> **Hedef:** LocalAI'yi sıfırdan kurup tam teşekküllü yerel bir yapay zeka omurgasına (LLM, Görsel Üretimi/Diffusers, Ses STT/TTS, Embedding ve Ajanik Araçlar) dönüştürmek için hazırlanmış eksiksiz saha rehberi.

---

## 1. LocalAI Nedir ve Nasıl Çalışır?

**LocalAI**, OpenAI API standartlarıyla %100 uyumlu, tamamen yerel donanımınız üzerinde çalışan, bulut bağımlılığı olmayan açık kaynaklı bir yapay zeka sunucusudur.

### Temel Mimarisi
LocalAI, iki ana katmandan oluşur:
1. **Go API Gateway & Router:** HTTP isteklerini karşılar, kimlik doğrulama, kuyruk, model indirme ve OpenAI uç noktalarını (`/v1/chat/completions`, `/v1/images/generations`, `/v1/audio/transcriptions` vb.) yönetir.
2. **Modüler gRPC Backend'leri:** Ağır hesaplamaları yapan C++ ve Python tabanlı izole süreçler:
   - **`llama-cpp` (C++):** GGUF formatındaki LLM'ler ve Vision (VLM) modelleri.
   - **`diffusers` (Python):** Stable Diffusion, SDXL, Flux görsel üretim modelleri.
   - **`whisper` (C++):** OpenAI Whisper ile yüksek hızlı konuşmayı metne çevirme (STT).
   - **`piper` (C++):** Düşük gecikmeli yerel metinden konuşma üretimi (TTS).
   - **`vllm` / `transformers`:** HuggingFace yerel formatlı modeller.

---

## 2. Donanım ve Sistem Gereksinimleri

* **İşlemci (CPU):** Minimum 4 çekirdek, AVX/AVX2 veya AVX-512 desteği.
* **Bellek (RAM):**
  - Küçük Modeller (1B–3B): Minimum 8 GB RAM.
  - Standart Modeller (7B–14B): Minimum 16 GB - 32 GB RAM.
  - Stable Diffusion / SDXL: Minimum 16 GB RAM + 8 GB VRAM.
* **Ekran Kartı (GPU):**
  - **Nvidia:** CUDA 11.8 veya CUDA 12.x uyumlu kartlar (Minimum 6-8 GB VRAM önerilir).
  - **Intel:** Intel Arc & Data Center GPU (Intel IPEX / oneAPI üzerinden).
  - **Apple Silicon:** Metal hızlandırma destekli M1/M2/M3/M4.

---

## 3. Kurulum Yöntemleri

### Yöntem 1: Docker Compose ile Kurulum (En Kararlı ve Önerilen Yol)

LocalAI'yi çalıştırmanın en temiz yolu önceden derlenmiş GPU/CPU Docker imajlarını kullanmaktır.

#### A. Nvidia GPU Destekli `docker-compose.yml`
```yaml
services:
  local-ai:
    image: localai/localai:latest-aio-gpu-nvidia-cuda-12
    container_name: local-ai
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - DEBUG=true
      - THREADS=8
      - CONTEXT_SIZE=4096
      - MODELS_PATH=/build/models
      - CORS=true
      - CORS_ALLOW_ORIGINS=*
      # Model galerilerini otomatik etkinleştir
      - GALLERIES=[{"name":"localai","url":"github:mudler/LocalAI/gallery/index.yaml@master"}]
    volumes:
      - ./models:/build/models:cached
      - ./images:/tmp/generated/images
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

> **Not (AIO İmajı):** `latest-aio-gpu-nvidia-cuda-12` (All-in-One) imajı; LLM (llama.cpp), Görsel (Diffusers), Ses (Whisper ve Piper) kütüphanelerinin tümünü hazır derlenmiş olarak içerir.

#### B. Sadece CPU (AVX2) Destekli `docker-compose.yml`
```yaml
services:
  local-ai:
    image: localai/localai:latest-aio-cpu
    container_name: local-ai
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - DEBUG=false
      - THREADS=6
      - MODELS_PATH=/build/models
    volumes:
      - ./models:/build/models:cached
```

#### Çalıştırma:
```bash
# Servisi arka planda başlatın
docker compose up -d

# Logları canlı takip edin
docker compose logs -f
```

---

### Yöntem 2: Standalone Linux Binary Kurulumu (Host Üzerinde Doğrudan)

Docker kullanmak istemiyorsanız tek satırda derlenmiş binary'yi indirebilirsiniz:

```bash
# Kurulum betiğini çalıştırın (Linux x86_64)
curl https://localai.io/install.sh | bash

# Veya belirli bir versiyonu doğrudan çalıştırın
./local-ai --models-path ./models --address :8080 --threads 8
```

#### Systemd Servisi Olarak Yapılandırma (`/etc/systemd/system/local-ai.service`):
```ini
[Unit]
Description=LocalAI High Performance Inference Server
After=network.target

[Service]
Type=simple
User=caveman
WorkingDirectory=/home/caveman/localai
ExecStart=/usr/local/bin/local-ai --models-path /home/caveman/localai/models --address :8080 --threads 8
Restart=always
RestartSec=5
Environment="DEBUG=false"

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now local-ai
```

---

## 4. Model Yönetimi ve Kurulum Yolları

LocalAI'de bir model 3 farklı şekilde sisteme eklenebilir:

### 1. WebUI veya API Galerisi ile Tek Tıkla Kurulum
LocalAI çalıştığında `http://localhost:8080` adresinde yerleşik bir Web Arayüzü açılır. Buradaki "Models" sekmesinden veya doğrudan cURL ile popüler modeller kurulabilir:

```bash
# Qwen 2.5 Coder 7B modelini galeriden indirip kurma
curl -X POST http://localhost:8080/models/apply \
  -H "Content-Type: application/json" \
  -d '{"id": "model-gallery@qwen2.5-coder-7b-instruct"}'

# Whisper Ses Modelini Kurma
curl -X POST http://localhost:8080/models/apply \
  -H "Content-Type: application/json" \
  -d '{"id": "model-gallery@whisper-base"}'

# Piper TTS (Seslendirme) Modelini Kurma
curl -X POST http://localhost:8080/models/apply \
  -H "Content-Type: application/json" \
  -d '{"id": "model-gallery@piper-en-us-amy-low"}'
```

---

### 2. Manuel GGUF ve `model.yaml` Yapılandırması (Gelişmiş & Önerilen)

En yüksek performans ve tam kontrol için Hugging Face'ten indirdiğiniz `.gguf` dosyasını `models/` dizinine atıp yanına bir `.yaml` yapılandırması eklersiniz.

#### Örnek: `models/qwen2.5-coder.yaml`
```yaml
name: qwen2.5-coder
backend: llama-cpp

# GGUF model dosyasının adı (models/ altında olmalı)
parameters:
  model: qwen2.5-coder-7b-instruct-q4_k_m.gguf

# Donanım & Performans Ayarları
threads: 8
context_size: 8192
f16: true
gpu_layers: 35        # Modeli tamamen GPU'ya yüklemek için katman sayısı
mmap: true            # Hızlı bellek eşleme

# Çıkarım Parametreleri
temperature: 0.2
top_p: 0.95

# Prompt Şablonu (ChatML formatı)
template:
  chat: |
    <|im_start|>system
    You are a professional software engineer.<|im_end|>
    {{range .Messages}}
    <|im_start|>{{.Role}}
    {{.Content}}<|im_end|>
    {{end}}
    <|im_start|>assistant

# Modelin duracağı özel token'lar
stop:
  - "<|im_end|>"
  - "<|endoftext|>"
```

---

### 3. Stable Diffusion / Görsel Modeli Yapılandırması (`models/diffusers.yaml`)

```yaml
name: stablediffusion
backend: diffusers

parameters:
  model: runwayml/stable-diffusion-v1-5 # veya yerel safetensors yolu

# Diffusers ayarları
step: 25
cfg_scale: 7.5
cuda: true
f16: true
```

---

## 5. Tüm Araçların ve Modalitelerin Kullanımı (API Örnekleri)

LocalAI, standart OpenAI SDK'ları ile %100 uyumludur. URL olarak `http://localhost:8080/v1` vermeniz yeterlidir.

### 5.1. Metin ve Sohbet (Chat Completions & Streaming)

#### cURL ile:
```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-coder",
    "messages": [
      {"role": "user", "content": "Go dilinde goroutine sızıntısı (leak) nasıl önlenir? Örnek ver."}
    ],
    "temperature": 0.2,
    "stream": true
  }'
```

---

### 5.2. Vektör Embeddings (Arama & RAG)

RAG boru hatları için metinleri vektöre dönüştürme:

```bash
curl http://localhost:8080/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bge-embeddings",
    "input": "Yüksek performanslı Go mikroservisleri"
  }'
```

---

### 5.3. Görsel Üretimi (Image Generation / Stable Diffusion)

OpenAI `/v1/images/generations` standardı ile yerel görsel üretimi:

```bash
curl http://localhost:8080/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "stablediffusion",
    "prompt": "Cyberpunk city street at rainy night, highly detailed digital art, 8k resolution, octane render",
    "size": "512x512",
    "n": 1
  }'
```
*Dönen yanıtta üretilen görselin yerel sunucu URL'si veya base64 kodu yer alır.*

---

### 5.4. Ses Tanıma (Speech-to-Text / Whisper)

Ses dosyasını doğrudan metne dökme (`/v1/audio/transcriptions`):

```bash
curl http://localhost:8080/v1/audio/transcriptions \
  -H "Content-Type: multipart/form-data" \
  -F file="@/home/caveman/kayit.mp3" \
  -F model="whisper-base" \
  -F language="tr"
```

---

### 5.5. Ses Sentezleme (Text-to-Speech / Piper)

Metni doğal sese çevirme (`/v1/audio/speech`):

```bash
curl http://localhost:8080/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "model": "piper-en-us-amy-low",
    "input": "LocalAI is successfully running on your local machine.",
    "voice": "amy"
  }' \
  --output test_ses.wav
```

---

### 5.6. Araç Çağırma (Function Calling / Tool Use)

Modelin harici fonksiyonları çalıştırmasını sağlayan JSON şeması:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-coder",
    "messages": [
      {"role": "user", "content": "İstanbul için güncel hava durumu nedir?"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_current_weather",
          "description": "Belirtilen konuma ait hava durumunu getirir",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string", "description": "Şehir adı, örn: Istanbul"}
            },
            "required": ["location"]
          }
        }
      }
    ]
  }'
```

---

## 6. Go (Golang) ile Üretim Entegrasyonu

Go projelerinizden LocalAI'yi tüketmek için harici karmaşık paketlere gerek yoktur. Sektör standardı `github.com/sashabaranov/go-openai` ile sorunsuz entegre olur:

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/sashabaranov/go-openai"
)

func main() {
	// LocalAI uç noktasına bağlanan OpenAI yapılandırması
	config := openai.DefaultConfig("sk-no-key-required")
	config.BaseURL = "http://localhost:8080/v1"

	client := openai.NewClientWithConfig(config)
	ctx := context.Background()

	// 1. LLM Sohbet İsteği
	resp, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model: "qwen2.5-coder",
		Messages: []openai.ChatCompletionMessage{
			{
				Role:    openai.ChatMessageRoleUser,
				Content: "Go'da sync.Pool ne zaman kullanılmalıdır?",
			},
		},
		Temperature: 0.2,
	})
	if err != nil {
		log.Fatalf("Chat hatasi: %v", err)
	}
	fmt.Printf("Model Yanıtı:\n%s\n", resp.Choices[0].Message.Content)

	// 2. Stable Diffusion Görsel Üretim İsteği
	imgResp, err := client.CreateImage(ctx, openai.ImageRequest{
		Model:  "stablediffusion",
		Prompt: "Minimalist vector illustration of a friendly blue gopher in space",
		Size:   openai.CreateImageSize512x512,
		N:      1,
	})
	if err != nil {
		log.Fatalf("Görsel hatasi: %v", err)
	}
	fmt.Printf("Oluşturulan Görsel URL: %s\n", imgResp.Data[0].URL)
}
```

---

## 7. Performans ve VRAM İnce Ayarları (Tuning)

1. **`gpu_layers` Optimizasyonu:**
   Modelin kaç katmanının GPU VRAM'ine atılacağını belirler.
   - Örn: 7B bir modelde ~32–35 katman vardır. Ekran kartınız 8 GB ise `gpu_layers: 35` vererek modelin %100 GPU'da sıfır CPU darboğazıyla koşmasını sağlarsınız.
   - 4 GB VRAM varsa `gpu_layers: 18` gibi bir değerle hibrit (GPU+RAM) çalıştırın.
2. **`threads` Ayarı:**
   CPU'da çalışırken sunucunuzun fiziksel çekirdek sayısı kadar thread verin. Hyperthreading sanal çekirdeklerini dahil etmek performansı düşürebilir (Örn: 8 gerçek çekirdek için `threads: 8`).
3. **`mmap` ve `mlock`:**
   - `mmap: true`: Model dosyasını diske paralel eşler, model açılış süresini saniyenin altına indirir.
   - `mlock: true`: RAM'e alınan model katmanlarının işletim sistemi tarafından swap'a (diske) taşınmasını yasaklar. Yeterli RAM varsa daima açık tutun.
4. **Context Size Sınırı:**
   `context_size: 4096` veya `8192` olarak ihtiyacınız kadar belirleyin. Gereksiz yere `32768` vermek KV Cache belleğini katlar ve CUDA OOM'a yol açar.

---

## 8. Sık Karşılaşılan Hatalar ve Çözümleri

### 1. Model Yanıt Vermiyor veya Sonsuz Saçmalıyor
* **Neden:** `model.yaml` içerisindeki `template` veya `stop` token'ları yanlıştır.
* **Çözüm:** Modelin Hugging Face sayfasındaki tokenizer formatını kontrol edin. Llama-3 için `<|eot_id|>`, Qwen/DeepSeek için `<|im_end|>` stop token'ı eklenmelidir.

### 2. `CUDA error: out of memory` (OOM)
* **Neden:** `gpu_layers` ekran kartı VRAM'inden fazlasına ayarlanmış veya `context_size` çok yüksek tutulmuştur.
* **Çözüm:** `gpu_layers` değerini 5'er 5'er düşürün (örn: 35 -> 28 -> 22) ya da bağlam boyutunu `2048`'e çekin.

### 3. Docker İçinde GPU Algılanmıyor
* **Neden:** `nvidia-container-toolkit` kurulu değildir veya Docker deamon GPU'ya erişemiyordur.
* **Test:** `docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi`
* **Çözüm:** Host makinede `nvidia-container-toolkit` paketini kurup `sudo systemctl restart docker` yapın.

### 4. `backend process died unexpectedly` Hatası
* **Neden:** Kullanılan GGUF modeli ile backend sürümü uyuşmuyor veya sistem belleği (RAM/Swap) anlık tükenmiştir.
* **Çözüm:** `docker compose logs -f` ile gRPC worker'ın stderr çıktısına bakın; OOM-killer sürecin fişini çekmiş olabilir.

---

## 9. Özet Kontrol Listesi (Cheatsheet)

| Eylem | Komut / Endpoint |
| :--- | :--- |
| **Başlatma** | `docker compose up -d` |
| **Modelleri Listele** | `curl http://localhost:8080/v1/models` |
| **Model Kur (Galeri)** | `POST /models/apply {"id": "model-gallery@..."}` |
| **Sohbet (Streaming)** | `POST /v1/chat/completions {"stream": true}` |
| **Görsel Üret (SD)** | `POST /v1/images/generations {"prompt": "..."}` |
| **Ses Transkripsiyon** | `POST /v1/audio/transcriptions (multipart/form)` |
| **Ses Sentezleme** | `POST /v1/audio/speech {"input": "..."}` |
| **Logları İncele** | `docker compose logs -f --tail=100` |
