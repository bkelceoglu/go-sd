package studio

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"go-sd/engine"
)

// Server coordinates HTTP routing, template rendering, and API execution.
type Server struct {
	manager    *engine.Manager
	exporter   *Exporter
	downloader *HFDownloader
	webDir     string
	outputDir string
	tmpl      *template.Template
}

// NewServer builds and configures a new Studio HTTP server.
func NewServer(mgr *engine.Manager, exp *Exporter, webDir, outDir string) (*Server, error) {
	tmplPath := filepath.Join(webDir, "templates", "layout.html")
	compPattern := filepath.Join(webDir, "templates", "components", "*.html")

	tmpl, err := template.ParseGlob(compPattern)
	if err != nil {
		return nil, fmt.Errorf("parsing template components failed: %w", err)
	}

	tmpl, err = tmpl.ParseFiles(tmplPath)
	if err != nil {
		return nil, fmt.Errorf("parsing layout template failed: %w", err)
	}

	rootDir := filepath.Dir(webDir)
	modelsDir := filepath.Join(rootDir, "models", "Stable-diffusion")
	downloader := NewHFDownloader(modelsDir)

	srv := &Server{
		manager:    mgr,
		exporter:   exp,
		downloader: downloader,
		webDir:     webDir,
		outputDir:  outDir,
		tmpl:       tmpl,
	}
	return srv, nil
}

