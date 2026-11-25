# GO-SD

**A fast, lightweight local WebUI for Stable Diffusion & SDXL — powered by Go + Python.**

No Gradio overhead, no heavy startup, and **0 MB VRAM used until you actually load a model**.

---

## Why GO-SD?

- **Instant Startup:** The Go server boots in milliseconds (`<10 MB` RAM) and stays in standby until you load a checkpoint.
- **Full VRAM Reclamation:** Click **Unload** in the UI to completely shut down the Python worker and free 100% of your GPU memory.
- **Multi-Backend Support:**
  - **Intel Arc GPUs (`xpu`)** via IPEX (`bfloat16`)
  - **OpenVINO GenAI** for Intel CPUs/GPUs
  - **NVIDIA GPUs (`cuda`)** & **CPU**
- **Built-in Model Manager:** Search HuggingFace and download `.safetensors` checkpoints directly from the Web UI.
- **Live Progress & Gallery:** Real-time step-by-step generation progress, style presets, lightbox viewer, and ZIP/CSV export bundles.

---

## Requirements

- **Go 1.27+** (if building from source)
- **Python 3.10+** with PyTorch (`torch`, `diffusers`, `transformers`, `accelerate`) — or Intel IPEX / `openvino-genai`
- At least one Stable Diffusion / SDXL model (`.safetensors` in `models/Stable-diffusion/` or OpenVINO IR in `models/OpenVINO/`)

---

## Quick Start

### 1. Get GO-SD
Download the binary for your OS from [Releases](https://github.com/bkelceoglu/go-sd/releases), or build from source:

```bash
git clone https://github.com/bkelceoglu/go-sd.git
cd go-sd
make build
```

*(Or install directly with Go: `go install github.com/bkelceoglu/go-sd/cmd@latest`)*

### 2. Add a Model
Drop your `.safetensors` file into:
```text
models/Stable-diffusion/
```
*(Or skip this step and download one inside the Web UI via **Model Manager**.)*

### 3. Run
```bash
# Intel Arc GPU (default)
./bin/go-sd -port 8080 -device xpu

# NVIDIA GPU
./bin/go-sd -port 8080 -device cuda

# CPU
./bin/go-sd -port 8080 -device cpu
```
Then open **http://localhost:8080** in your browser and click **Load Model**.

---

## Options

| Flag | Default | Description |
|---|---|---|
| `-port` | `8080` | Web UI port |
| `-device` | `xpu` | Compute device (`xpu`, `cuda`, `cpu`) |
| `-python` | `.venv/bin/python` | Python executable path |
| `-model` | `models/Stable-diffusion/juggernautXL_version2.safetensors` | Default checkpoint path |
| `-version` | `false` | Show version and exit |

---

## How It Works

```text
Browser (Web UI) ──HTTP/SSE──▶ Go Server (cmd + studio) ──stdin/stdout JSON──▶ Python Worker (engine/worker.py)
```

Go handles the web UI, model downloads, gallery, and ZIP exports; Python runs only when a model is loaded for inference.

---

## License

[MIT](LICENSE)
