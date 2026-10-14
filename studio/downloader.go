package studio

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// HFModelFile represents a downloadable safetensors or OpenVINO package in a HF repo.
type HFModelFile struct {
	Filename    string  `json:"filename"`
	DownloadURL string  `json:"download_url"`
	SizeGB      float64 `json:"size_gb,omitempty"`
	IsInstalled bool    `json:"is_installed"`
}

// HFModelItem represents a model candidate suitable for the studio.
type HFModelItem struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Author       string        `json:"author"`
	Downloads    int           `json:"downloads"`
	Likes        int           `json:"likes"`
	LastModified string        `json:"last_modified"`
	PipelineTag  string        `json:"pipeline_tag"`
	Engine       string        `json:"engine"`
	Files        []HFModelFile `json:"files"`
	IsInstalled  bool          `json:"is_installed"`
}

// HFModelDetail provides rich metadata when the user inspects a model.
type HFModelDetail struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Author      string   `json:"author"`
	BaseModel   string   `json:"base_model,omitempty"`
	License     string   `json:"license,omitempty"`
	PipelineTag string   `json:"pipeline_tag,omitempty"`
	Downloads   int      `json:"downloads"`
	Likes       int      `json:"likes"`
	Tags        []string `json:"tags,omitempty"`
	Summary     string   `json:"summary,omitempty"`
	HFURL       string   `json:"hf_url"`
}

// HFSearchResponse contains paginated model results.
type HFSearchResponse struct {
	Items      []HFModelItem `json:"items"`
	Page       int           `json:"page"`
	Limit      int           `json:"limit"`
	TotalFound int           `json:"total_found"`
	TotalPages int           `json:"total_pages"`
	HasPrev    bool          `json:"has_prev"`
	HasNext    bool          `json:"has_next"`
	Engine     string        `json:"engine"`
}

// DownloadTask tracks an in-progress or completed file download.
type DownloadTask struct {
	ID              string    `json:"id"`
	RepoID          string    `json:"repo_id"`
	Filename        string    `json:"filename"`
	Engine          string    `json:"engine"`
	Status          string    `json:"status"` // "downloading", "completed", "error", "cancelled"
	DownloadedBytes int64     `json:"downloaded_bytes"`
	TotalBytes      int64     `json:"total_bytes"`
	Percentage      int       `json:"percentage"`
	SpeedMBps       float64   `json:"speed_mbps"`
	ETASeconds      int       `json:"eta_seconds"`
	Error           string    `json:"error,omitempty"`
	StartTime       time.Time `json:"start_time"`
	cancelFunc      context.CancelFunc
}

// HFDownloader handles searching HuggingFace Hub and downloading models for both IPEX and OpenVINO.
type HFDownloader struct {
	mu          sync.RWMutex
	tasks       map[string]*DownloadTask
	modelsDir   string
	openvinoDir string
	httpClient  *http.Client
}

// NewHFDownloader creates a downloader supporting dual-engine model storage.
func NewHFDownloader(modelsDir string) *HFDownloader {
	_ = os.MkdirAll(modelsDir, 0755)
	ovDir := "models/OpenVINO"
	_ = os.MkdirAll(ovDir, 0755)
	return &HFDownloader{
		tasks:       make(map[string]*DownloadTask),
		modelsDir:   modelsDir,
		openvinoDir: ovDir,
		httpClient: &http.Client{
			Timeout: 0, // No timeout on file streaming downloads
		},
	}
}

