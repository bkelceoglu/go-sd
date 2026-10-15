# Golang Yapay Zeka (AI) Ekosistemi: Uçtan Uca Derinlemesine Teknik Analiz

> **Tarih:** Ekim 2026  
> **Kapsam:** En alt seviye tensör hesaplamalarından en üst seviye çoklu-ajan (multi-agent) orkestrasyon sistemlerine, vektör veritabanlarından yerel çıkarım sunucularına Go AI mimarisi.

---

## 1. Giriş: 2026'da Go ve Yapay Zeka Gerçekliği (Python vs. Go İkilemi)

Yapay zeka dünyasında uzun yıllar boyunca Python tartışmasız "araştırma ve prototipleme" dili oldu. Ancak yapay zeka modelleri laboratuvardan çıkıp **yüksek eşzamanlılıklı (high-concurrency), düşük gecikmeli (low-latency), dağıtık ve sıfır bağımlılıklı üretim (production) sistemlerine** dönüştükçe Go ekosistemi sektörün omurgası haline gelmiştir.

### İş Bölümü Paradigması
```
+-------------------------------------------------------------------+
|                        ARAŞTIRMA & EĞİTİM                         |
|   Python / PyTorch / JAX / Triton / CUDA Kernel Geliştirme        |
+-------------------------------------------------------------------+
                                  │ Modeller (Saf Ağırlıklar / GGUF / ONNX)
                                  ▼
+-------------------------------------------------------------------+
|               DAĞITIK ALTYAPI, ORKESTRASYON & SERVİS              |
|   Go (Golang) Ekosistemi:                                         |
|   - Yerel Çıkarım Motorları: Ollama, LocalAI                      |
|   - Vektör Veritabanları: Weaviate, Milvus                        |
|   - Ajan & İş Akışı Çatıları: Eino (ByteDance), Genkit (Google)  |
|   - Protokoller: Model Context Protocol (MCP Go SDK)              |
|   - Düşük Bellekli Mikro-Daemon'lar (<2 MB RAM, Goroutine)        |
+-------------------------------------------------------------------+
```

### Neden Go?
1. **Goroutine ve Eşzamanlılık (High-Concurrency SSE/Streaming):** Bir LLM yanıtı saniyelerce token token stream eder. Python'da (FastAPI/Uvicorn/asyncio) 5.000 açık SSE bağlantısı event-loop ve GIL darboğazı yaratırken, Go runtime'ı 100.000+ goroutine'i birkaç megabayt bellek ile kilitlenmeden yönetir.
2. **Statik Tek Binary ve Sıfır Bağımlılık:** `Conda`, `venv`, `pip` cehennemi ve gigabaytlarca Docker imajı yerine 15-30 MB'lık tek bir statik Go binary'si `scratch` veya `alpine` üzerinde anında ayağa kalkar (Cold-start: <10ms).
3. **Bellek Güvenliği ve GC Optimizasyonu:** Model inference sırasında Go'nun nesne havuzlama (`sync.Pool`) ve düşük GC duraklamaları (sub-millisecond) gerçek zamanlı agentik boru hatlarında kritik avantaj sağlar.

---

## 2. Mimari Katman Haritası (Layer 0'dan Layer 7'ye)

