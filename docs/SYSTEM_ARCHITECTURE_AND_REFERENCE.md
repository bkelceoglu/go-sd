# GO-SD STUDIO & AGENTIC ETSY — SYSTEM ARCHITECTURE & SOURCE OF TRUTH

> **Status:** Production-Ready Verified (October 2026)  
> **Repository:** `/home/caveman/codes/agentic_etsy`  
> **Local Git Origin:** `/home/caveman/codes/agentic_etsy.git` (Branch: `main`)  
> **Binary Path:** `/home/caveman/codes/agentic_etsy/go-sd/bin/go-sd`  

---

## 1. System Overview & Core Principles

**GO-SD Studio** is a commercial digital art production platform and multi-platform storefront packager. It is engineered with high-efficiency architecture:

1. **Pure Go Orchestrator (`go-sd/`):**
   - Fast, resilient HTTP daemon (<5ms boot, <10MB RAM).
   - Manages subprocess lifecycle, SSE event streaming, dynamic parameters, multi-format export packaging.
2. **Headless Micro-Worker (`engine/worker.py`):**
   - Private Python daemon communicating purely over `stdin/stdout` JSON-RPC.
   - Zero Gradio, zero WebUI, zero external HTTP dependencies.
   - Runs directly on **Intel Arc GPU (`xpu`)** via Intel Extension for PyTorch (`IPEX`) using `bfloat16`.
3. **On-Demand Standby (Zero VRAM on Boot):**
   - Server boots instantly into standby mode.
   - Checkpoint models are loaded on-demand via the web UI (`⚡ Load Model`).
4. **100% GPU VRAM & Memory Reclamation:**
   - Unloading (`🧹 Unload`) deletes the pipeline, purges IPEX allocator cache (`torch.xpu.empty_cache()`), runs garbage collection, and terminates the subprocess.
   - Guaranteed full memory release back to Linux unified memory without requiring `sudo`.
5. **Real-Time Progress Everywhere:**
   - Live progress bars with percentage and milestones for **Model Load**, **Model Unload**, **Hot-Swap/Switch**, and **Step-by-step Generation Preview**.

---

## 2. Directory Structure & Key Files

```
/home/caveman/codes/agentic_etsy/
├── .git/                                   # Local Git Repository
├── .gitignore                              # Clean build/output filters
├── SYSTEM_ARCHITECTURE_AND_REFERENCE.md    # THIS SOURCE OF TRUTH
├── go-sd/                                  # Production Application
│   ├── cmd/
│   │   └── main.go                         # Server boot, CLI flags, graceful shutdown
│   ├── engine/
│   │   ├── types.go                        # Engine data structures (JobRequest, ModelProgress, etc.)
│   │   ├── manager.go                      # Subprocess orchestrator, LoadModel/UnloadModel SSE streaming
│   │   ├── manager_test.go                 # Engine unit tests
│   │   └── worker.py                       # Headless Diffusers worker (Intel Arc XPU, IPEX, Euler-A)
│   ├── studio/
│   │   ├── types.go                        # Studio types (SystemStatus, GenerationRequest, BundleExport)
│   │   ├── server.go                       # HTTP router, SSE handlers, REST APIs
│   │   ├── parameters.go                   # 17 Commercial Style Presets & combinatorial prompts
│   │   └── exporter.go                     # Packaging engine: Etsy CSV, Gumroad, Shopify, Mockups, ZIP
│   ├── web/
│   │   ├── templates/
│   │   │   ├── layout.html                 # HTML shell, asset versions
│   │   │   └── components/
│   │   │       ├── header.html             # Brand, device status, gear button, quick load/unload, progress strip
│   │   │       ├── generator_panel.html    # Prompts, 17 presets, dimension pills, batch, sliders
│   │   │       ├── gallery_panel.html      # Asset showcase, multi-select, delete, export button
│   │   │       ├── model_modal.html        # Model & GPU Memory Manager modal, dropdown, progress bar
│   │   │       ├── export_modal.html       # Storefront bundle packager modal
│   │   │       └── lightbox.html           # Full-screen preview & metadata inspector
│   │   └── static/
│   │       ├── css/                        # Modular CSS (variables, base, layout, components, modal, animations)
│   │       └── js/                         # ES6 modules (api, state, model_manager, generator, gallery, exporter, lightbox, app)
│   └── output/
│       ├── images/                         # Rendered JPEG/PNG artworks (.gitkeep preserved)
│       └── bundles/                        # Packaged ZIP archives and listing CSVs (.gitkeep preserved)
└── /home/caveman/codes/agentic_etsy.git/    # Local Bare Git Origin
```

---

## 3. Environment & Hardware Specs