// Search searches HuggingFace API for models compatible with the requested engine.
func (d *HFDownloader) Search(ctx context.Context, query string, page int, limit int, engine string) (*HFSearchResponse, error) {
	if engine == "" {
		engine = "ipex"
	}
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 50 {
		limit = 10
	}

	apiURL := d.buildSearchURL(query, engine)
	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request failed: %w", err)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hf api request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hf api error: status %d", resp.StatusCode)
	}

	var rawModels []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&rawModels); err != nil {
		return nil, fmt.Errorf("decoding hf response failed: %w", err)
	}

	filtered := d.filterCompatibleModels(rawModels, engine)
	totalFound := len(filtered)
	totalPages := (totalFound + limit - 1) / limit
	if totalPages == 0 {
		totalPages = 1
	}

	start := (page - 1) * limit
	if start > totalFound {
		start = totalFound
	}
	end := start + limit
	if end > totalFound {
		end = totalFound
	}

	pagedItems := filtered[start:end]

	// Populate exact file sizes concurrently for displayed items (safetensors only)
	if engine != "openvino" {
		d.populateFileSizes(ctx, pagedItems)
	}

	return &HFSearchResponse{
		Items:      pagedItems,
		Page:       page,
		Limit:      limit,
		TotalFound: totalFound,
		TotalPages: totalPages,
		HasPrev:    page > 1,
		HasNext:    page < totalPages,
		Engine:     engine,
	}, nil
}