```
┌────────────────────────────────────────────────────────────────────────┐
│ Katman 6: Ajan ve İş Akışı Çatıları (Eino, Genkit, GoAI, LangChainGo) │
├────────────────────────────────────────────────────────────────────────┤
│ Katman 5: Protokoller ve Araç Ekosistemi (MCP Go SDK, mark3labs)       │
├────────────────────────────────────────────────────────────────────────┤
│ Katman 4: Model Sağlayıcı SDK'ları (Gemini, Claude, OpenAI, Ollama)   │
├────────────────────────────────────────────────────────────────────────┤
│ Katman 3: Vektör Arama & Veritabanları (Weaviate, Milvus, pgvector-go) │
├────────────────────────────────────────────────────────────────────────┤
│ Katman 2: Yerel Çıkarım & Servis Motorları (Ollama, LocalAI)           │
├────────────────────────────────────────────────────────────────────────┤
│ Katman 1: Derin Öğrenme Runtime & CGO Köprüleri (ONNX Runtime, GGML)   │
├────────────────────────────────────────────────────────────────────────┤
│ Katman 0: Sayısal Hesaplama, Lineer Cebir & Tensörler (Gonum, Gorgonia)│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Katman 0: Sayısal Hesaplama, Lineer Cebir ve Tensörler

Go'da saf matematik ve tensör hesaplamaları, dış C/C++ bağımlılığı olmadan doğrudan CPU üzerinde matris işlemleri yapmak için kullanılır.

### 3.1. Gonum (`gonum.org/v1/gonum`)
Go ekosisteminin NumPy ve SciPy'ıdır. Saf Go (pure Go) ile yazılmış olup opsiyonel Cgo/OpenBLAS hızlandırması sunar.
- **`mat` paketi:** Yoğun (`Dense`) ve seyrek (`Sparse`) matris işlemleri, QR/SVD/Cholesky ayrışımları.
- **`spatial/distance`:** Cosine similarity, Euclidean distance, Manhattan mesafe metrikleri.
- **`stat` & `optimize`:** Olasılık dağılımları, gradyan inişi (Gradient Descent), BFGS, Nelder-Mead optimizasyon algoritmaları.
- **Kullanım:** Özel embedding uzaklık hesaplamaları, k-means kümeleme, PCA ve boyut indirgeme.

### 3.2. Gorgonia (`gorgonia.org/gorgonia`)
Gorgonia, Go'nun PyTorch/TensorFlow karşılığıdır. 
- Hesaplama grafiği (computational graph) oluşturur ve **otomatik türev alma (automatic differentiation / autograd)** gerçekleştirir.
- `gorgonia.org/tensor` alt paketi çok boyutlu tensörleri (N-dimensional array) yönetir.
- CUDA eklentisi (`gorgonia.org/cu`) ile tensör operasyonlarını doğrudan Nvidia GPU'larına devredebilir.
- **Durum Analizi:** Küçük ölçekli özel yapay sinir ağları, sembolik türev alma ve akademik araştırmalar için mükemmeldir; ancak LLM seviyesinde transformer eğitimi için PyTorch ölçeğinde değildir.

---

## 4. Katman 1: Derin Öğrenme Runtime & CGO Köprüleri

PyTorch veya JAX ile eğitilmiş bir modeli Go mikroservisinde **Python olmadan** en yüksek performansla çalıştırma katmanı.

### 4.1. ONNX Runtime Go (`github.com/yalue/onnxruntime_go`)
Microsoft'un yüksek performanslı C API'sine bağlanan Go CGo kütüphanesidir.
- **Sıfır Bellek Kopyalama (Zero-Copy):** Go slice'ları doğrudan ONNX Runtime bellek işaretçilerine (pointers) eşlenir.
- **Donanım Sağlayıcıları (Execution Providers):** CPU, CUDA, TensorRT, DirectML, Apple CoreML.
- **Örnek Kullanım Alanı:**
  - Embedding üretimi (örn. `bge-small-en-v1.5`, `all-MiniLM-L6-v2`).
  - Cross-Encoder Re-ranking modelleri (RAG arama sonuçlarını yeniden sıralama).
  - Görüntü sınıflandırma ve nesne tanıma (ResNet, YOLO ONNX formatında).

```go
// ONNX Runtime ile Go üzerinden model çalıştırma mantığı
session, err := onnxruntime_go.NewAdvancedSession(
    "models/bge-small.onnx",
    []string{"input_ids", "attention_mask"},
    []string{"last_hidden_state"},
    inputTensors,
    outputTensors,
    options,
)
```

### 4.2. GGML & Llama.cpp CGo Sarmalayıcıları (`go-llama.cpp`)
Go'dan doğrudan quantize edilmiş GGUF modellerini (Llama 3, Qwen 2.5, DeepSeek) C/C++ seviyesinde çalıştırmak için geliştirilen düşük seviye bağlayıcılardır. Ollama da başlangıçta bu temeller üzerinden türemiştir.

### 4.3. Sherpa-ONNX (`github.com/k2-fsa/sherpa-onnx`)
Ses zekası (Speech-to-Text & Text-to-Speech) için Go bağlayıcıları sunan yeni nesil Kaldi projesi.
- Whisper, Zipformer modellerini ONNX üzerinden Go'da çalıştırır.
- VITS ve Piper TTS motorları ile Go servislerinde **50 milisaniyenin altında** ses sentezleme ve transkripsiyon sağlar.

### 4.4. GoCV (`gocv.io/x/gocv`)
OpenCV 4.x için Go bağlayıcısı. Bilgisayarlı görü (Computer Vision), video akışı işleme (RTSP/Webcam) ve YOLO modellerini OpenCV DNN modülüyle Go üzerinde koşturma standardıdır.

---

## 5. Katman 2: Yerel Çıkarım & Servis Motorları (Go'nun Güç Merkezi)

Dünyadaki açık kaynak LLM'lerin yerel makinelerde ve edge sunucularda çalıştırılmasını sağlayan devasa araçlar **Go ile yazılmıştır**.

### 5.1. Ollama (`github.com/ollama/ollama`)
Yapay zeka dünyasında yerel modellerin fiili standardı olan Ollama'nın ana motoru Go'dur.
- **Mimari:**
  - **Sunucu & API:** Go'nun `net/http` motoru üzerinde REST ve SSE endpoint'leri.
  - **Model Yöneticisi:** GGUF dosyalarının indirilmesi, parça parça saklanması, katman doğrulaması.
  - **Runner Süreç Orkestrasyonu:** Go, işletim sistemini ve donanımı (Metal, CUDA, ROCm, Vulkan) tespit eder ve uygun derlenmiş `llama.cpp` C++ runner binary'sini bir alt süreç (subprocess / RPC) olarak başlatır.
  - **Bellek Yönetimi:** Modellerin dinamik olarak VRAM'e yüklenip boşaltılması (unloading) Go içerisindeki zamanlayıcılarla yönetilir.

### 5.2. LocalAI (`github.com/mudler/LocalAI`)
Ettore Di Giacinto (mudler) tarafından geliştirilen ve tamamen Go ile yazılan açık kaynaklı, OpenAI API uyumlu yerel yapay zeka sunucusu.
- Tek bir Go binary'si arkasında LLM'ler (GGUF, ExLlama, vLLM), ses modelleri (Whisper, Piper), görsel üretim (Stable Diffusion) ve embedding modelleri çalıştırılır.
- Kubernetes ortamında GPU/CPU kümelemesi için Go tabanlı worker'lar kullanır.

---

## 6. Katman 3: Vektör Arama & Veritabanları

RAG (Retrieval-Augmented Generation) sistemlerinin kalbi olan vektör veritabanı ekosisteminde Go yine en ön saftadır.

### 6.1. Weaviate (`github.com/weaviate/weaviate`)
- **%100 Go ile yazılmıştır.**
- Dağıtık mimari, Raft konsensüsü ve bellek içi HNSW (Hierarchical Navigable Small World) indeksleme motoru Go goroutine'leri ile paralel çalışır.
- Hibrit Arama (BM25 + Vektör araması) ve dinamik çoklu-kiracılık (multi-tenancy) yeteneklerine sahiptir.

### 6.2. Milvus (`github.com/milvus-io/milvus`)
- Milvus'un dağıtık koordinatörü, proxy katmanı, mesaj kuyruğu yönetimi ve sorgu yönlendiricisi (QueryCoord, DataCoord) **Go** ile yazılmıştır. Ağır SIMD vektör indeksleme motoru (Knowhere) ise C++'tadır.

### 6.3. PostgreSQL & pgvector Go Sürücüleri
- `github.com/pgvector/pgvector-go` ve `jackc/pgx/v5`: Go uygulamalarının PostgreSQL üzerindeki HNSW/IVFFlat vektör indeksleriyle sıfır bellek kopyalamayla haberleşmesini sağlar.

---

## 7. Katman 4: Model Sağlayıcı SDK'ları ve Mikro-Daemon Deseni

Go uygulamanız doğrudan bulut veya yerel LLM API'lerine bağlanırken kullanılan kütüphaneler.

### 7.1. Resmi Sağlayıcı SDK'ları
| Sağlayıcı | Kütüphane | Notlar |
| :--- | :--- | :--- |
| **Google Gemini** | `google.golang.org/genai` | Google'ın yeni resmi birleşik SDK'sı (eski `generative-ai-go` ve `vertexai` yerine). Gemini 2.x/3.x, multimodal streaming, araç çağırma destekler. |
| **Anthropic Claude** | `github.com/anthropics/anthropic-sdk-go` | Resmi tip-güvenli SDK. Prompt caching, tool use, streaming, düşünce token'ları (thinking). |
| **OpenAI** | `github.com/openai/openai-go/v3` | Resmi SDK. Alternatif olarak sektör standardı `github.com/sashabaranov/go-openai`. |
| **Ollama** | `github.com/ollama/ollama/api` | Yerel modeller için resmi istemci paketi. |

### 7.2. "Sıfır Dış Bağımlılık" (Zero-External-Dependency) Mikro-Daemon Deseni
Go topluluğunda sistem CLI araçları, arka plan servisleri ve uç cihazlar için benimsenen en kritik mimari desen:
> **Hiçbir harici SDK kullanmadan**, yalnızca Go standart kütüphanesindeki `net/http`, `bufio.Scanner` ve `encoding/json` kullanılarak Ollama veya vLLM gibi uç noktalara bağlanmak.

**Kazanımlar:**
- **Bellek:** Boşta <2 MB RAM kullanımı.
- **Başlangıç:** <5 ms anında soğuk başlangıç (cold start).
- **Güvenlik:** Sıfır supply-chain açığı ve üçüncü parti kütüphane kırılmalarına karşı tam bağışıklık.

---

## 8. Katman 5: Modern Ajan & İş Akışı Çatıları (2025/2026 Dönemi)

Go'daki modern framework katmanı LangChain kopyalarından çıkıp Go'nun tip sistemini ve kanallarını (channel) merkeze alan özgün mimarilere evrilmiştir.

### 8.1. CloudWeGo Eino (`github.com/cloudwego/eino`) — ByteDance
Şu anda Go dünyasının en gelişmiş ve yüksek performanslı kurumsal LLM framework'üdür.
- **İki Temel Direk:**
  1. **`compose`:** Tip-güvenli graflar (DAG), zincirler ve iş akışları oluşturur. LangGraph'ın Go'daki tip-güvenli, kanallarla çalışan eşdeğeridir.
  2. **`adk` (Agent Development Kit):** Otonom çoklu-ajan sistemleri, durum yönetimi, dinamik araç seçimi ve insan-döngüde (human-in-the-loop) onay mekanizmaları.
- **Ekosistem (`eino-ext`):** OpenAI, Ollama, Claude, Ark, Qdrant, Milvus, Redis için hazır bileşenler.

### 8.2. Google Genkit for Go (`github.com/firebase/genkit/go`)
Google'ın açık kaynaklı, üretim odaklı AI uygulama geliştirme SDK'sı.
- **Özellikler:**
  - `genkit.DefineFlow`: Güçlü tiplemeli yapay zeka akışları (Flows).
  - `GenerateData[T]`: Go generics kullanarak doğrudan struct formatında çıktı alma (Structured Outputs).
  - **Genkit Developer UI:** Yerel ortamda prompt test etme, tracing, span'ler ve değerlendirme (evals) yapabileceğiniz yerleşik web arayüzü.

### 8.3. GoAI (`github.com/zendev-sh/goai`)
JavaScript dünyasındaki Vercel AI SDK'nın Go karşılığıdır.
- 25+ model sağlayıcısını tek bir arayüzde toplar.
- `GenerateObject[T]` ile Go struct'larına sıfır şema hatasıyla JSON mapping.
- Akış başına yalnızca ~220 KB bellek tüketimi.

### 8.4. LangChainGo (`github.com/tmc/langchaingo`)
Go ekosistemindeki ilk ve en bilinen açık kaynak çatı. RAG boru hatları, vektör mağaza soyutlamaları ve temel zincirler için geniş bir topluluk desteğine sahiptir; ancak yeni projeler çoğunlukla Eino veya Genkit'e yönelmektedir.

---

## 9. Katman 6: Model Context Protocol (MCP) Go Ekosistemi

Yapay zeka modellerinin harici araçlara, dosya sistemlerine ve veritabanlarına bağlanmasını standartlaştıran Model Context Protocol (MCP) mimarisinde Go iki temel SDK sunar:

1. **`github.com/modelcontextprotocol/go-sdk` (Resmi SDK):**
   - Model Context Protocol organizasyonu ve Google işbirliğiyle sürdürülen resmi kütüphane.
   - JSON-RPC 2.0 üzerinden stdio, SSE ve Streamable HTTP taşıyıcılarını (transports) doğrudan destekler.
2. **`github.com/mark3labs/mcp-go` (Topluluk Standardı):**
   - Go geliştiricileri arasında ilk günden beri çok yaygın olan, ergonomik API'ye sahip (`server.NewMCPServer`) popüler kütüphane.

---

## 10. Katman 7: Klasik Makine Öğrenmesi & GBDT Çıkarımı

LLM'ler dışındaki geleneksel tablo (tabular) verileri ve hızlı karar mekanizmaları için Go çözümleri:

### 10.1. Leaves (`github.com/dmitryikh/leaves`)
- **LightGBM, XGBoost ve CatBoost** modellerini saf Go (pure Go) ile çalıştıran inanılmaz hızlı bir inference motorudur.
- CGo veya harici C++ paylaşımlı kütüphanelerine ihtiyaç duymaz.
- Finans, fraud-detection ve ad-tech sektörlerinde mikrosaniyeler mertebesinde tahmin üretir.

### 10.2. GoLearn (`github.com/sjwhitworth/golearn`)
- Scikit-learn benzeri temel makine öğrenmesi kütüphanesi (k-NN, Karar Ağaçları, Naive Bayes, cross-validation).

---

## 11. Kod Örnekleri ve Mimari Desenler

### Örnek A: Sıfır Harici Bağımlılıkla Ollama SSE Streaming (Ultra Hafif Daemon)
```go
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type OllamaRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Stream bool   `json:"stream"`
}