// RegisterRoutes registers all studio endpoints with the given HTTP mux.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /", s.handleIndex)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/models", s.handleModelsList)
	mux.HandleFunc("POST /api/model/load", s.handleModelLoad)
	mux.HandleFunc("POST /api/model/unload", s.handleModelUnload)
	mux.HandleFunc("GET /api/presets", s.handlePresets)
	mux.HandleFunc("GET /api/gallery", s.handleGallery)
	mux.HandleFunc("POST /api/gallery/delete", s.handleGalleryDelete)
	mux.HandleFunc("DELETE /api/gallery", s.handleGalleryDelete)
	mux.HandleFunc("POST /api/generate", s.handleGenerate)
	mux.HandleFunc("POST /api/export", s.handleExport)
	mux.HandleFunc("GET /api/hf/search", s.handleHFSearch)
	mux.HandleFunc("POST /api/hf/download", s.handleHFDownload)
	mux.HandleFunc("GET /api/hf/download/status", s.handleHFDownloadStatus)
	mux.HandleFunc("POST /api/hf/download/cancel", s.handleHFDownloadCancel)
	mux.HandleFunc("GET /api/hf/model/info", s.handleHFModelInfo)

	// Static assets with no-cache headers for instant updates
	staticDir := filepath.Join(s.webDir, "static")
	fileServer := http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir)))
	mux.HandleFunc("GET /static/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		fileServer.ServeHTTP(w, r)
	})

	outputDir := s.outputDir
	mux.Handle("GET /output/", http.StripPrefix("/output/", http.FileServer(http.Dir(outputDir))))
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	// Parse on demand for instant template hot-reloading
	tmplPath := filepath.Join(s.webDir, "templates", "layout.html")
	compPattern := filepath.Join(s.webDir, "templates", "components", "*.html")
	if tmpl, err := template.ParseGlob(compPattern); err == nil {
		if tmpl, err = tmpl.ParseFiles(tmplPath); err == nil {
			_ = tmpl.ExecuteTemplate(w, "layout.html", nil)
			return
		}
	}

	_ = s.tmpl.ExecuteTemplate(w, "layout.html", nil)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	dev, model, ready := s.manager.GetInfo()
	cfg := s.manager.GetConfig()
	modelsDir := filepath.Dir(cfg.ModelPath)
	availableModels := s.manager.ScanAvailableModels(modelsDir)

	statusMsg := "Ready for inference"
	if !ready {
		statusMsg = "Standby / Model Unloaded"
		if dev == "" {
			dev = cfg.Device
		}
		if model == "" {
			model = filepath.Base(cfg.ModelPath)
		}
	}

	status := SystemStatus{
		Ready:           ready,
		Device:          dev,
		Model:           filepath.Base(model),
		StatusMsg:       statusMsg,
		AvailableModels: availableModels,
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleModelsList(w http.ResponseWriter, r *http.Request) {
	cfg := s.manager.GetConfig()
	modelsDir := filepath.Dir(cfg.ModelPath)
	models := s.manager.ScanAvailableModels(modelsDir)
	writeJSON(w, http.StatusOK, models)
}

func (s *Server) handleModelLoad(w http.ResponseWriter, r *http.Request) {
	log.Printf("[STUDIO HTTP] %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

	var req ModelLoadRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, hasFlusher := w.(http.Flusher)

	sendEvent := func(data any) {
		b, _ := json.Marshal(data)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
		if hasFlusher {
			flusher.Flush()
		}
	}

	targetModel := req.ModelPath
	if targetModel == "" {
		targetModel = s.manager.GetConfig().ModelPath
	}

	log.Printf("[STUDIO MODEL] Loading model: %s", targetModel)
	sendEvent(engine.ModelProgress{
		Status:     "loading",
		Percentage: 10,
		Message:    "Preparing Intel Arc GPU runtime...",
		Model:      filepath.Base(targetModel),
	})

	err := s.manager.LoadModel(r.Context(), targetModel, func(prog engine.ModelProgress) {
		log.Printf("[STUDIO MODEL LOAD] %d%% - %s", prog.Percentage, prog.Message)
		sendEvent(prog)
	})

	if err != nil {
		log.Printf("[STUDIO ERROR] Model load failed: %v", err)
		sendEvent(engine.ModelProgress{
			Status:  "error",
			Message: "Model load failed: " + err.Error(),
			Error:   err.Error(),
		})
		return
	}

	dev, model, _ := s.manager.GetInfo()
	log.Printf("[STUDIO SUCCESS] Model loaded successfully: %s on %s", model, dev)
}

func (s *Server) handleModelUnload(w http.ResponseWriter, r *http.Request) {
	log.Printf("[STUDIO HTTP] %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

	isStream := strings.Contains(r.Header.Get("Accept"), "text/event-stream") || r.URL.Query().Get("stream") == "true"
	if isStream {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		flusher, hasFlusher := w.(http.Flusher)

		sendEvent := func(data any) {
			b, _ := json.Marshal(data)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
			if hasFlusher {
				flusher.Flush()
			}
		}

		err := s.manager.UnloadModelWithProgress(r.Context(), func(prog engine.ModelProgress) {
			sendEvent(prog)
		})

		if err != nil {
			log.Printf("[STUDIO ERROR] Model unload failed: %v", err)
			sendEvent(engine.ModelProgress{
				Status:  "error",
				Message: "Model unload failed: " + err.Error(),
				Error:   err.Error(),
			})
			return
		}
		log.Printf("[STUDIO SUCCESS] Model unloaded and GPU/system memory released.")
		return
	}

	err := s.manager.UnloadModel()
	if err != nil {
		log.Printf("[STUDIO ERROR] Model unload failed: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	log.Printf("[STUDIO SUCCESS] Model unloaded and GPU/system memory released.")
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"status":  "unloaded",
		"message": "Model unloaded and VRAM released.",
	})
}

func (s *Server) handlePresets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, GetDefaultStylePresets())
}

func (s *Server) handleGallery(w http.ResponseWriter, r *http.Request) {
	imagesDir := filepath.Join(s.outputDir, "images")
	_ = os.MkdirAll(imagesDir, 0755)

	entries, err := os.ReadDir(imagesDir)
	if err != nil {
		writeJSON(w, http.StatusOK, []GeneratedImage{})
		return
	}

	var results []GeneratedImage
	for _, entry := range entries {
		if entry.IsDir() || !isImageFile(entry.Name()) {
			continue
		}
		item := s.fileToGeneratedImage(imagesDir, entry)
		results = append(results, item)
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].CreatedAt.After(results[j].CreatedAt)
	})

	writeJSON(w, http.StatusOK, results)
}