| Component | Verified Local Path / Setting |
| :--- | :--- |
| **Operating System** | Linux x86_64 |
| **GPU Hardware** | Intel Arc Graphics (Driver: i915 / Xe) |
| **PyTorch Device** | `torch.xpu` (Intel Extension for PyTorch - IPEX) |
| **Precision** | `torch.bfloat16` with VAE Tiling & Attention Slicing |
| **Python Venv** | `.venv/bin/python` |
| **Default Checkpoint** | `models/Stable-diffusion/juggernautXL_version2.safetensors` (6.5 GB) |
| **Scheduler** | `EulerAncestralDiscreteScheduler` (Euler-A) |
| **Go Compiler** | `/usr/local/go/bin/go` (Go 1.27+) |
| **Default Web Port** | `8080` (CLI flag `-port 8080`) |

---

## 4. API Endpoints Specification

| Method | Path | Query / Body | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | — | Serves studio HTML workspace |
| `GET` | `/api/status` | — | Returns `{ ready, device, model, status_msg, available_models }` |
| `GET` | `/api/models` | — | Scans & returns detected `.safetensors` checkpoints with file sizes |
| `POST` | `/api/model/load` | JSON `{ model_path: "..." }` | **SSE Stream:** Emits milestone progress (10% -> 20% -> 30% -> 75% -> 90% -> 100%) |
| `POST` | `/api/model/unload` | Optional `?stream=true` | **SSE / JSON:** Emits unload milestones and purges GPU/system memory |
| `GET` | `/api/presets` | — | Returns 17 commercial style presets |
| `POST` | `/api/generate` | JSON `GenerationRequest` | **SSE Stream:** Step progress, base64 latent preview, completed image |
| `GET` | `/api/gallery` | — | Returns all generated images sorted newest first |
| `POST` | `/api/gallery/delete`| JSON `{ filenames: [...] }` | Deletes selected artworks |
| `POST` | `/api/export` | JSON `ExportRequest` | Creates commercial bundle ZIP with Etsy CSV, mockups & license |

---

## 5. Model Lifecycle Rules & Workflow

### A. Boot State (Standby)
- Server boots with `ready = false`.
- Header shows: `Standby: XPU` and `Standby (No Model)`.
- Action button shows: `⚡ Load Model`.
- Generator button shows: `⚡ Load Model to Generate`. Clicking generate while standby triggers the model manager modal.

### B. Loading a Model
- User clicks `⚡ Load Model` or selects a model from the modal.
- `POST /api/model/load` streams milestones:
  - `10%`: Preparing Intel Arc GPU runtime
  - `20%`: Spawning diffusion worker on XPU
  - `30%`: Reading safetensors checkpoint & components
  - `75%`: Transferring UNet & VAE pipeline to XPU
  - `90%`: Configuring VAE tiling & attention slicing
  - `100%`: Model loaded successfully on XPU
- UI updates: status becomes `Online: XPU`, action button switches to `🧹 Unload`, generator button unlocks (`✨ Generate Artwork`).

### C. Unloading a Model (Memory Cleanup)
- User clicks `🧹 Unload`.
- Worker cleans `pipe`, invokes `torch.xpu.empty_cache()` and `gc.collect()`.
- Manager terminates worker process.
- 100% GPU unified memory is reclaimed by the Linux kernel.
- UI reverts to standby mode.

### D. Model Hot-Swap (Switching Models)
- If user selects model B while model A is loaded:
- Backend **automatically unloads model A first** (`10% - Releasing previous model from memory...`), kills the old worker, then launches the new worker for model B.

---

## 6. Git Repository & Rollback Instructions

### Local Repositories
- **Working Tree:** `/home/caveman/codes/agentic_etsy`
- **Bare Upstream Origin:** `/home/caveman/codes/agentic_etsy.git`
- **Branch:** `main`

### Routine Git Commands
```bash
# Check status
cd /home/caveman/codes/agentic_etsy
git status

# Commit changes
git add .
git commit -m "your descriptive commit message"

# Push to local bare repo
git push origin main

# View history
git log --oneline -n 10
```

### Rollback / Revert Procedure
```bash
# To rollback uncommitted changes:
git restore .
git clean -fd

# To roll back to a specific commit:
git checkout <commit-hash>
# Or create a recovery branch:
git checkout -b recovery-branch <commit-hash>
```

---

## 7. How to Compile and Run

```bash
cd /home/caveman/codes/agentic_etsy/go-sd

# Build production binary
/usr/local/go/bin/go build -o bin/go-sd cmd/main.go

# Run server on port 8080
./bin/go-sd -port 8080

# In browser, navigate to:
http://localhost:8080
```