type OllamaStreamChunk struct {
	Response string `json:"response"`
	Done     bool   `json:"done"`
}

// StreamGenerate: 0 harici kütüphane, sub-2MB RAM footprint
func StreamGenerate(ctx context.Context, model, prompt string) error {
	reqBody, _ := json.Marshal(OllamaRequest{
		Model:  model,
		Prompt: prompt,
		Stream: true,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://localhost:11434/api/generate", bytes.NewReader(reqBody))
	if err != nil {
		return fmt.Errorf("istek olusturulamadi: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("istek hatasi: %w", err)
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		var chunk OllamaStreamChunk
		if err := json.Unmarshal(scanner.Bytes(), &chunk); err != nil {
			continue
		}
		fmt.Print(chunk.Response)
		if chunk.Done {
			break
		}
	}
	fmt.Println()
	return scanner.Err()
}
```

### Örnek B: Google Genkit Go ile Tip-Güvenli Yapılandırılmış Çıktı (Structured Output)
```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/firebase/genkit/go/ai"
	"github.com/firebase/genkit/go/genkit"
	"github.com/firebase/genkit/go/plugins/googlegenai"
)

type BugAnalysis struct {
	Severity    string   `json:"severity"`
	RootCause   string   `json:"root_cause"`
	Suggestions []string `json:"suggestions"`
}

func AnalyzeCode(ctx context.Context, codeSnippet string) (*BugAnalysis, error) {
	g := genkit.Init(ctx, genkit.WithPlugins(&googlegenai.GoogleAI{}))

	resp, err := genkit.GenerateData[BugAnalysis](ctx, g,
		ai.WithModelName("googleai/gemini-2.5-flash"),
		ai.WithPrompt(fmt.Sprintf("Asagidaki Go kodundaki hatayi analiz et:\n%s", codeSnippet)),
	)
	if err != nil {
		return nil, err
	}
	return resp.Output, nil
}
```

---

## 12. Go vs. Python AI Karşılaştırma Matrisi

| Kriter | Go (Golang) | Python |
| :--- | :--- | :--- |
| **Model Eğitimi (Training)** | Sınırlı (Gorgonia) | Mutlak Lider (PyTorch, JAX, Deepspeed) |
| **Yerel Çıkarım Sunucuları** | **Lider** (Ollama, LocalAI) | Popüler (vLLM, TGI - C++ çekirdekli) |
| **Vektör Veritabanı Motoru**| **Lider** (Weaviate, Milvus) | İstemci seviyesinde (Chroma) |
| **Eşzamanlı SSE/Stream** | **Mükemmel** (100k+ eşzamanlı bağlantı) | Sınırlı (GIL ve Asyncio bellek yükü) |
| **Bellek Tüketimi (Boşta)**  | **1 - 15 MB** | 150 - 500 MB |
| **Dağıtım (Deployment)**     | **Tek Statik Binary (Scratch)** | Devasa Docker imajları (CUDA + venv) |
| **Protokol Sunucuları (MCP)**| **Ultra Düşük Gecikmeli** | Hızlı prototipleme |
| **Ajan Çatıları**           | Eino (ByteDance), Genkit (Google) | LangGraph, CrewAI, AutoGen |

---

## 13. Sonuç ve Stratejik Öneriler

Go, yapay zekanın "arka plan motor odası"dır. 2026 itibarıyla Go ile AI projeleri geliştirirken şu mimari rotayı izlemek en iyi sonuçları verir:

1. **Yeni Bir LLM Uygulaması veya Ajan Geliştiriyorsanız:**
   - Kurumsal ve graf tabanlı iş akışları için **ByteDance Eino** (`cloudwego/eino`).
   - Google / Vertex AI ekosistemi ve güçlü tip güvenliği için **Google Genkit Go** (`firebase/genkit/go`).
2. **Kendi Altyapınızı / Yerel Modellerinizi Barındırıyorsanız:**
   - CLI ve model orkestrasyonu için **Ollama** veya **LocalAI**.
   - Vektör aramaları için **Weaviate** veya **Milvus**.
3. **Mikroservisler ve Sistem Araçları Yazıyorsanız:**
   - Ağır üçüncü parti SDK'lar yerine **Go Standart Kütüphanesi (`net/http`)** ile yerel çıkarım motorlarına bağlanan ultra hafif daemon deseni.
4. **Harici Model Servisleri ile Entegrasyonda:**
   - Google için resmi `google.golang.org/genai`, Anthropic için `github.com/anthropics/anthropic-sdk-go`.
5. **Araçlar ve Dış Dünya Entegrasyonunda:**
   - `github.com/modelcontextprotocol/go-sdk` ile resmi standart Model Context Protocol (MCP) sunucuları inşa etmek.