type DeleteGalleryRequest struct {
	Filenames []string `json:"filenames"`
}

func (s *Server) handleGalleryDelete(w http.ResponseWriter, r *http.Request) {
	log.Printf("[STUDIO HTTP] %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

	var req DeleteGalleryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if len(req.Filenames) == 0 {
		writeError(w, http.StatusBadRequest, "No filenames specified for deletion")
		return
	}

	imagesDir := filepath.Join(s.outputDir, "images")
	deleted := 0

	for _, rawFn := range req.Filenames {
		cleanFn := filepath.Base(filepath.Clean(rawFn))
		if cleanFn == "." || cleanFn == "/" || cleanFn == "" {
			continue
		}
		targetPath := filepath.Join(imagesDir, cleanFn)
		if err := os.Remove(targetPath); err == nil {
			deleted++
			log.Printf("[STUDIO DELETE] Removed artwork: %s", cleanFn)
		} else {
			log.Printf("[STUDIO WARNING] Could not remove %s: %v", cleanFn, err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":       true,
		"deleted_count": deleted,
	})
}

func (s *Server) handleGenerate(w http.ResponseWriter, r *http.Request) {
	log.Printf("[STUDIO HTTP] %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

	var req GenerationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[STUDIO ERROR] Invalid generation request JSON: %v", err)
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	log.Printf("[STUDIO GENERATE] New Job: Prompt=%q, Steps=%d, CFG=%.1f, Preset=%s, Batch=%d",
		req.Prompt, req.Steps, req.CFGScale, req.PresetID, req.BatchCount)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, hasFlusher := w.(http.Flusher)

	sendEvent := func(data any) {
		b, _ := json.Marshal(data)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
		if hasFlusher {
			flusher.Flush()
		}
	}

	batchCount := req.BatchCount
	if batchCount < 1 {
		batchCount = 1
	}
	if batchCount > 8 {
		batchCount = 8
	}

	imagesDir := filepath.Join(s.outputDir, "images")
	_ = os.MkdirAll(imagesDir, 0755)

	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	for i := 0; i < batchCount; i++ {
		img, err := s.generateSingleItemStreaming(r.Context(), req, imagesDir, rng, i, batchCount, sendEvent)
		if err != nil {
			log.Printf("[STUDIO ERROR] Generation failed: %v", err)
			sendEvent(map[string]any{"status": "error", "error": err.Error()})
			return
		}
		log.Printf("[STUDIO SUCCESS] Image %d/%d generated: %s in %.2fs", i+1, batchCount, img.Filename, img.ElapsedSeconds)
		sendEvent(map[string]any{
			"status":       "complete",
			"image":        img,
			"batch_index":  i + 1,
			"batch_total":  batchCount,
			"is_batch_end": (i == batchCount-1),
		})

		if i < batchCount-1 {
			time.Sleep(300 * time.Millisecond)
		}
	}
}

func (s *Server) generateSingleItemStreaming(
	ctx context.Context,
	req GenerationRequest,
	imagesDir string,
	rng *rand.Rand,
	index int,
	batchTotal int,
	sendEvent func(any),
) (*GeneratedImage, error) {
	expandedPrompt := ExpandWildcards(req.Prompt, rng)
	finalPos, finalNeg := BuildPrompt(expandedPrompt, req.PresetID)
	if req.NegativePrompt != "" {
		finalNeg = fmt.Sprintf("%s, %s", req.NegativePrompt, finalNeg)
	}

	seed := req.Seed
	if seed <= 0 {
		seed = rng.Int63n(2147483647)
	} else if index > 0 {
		seed = seed + int64(index)
	}

	filename := fmt.Sprintf("img_%d_%d.jpg", time.Now().UnixNano()/1000, index+1)
	outPath := filepath.Join(imagesDir, filename)

	jobReq := engine.JobRequest{
		ID:             fmt.Sprintf("job_%d", time.Now().UnixNano()),
		Prompt:         finalPos,
		NegativePrompt: finalNeg,
		Width:          req.Width,
		Height:         req.Height,
		Steps:          req.Steps,
		CFGScale:       req.CFGScale,
		Seed:           seed,
		OutputPath:     outPath,
	}

	res, err := s.manager.GenerateWithProgress(ctx, jobReq, func(prog engine.JobProgress) {
		log.Printf("[STUDIO STEP] %d/%d (%d%%) for %s (batch %d/%d)", prog.Step, prog.TotalSteps, prog.Percentage, jobReq.ID, index+1, batchTotal)
		sendEvent(map[string]any{
			"status":      prog.Status,
			"step":        prog.Step,
			"total_steps": prog.TotalSteps,
			"percentage":  prog.Percentage,
			"preview":     prog.Preview,
			"batch_index": index + 1,
			"batch_total": batchTotal,
			"prompt":      expandedPrompt,
		})
	})
	if err != nil {
		return nil, fmt.Errorf("rendering item failed: %w", err)
	}

	return &GeneratedImage{
		ID:             res.ID,
		Filename:       filename,
		URL:            fmt.Sprintf("/output/images/%s", filename),
		Prompt:         expandedPrompt,
		NegativePrompt: finalNeg,
		Seed:           seed,
		Width:          req.Width,
		Height:         req.Height,
		Steps:          req.Steps,
		CFGScale:       req.CFGScale,
		ElapsedSeconds: res.ElapsedSeconds,
		CreatedAt:      time.Now(),
	}, nil
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	var req ExportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid export request")
		return
	}

	if len(req.SelectedFiles) == 0 {
		writeError(w, http.StatusBadRequest, "No files selected for export")
		return
	}

	var absolutePaths []string
	for _, fn := range req.SelectedFiles {
		clean := filepath.Base(fn)
		imgPath := filepath.Join(s.outputDir, "images", clean)
		if _, err := os.Stat(imgPath); err == nil {
			absolutePaths = append(absolutePaths, imgPath)
		}
	}

	req.SelectedFiles = absolutePaths
	result, err := s.exporter.Export(req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) fileToGeneratedImage(dir string, entry os.DirEntry) GeneratedImage {
	info, _ := entry.Info()
	modTime := time.Now()
	if info != nil {
		modTime = info.ModTime()
	}

	return GeneratedImage{
		ID:             entry.Name(),
		Filename:       entry.Name(),
		URL:            fmt.Sprintf("/output/images/%s", entry.Name()),
		Prompt:         strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())),
		Width:          1024,
		Height:         1024,
		ElapsedSeconds: 20.0,
		CreatedAt:      modTime,
	}
}

func isImageFile(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".webp"
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}


func (s *Server) handleHFSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	res, err := s.downloader.Search(r.Context(), q, page, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleHFDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoID   string `json:"repo_id"`
		Filename string `json:"filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}
	if req.RepoID == "" || req.Filename == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "repo_id and filename are required"})
		return
	}
	if !strings.HasSuffix(strings.ToLower(req.Filename), ".safetensors") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "only .safetensors files can be downloaded"})
		return
	}

	task, err := s.downloader.StartDownload(req.RepoID, req.Filename)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, task)
}

func (s *Server) handleHFDownloadStatus(w http.ResponseWriter, r *http.Request) {
	tasks := s.downloader.GetTasks()
	writeJSON(w, http.StatusOK, tasks)
}

func (s *Server) handleHFDownloadCancel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TaskID string `json:"task_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}
	cancelled := s.downloader.CancelDownload(req.TaskID)
	writeJSON(w, http.StatusOK, map[string]bool{"cancelled": cancelled})
}

func (s *Server) handleHFModelInfo(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "model id is required"})
		return
	}
	info, err := s.downloader.GetModelInfo(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, info)
}