func (d *HFDownloader) populateFileSizes(ctx context.Context, items []HFModelItem) {
	var wg sync.WaitGroup
	for i := range items {
		wg.Add(1)
		go func(itemIdx int) {
			defer wg.Done()
			repoID := items[itemIdx].ID
			treeURL := fmt.Sprintf("https://huggingface.co/api/models/%s/tree/main", repoID)

			req, err := http.NewRequestWithContext(ctx, "GET", treeURL, nil)
			if err != nil {
				return
			}
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Do(req)
			if err != nil || resp.StatusCode != http.StatusOK {
				if resp != nil {
					resp.Body.Close()
				}
				return
			}
			defer resp.Body.Close()

			var treeEntries []struct {
				Path string `json:"path"`
				Size int64  `json:"size"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&treeEntries); err != nil {
				return
			}

			sizeMap := make(map[string]float64)
			for _, entry := range treeEntries {
				if entry.Size > 0 {
					sizeGB := math.Round(float64(entry.Size)/(1024*1024*1024)*10) / 10
					sizeMap[entry.Path] = sizeGB
				}
			}

			for fIdx := range items[itemIdx].Files {
				fn := items[itemIdx].Files[fIdx].Filename
				if sz, exists := sizeMap[fn]; exists {
					items[itemIdx].Files[fIdx].SizeGB = sz
				}
			}
		}(i)
	}
	wg.Wait()
}

// GetModelInfo fetches rich details, license, and model card summary from HuggingFace.
func (d *HFDownloader) GetModelInfo(ctx context.Context, repoID string) (*HFModelDetail, error) {
	apiURL := fmt.Sprintf("https://huggingface.co/api/models/%s", repoID)
	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request failed: %w", err)
	}

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hf api request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hf api returned status %d", resp.StatusCode)
	}

	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decoding model info failed: %w", err)
	}

	author, name := d.splitRepoID(repoID)
	downloads, _ := raw["downloads"].(float64)
	likes, _ := raw["likes"].(float64)
	tag, _ := raw["pipeline_tag"].(string)

	var baseModel, license, summary string
	if cardData, ok := raw["cardData"].(map[string]any); ok {
		if lic, ok := cardData["license"].(string); ok {
			license = lic
		} else if licName, ok := cardData["license_name"].(string); ok {
			license = licName
		}
		if bm, ok := cardData["base_model"].(string); ok {
			baseModel = bm
		}
	}

	if desc, ok := raw["description"].(string); ok && desc != "" {
		summary = desc
	}

	var tags []string
	if rawTags, ok := raw["tags"].([]any); ok {
		for _, t := range rawTags {
			if ts, ok := t.(string); ok && !strings.HasPrefix(ts, "base_model:") && !strings.HasPrefix(ts, "region:") {
				tags = append(tags, ts)
				if len(tags) >= 8 {
					break
				}
			}
		}
	}

	return &HFModelDetail{
		ID:          repoID,
		Name:        name,
		Author:      author,
		BaseModel:   baseModel,
		License:     license,
		PipelineTag: tag,
		Downloads:   int(downloads),
		Likes:       int(likes),
		Tags:        tags,
		Summary:     summary,
		HFURL:       fmt.Sprintf("https://huggingface.co/%s", repoID),
	}, nil
}

func (d *HFDownloader) buildSearchURL(query string, engine string) string {
	q := strings.TrimSpace(query)
	if engine == "openvino" {
		if q == "" {
			return "https://huggingface.co/api/models?author=OpenVINO&filter=text-to-image&sort=downloads&direction=-1&limit=50&full=true"
		}
		return fmt.Sprintf("https://huggingface.co/api/models?search=%s&filter=text-to-image&limit=50&full=true", url.QueryEscape("openvino "+q))
	}

	// Default IPEX (.safetensors)
	if q == "" {
		return "https://huggingface.co/api/models?search=xl&filter=text-to-image,safetensors&sort=lastModified&direction=-1&limit=50&full=true"
	}
	return fmt.Sprintf("https://huggingface.co/api/models?search=%s&filter=text-to-image&limit=50&full=true", url.QueryEscape(q))
}

func (d *HFDownloader) filterCompatibleModels(rawList []map[string]any, engine string) []HFModelItem {
	seenIDs := make(map[string]bool)
	var items []HFModelItem

	for _, item := range rawList {
		id, _ := item["id"].(string)
		if id == "" || seenIDs[id] {
			continue
		}

		if d.isExcludedByTags(item) {
			continue
		}

		author, name := d.splitRepoID(id)
		downloads, _ := item["downloads"].(float64)
		likes, _ := item["likes"].(float64)
		lastMod, _ := item["lastModified"].(string)
		tag, _ := item["pipeline_tag"].(string)

		if engine == "openvino" {
			// For OpenVINO: models are repository packages with IR files
			isInstalled := d.checkOpenVINOInstalled(name)
			seenIDs[id] = true
			items = append(items, HFModelItem{
				ID:           id,
				Name:         name,
				Author:       author,
				Downloads:    int(downloads),
				Likes:        int(likes),
				LastModified: lastMod,
				PipelineTag:  tag,
				Engine:       "openvino",
				Files: []HFModelFile{
					{
						Filename:    name + " (OpenVINO IR Package)",
						DownloadURL: id,
						SizeGB:      6.5, // Standard SDXL IR package average
						IsInstalled: isInstalled,
					},
				},
				IsInstalled: isInstalled,
			})
		} else {
			// For IPEX: individual .safetensors checkpoints
			safetensorsFiles := d.extractSafetensorsFiles(id, item)
			if len(safetensorsFiles) == 0 {
				continue
			}

			seenIDs[id] = true
			allInstalled := true
			for _, f := range safetensorsFiles {
				if !f.IsInstalled {
					allInstalled = false
					break
				}
			}

			items = append(items, HFModelItem{
				ID:           id,
				Name:         name,
				Author:       author,
				Downloads:    int(downloads),
				Likes:        int(likes),
				LastModified: lastMod,
				PipelineTag:  tag,
				Engine:       "ipex",
				Files:        safetensorsFiles,
				IsInstalled:  allInstalled,
			})
		}
	}
	return items
}

func (d *HFDownloader) isExcludedByTags(item map[string]any) bool {
	tags, ok := item["tags"].([]any)
	if !ok {
		return false
	}
	for _, t := range tags {
		ts, _ := t.(string)
		tsLower := strings.ToLower(ts)
		if tsLower == "controlnet" || tsLower == "text-to-speech" {
			return true
		}
	}
	return false
}

func (d *HFDownloader) extractSafetensorsFiles(repoID string, item map[string]any) []HFModelFile {
	siblings, ok := item["siblings"].([]any)
	if !ok {
		return nil
	}

	var files []HFModelFile
	for _, s := range siblings {
		sm, ok := s.(map[string]any)
		if !ok {
			continue
		}
		filename, _ := sm["rfilename"].(string)
		if strings.HasSuffix(strings.ToLower(filename), ".safetensors") && !strings.Contains(filename, "/") {
			// Exclude tiny lora helper files if named specifically
			fnLower := strings.ToLower(filename)
			if strings.Contains(fnLower, "_lora") {
				continue
			}

			isInstalled := d.checkFileInstalled(filename)
			downloadURL := fmt.Sprintf("https://huggingface.co/%s/resolve/main/%s", repoID, filename)
			files = append(files, HFModelFile{
				Filename:    filename,
				DownloadURL: downloadURL,
				IsInstalled: isInstalled,
			})
		}
	}
	return files
}

func (d *HFDownloader) checkFileInstalled(filename string) bool {
	localPath := filepath.Join(d.modelsDir, filename)
	if _, err := os.Stat(localPath); err == nil {
		return true
	}
	return false
}

func (d *HFDownloader) checkOpenVINOInstalled(repoName string) bool {
	dir := filepath.Join(d.openvinoDir, repoName)
	if fi, err := os.Stat(dir); err == nil && fi.IsDir() {
		return true
	}
	return false
}

func (d *HFDownloader) splitRepoID(id string) (author, name string) {
	parts := strings.Split(id, "/")
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", id
}

// StartDownload starts an asynchronous background download of a model (IPEX file or OpenVINO snapshot).
func (d *HFDownloader) StartDownload(repoID, filename, engine string) (*DownloadTask, error) {
	taskKey := fmt.Sprintf("%s/%s", repoID, filename)

	d.mu.Lock()
	if existing, found := d.tasks[taskKey]; found && existing.Status == "downloading" {
		d.mu.Unlock()
		return existing, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	task := &DownloadTask{
		ID:         taskKey,
		RepoID:     repoID,
		Filename:   filename,
		Engine:     engine,
		Status:     "downloading",
		StartTime:  time.Now(),
		cancelFunc: cancel,
	}
	d.tasks[taskKey] = task
	d.mu.Unlock()

	if engine == "openvino" {
		go d.executeOpenVINODownload(ctx, task)
	} else {
		go d.executeDownload(ctx, task)
	}
	return task, nil
}

func (d *HFDownloader) executeOpenVINODownload(ctx context.Context, task *DownloadTask) {
	_, repoName := d.splitRepoID(task.RepoID)
	destDir := filepath.Join(d.openvinoDir, repoName)
	_ = os.MkdirAll(destDir, 0755)

	log.Printf("[HF OPENVINO DOWNLOAD] Starting snapshot_download for %s to %s", task.RepoID, destDir)
	task.Percentage = 15

	pyScript := fmt.Sprintf(`
from huggingface_hub import snapshot_download
import sys
snapshot_download(repo_id="%s", local_dir="%s", ignore_patterns=["*.pt", "*.bin.tmp", "*.onnx"])
print("SUCCESS")
`, task.RepoID, destDir)

	cmd := exec.CommandContext(ctx, "python3", "-c", pyScript)
	out, err := cmd.CombinedOutput()

	d.mu.Lock()
	defer d.mu.Unlock()

	if err != nil {
		task.Status = "error"
		task.Error = fmt.Sprintf("snapshot_download failed: %v, output: %s", err, string(out))
		log.Printf("[HF OPENVINO ERROR] %s: %s", task.RepoID, task.Error)
		return
	}

	task.Status = "completed"
	task.Percentage = 100
	log.Printf("[HF OPENVINO DOWNLOAD COMPLETE] %s saved to %s", task.RepoID, destDir)
}

func (d *HFDownloader) executeDownload(ctx context.Context, task *DownloadTask) {
	downloadURL := fmt.Sprintf("https://huggingface.co/%s/resolve/main/%s", task.RepoID, task.Filename)
	destPath := filepath.Join(d.modelsDir, task.Filename)
	tmpPath := destPath + ".tmp"

	log.Printf("[HF DOWNLOAD] Starting download of %s from %s", task.Filename, downloadURL)

	req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
	if err != nil {
		d.failTask(task, tmpPath, fmt.Sprintf("request init failed: %v", err))
		return
	}

	resp, err := d.httpClient.Do(req)
	if err != nil {
		d.failTask(task, tmpPath, fmt.Sprintf("download connection failed: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		d.failTask(task, tmpPath, fmt.Sprintf("download returned status %d", resp.StatusCode))
		return
	}

	task.TotalBytes = resp.ContentLength
	out, err := os.Create(tmpPath)
	if err != nil {
		d.failTask(task, tmpPath, fmt.Sprintf("creating temp file failed: %v", err))
		return
	}
	defer out.Close()

	buf := make([]byte, 1024*1024) // 1MB buffer
	var downloaded int64
	startTime := time.Now()

	for {
		select {
		case <-ctx.Done():
			d.failTask(task, tmpPath, "download cancelled by user")
			return
		default:
		}

		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := out.Write(buf[:n]); wErr != nil {
				d.failTask(task, tmpPath, fmt.Sprintf("write error: %v", wErr))
				return
			}
			downloaded += int64(n)
			d.updateTaskProgress(task, downloaded, startTime)
		}

		if rErr != nil {
			if rErr == io.EOF {
				break
			}
			d.failTask(task, tmpPath, fmt.Sprintf("read error: %v", rErr))
			return
		}
	}

	_ = out.Close()
	if err := os.Rename(tmpPath, destPath); err != nil {
		d.failTask(task, tmpPath, fmt.Sprintf("renaming file failed: %v", err))
		return
	}

	d.mu.Lock()
	task.Status = "completed"
	task.Percentage = 100
	task.DownloadedBytes = task.TotalBytes
	d.mu.Unlock()

	log.Printf("[HF DOWNLOAD COMPLETE] %s saved to %s", task.Filename, destPath)
}

func (d *HFDownloader) updateTaskProgress(task *DownloadTask, downloaded int64, startTime time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()

	task.DownloadedBytes = downloaded
	if task.TotalBytes > 0 {
		task.Percentage = int(float64(downloaded) / float64(task.TotalBytes) * 100)
	}

	elapsed := time.Since(startTime).Seconds()
	if elapsed > 0.5 {
		speed := (float64(downloaded) / (1024 * 1024)) / elapsed
		task.SpeedMBps = float64(int(speed*10)) / 10
		if speed > 0 && task.TotalBytes > downloaded {
			remainingMB := float64(task.TotalBytes-downloaded) / (1024 * 1024)
			task.ETASeconds = int(remainingMB / speed)
		}
	}
}

func (d *HFDownloader) failTask(task *DownloadTask, tmpPath, errMsg string) {
	d.mu.Lock()
	task.Status = "error"
	task.Error = errMsg
	d.mu.Unlock()

	_ = os.Remove(tmpPath)
	log.Printf("[HF DOWNLOAD ERROR] %s: %s", task.Filename, errMsg)
}

// CancelDownload cancels a currently downloading task.
func (d *HFDownloader) CancelDownload(taskID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()

	task, found := d.tasks[taskID]
	if !found || task.Status != "downloading" {
		return false
	}
	if task.cancelFunc != nil {
		task.cancelFunc()
	}
	task.Status = "cancelled"
	return true
}

// GetTasks returns a list of all current and recently completed download tasks.
func (d *HFDownloader) GetTasks() []*DownloadTask {
	d.mu.RLock()
	defer d.mu.RUnlock()

	list := make([]*DownloadTask, 0, len(d.tasks))
	for _, t := range d.tasks {
		list = append(list, t)
	}
	return list
}
