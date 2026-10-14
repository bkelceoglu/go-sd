package engine

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Manager supervises the lifecycle of the headless diffusion micro-worker (IPEX or OpenVINO).
type Manager struct {
	config    Config
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    *bufio.Reader
	mu        sync.Mutex
	isReady   bool
	device    string
	modelName string
}

// NewManager creates and initializes a new embedded engine manager.
func NewManager(cfg Config) *Manager {
	if cfg.ActiveEngine == "" {
		cfg.ActiveEngine = "ipex"
	}
	if cfg.OpenVINOPythonPath == "" {
		cfg.OpenVINOPythonPath = "/usr/bin/python3"
	}
	if cfg.OpenVINOWorker == "" {
		cfg.OpenVINOWorker = "engine/openvino_worker.py"
	}
	return &Manager{
		config: cfg,
	}
}

// Start launches the worker subprocess and waits for the model ready signal.
func (m *Manager) Start(ctx context.Context) error {
	return m.LoadModel(ctx, m.config.ModelPath, nil)
}

// LoadModel loads a model using the currently active engine.
func (m *Manager) LoadModel(ctx context.Context, modelPath string, onProgress func(ModelProgress)) error {
	m.mu.Lock()
	engineType := m.config.ActiveEngine
	m.mu.Unlock()
	return m.LoadModelWithEngine(ctx, modelPath, engineType, onProgress)
}

// LoadModelWithEngine starts or switches the worker subprocess with the specified model and engine ("ipex" | "openvino").
func (m *Manager) LoadModelWithEngine(ctx context.Context, modelPath string, engineType string, onProgress func(ModelProgress)) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if engineType == "" {
		engineType = "ipex"
	}
	m.config.ActiveEngine = engineType

	if modelPath != "" {
		m.config.ModelPath = modelPath
	}

	// If currently running, terminate and release old model first
	if m.cmd != nil && m.cmd.Process != nil {
		if onProgress != nil {
			onProgress(ModelProgress{
				Status:     "unloading",
				Percentage: 10,
				Message:    "Releasing previous model from memory...",
				Engine:     engineType,
			})
		}
		_ = m.terminateSubprocess()
	}

	var pythonBin, scriptPath, targetDev string
	if engineType == "openvino" {
		pythonBin = m.config.OpenVINOPythonPath
		if pythonBin == "" {
			pythonBin = "/usr/bin/python3"
		}
		scriptPath = m.config.OpenVINOWorker
		if scriptPath == "" {
			scriptPath = "engine/openvino_worker.py"
		}
		targetDev = "GPU"
		if onProgress != nil {
			onProgress(ModelProgress{
				Status:     "loading",
				Percentage: 20,
				Message:    "Initializing OpenVINO GenAI runtime (Intel Arc XMX)...",
				Model:      filepath.Base(m.config.ModelPath),
				Engine:     "openvino",
			})
		}
	} else {
		pythonBin = m.config.PythonPath
		if pythonBin == "" {
			pythonBin = "python3"
		}
		scriptPath = m.config.WorkerScript
		if scriptPath == "" {
			scriptPath = "engine/worker.py"
		}
		targetDev = m.config.Device
		if onProgress != nil {
			onProgress(ModelProgress{
				Status:     "loading",
				Percentage: 20,
				Message:    "Spawning PyTorch IPEX worker on " + targetDev + "...",
				Model:      filepath.Base(m.config.ModelPath),
				Engine:     "ipex",
			})
		}
	}

	args := []string{scriptPath, "--model", m.config.ModelPath}
	if targetDev != "" {
		args = append(args, "--device", targetDev)
	}

	cmd := exec.Command(pythonBin, args...)
	cmd.Stderr = os.Stderr

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("creating stdin pipe failed: %w", err)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return fmt.Errorf("creating stdout pipe failed: %w", err)
	}

	if err := cmd.Start(); err != nil {
		stdin.Close()
		stdoutPipe.Close()
		return fmt.Errorf("launching %s worker process failed: %w", engineType, err)
	}

	m.cmd = cmd
	m.stdin = stdin
	m.stdout = bufio.NewReader(stdoutPipe)

	return m.awaitReadySignalWithProgress(ctx, onProgress)
}

func (m *Manager) awaitReadySignalWithProgress(ctx context.Context, onProgress func(ModelProgress)) error {
	readyChan := make(chan error, 1)

	go func() {
		for {
			line, err := m.stdout.ReadString('\n')
			if err != nil {
				readyChan <- fmt.Errorf("reading worker stdout failed: %w", err)
				return
			}
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var raw map[string]any
			if err := json.Unmarshal([]byte(line), &raw); err != nil {
				continue
			}

			status, _ := raw["status"].(string)
			if status == "loading" {
				var prog ModelProgress
				if err := json.Unmarshal([]byte(line), &prog); err == nil && onProgress != nil {
					onProgress(prog)
				}
				continue
			}

			if status == "ready" {
				m.isReady = true
				if dev, ok := raw["device"].(string); ok {
					m.device = dev
				}
				if mdl, ok := raw["model"].(string); ok {
					m.modelName = mdl
				}
				if onProgress != nil {
					var prog ModelProgress
					_ = json.Unmarshal([]byte(line), &prog)
					onProgress(prog)
				}
				readyChan <- nil
				return
			}

			if status == "error" {
				errMsg, _ := raw["error"].(string)
				if errMsg == "" {
					errMsg, _ = raw["message"].(string)
				}
				readyChan <- fmt.Errorf("worker failed: %s", errMsg)
				return
			}
		}
	}()

	select {
	case err := <-readyChan:
		return err
	case <-time.After(120 * time.Second):
		_ = m.terminateSubprocess()
		return errors.New("timeout waiting for worker ready signal")
	case <-ctx.Done():
		_ = m.terminateSubprocess()
		return ctx.Err()
	}
}

// UnloadModel unloads any active model and flushes VRAM to 0 MB.
func (m *Manager) UnloadModel() error {
	return m.UnloadModelWithProgress(context.Background(), nil)
}

// UnloadModelWithProgress unloads the active model and streams reclamation progress.
func (m *Manager) UnloadModelWithProgress(ctx context.Context, onProgress func(ModelProgress)) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.cmd == nil || m.cmd.Process == nil {
		if onProgress != nil {
			onProgress(ModelProgress{
				Status:     "unloaded",
				Percentage: 100,
				Message:    "Engine is already in Standby (0 MB VRAM)",
			})
		}
		return nil
	}

	if onProgress != nil {
		onProgress(ModelProgress{
			Status:     "unloading",
			Percentage: 20,
			Message:    "Sending unload signal to diffusion worker...",
		})
	}

	if m.stdin != nil {
		exitReq := JobRequest{Command: "unload"}
		b, _ := json.Marshal(exitReq)
		_, _ = m.stdin.Write(append(b, '\n'))
		_ = m.stdin.Close()
	}

	if onProgress != nil {
		onProgress(ModelProgress{
			Status:     "unloading",
			Percentage: 60,
			Message:    "Purging Intel Arc GPU memory & releasing pipeline...",
		})
	}

	if m.cmd != nil && m.cmd.Process != nil {
		done := make(chan error, 1)
		go func() { done <- m.cmd.Wait() }()

		select {
		case <-time.After(1500 * time.Millisecond):
			_ = m.cmd.Process.Kill()
		case <-done:
		}
	}

	m.cmd = nil
	m.stdin = nil
	m.stdout = nil
	m.isReady = false

	if onProgress != nil {
		onProgress(ModelProgress{
			Status:     "unloaded",
			Percentage: 100,
			Message:    "Model unloaded successfully. 0 MB VRAM reserved.",
		})
	}

	return nil
}

// GenerateWithProgress sends a job request and streams progress updates.
func (m *Manager) GenerateWithProgress(
	ctx context.Context,
	req JobRequest,
	onProgress func(JobProgress),
) (*JobResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.isReady || m.cmd == nil || m.cmd.Process == nil {
		return nil, errors.New("model is not loaded in memory; please click 'Load Model' to activate engine")
	}

	reqBytes, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshaling job request failed: %w", err)
	}

	// Write JSON line to worker stdin
	if _, err := m.stdin.Write(append(reqBytes, '\n')); err != nil {
		m.isReady = false
		return nil, fmt.Errorf("writing to worker stdin failed: %w", err)
	}

	// Watch for context cancellation during generation
	stopWatch := make(chan struct{})
	defer close(stopWatch)

	go func() {
		select {
		case <-ctx.Done():
			m.mu.Lock()
			_ = m.terminateSubprocess()
			m.mu.Unlock()
		case <-stopWatch:
		}
	}()

	for {
		line, err := m.stdout.ReadString('\n')
		if err != nil {
			m.isReady = false
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if errors.Is(err, io.EOF) {
				return nil, errors.New("worker process terminated unexpectedly")
			}
			return nil, fmt.Errorf("reading worker output failed: %w", err)
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var raw map[string]any
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		status, _ := raw["status"].(string)
		if status == "progress" {
			var prog JobProgress
			if err := json.Unmarshal([]byte(line), &prog); err == nil && onProgress != nil {
				onProgress(prog)
			}
			continue
		}

		if status == "success" || status == "error" {
			var res JobResult
			if err := json.Unmarshal([]byte(line), &res); err != nil {
				return nil, fmt.Errorf("unmarshaling worker output failed: %w", err)
			}
			if res.Status == "error" {
				return &res, fmt.Errorf("worker generation error: %s", res.Error)
			}
			res.Engine = m.config.ActiveEngine
			return &res, nil
		}
	}
}

// Generate sends a job request to the worker without progress callbacks.
func (m *Manager) Generate(ctx context.Context, req JobRequest) (*JobResult, error) {
	return m.GenerateWithProgress(ctx, req, nil)
}

// Ping checks if the worker is responsive.
func (m *Manager) Ping(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.isReady || m.stdin == nil {
		return errors.New("worker is not running")
	}

	pingReq := JobRequest{Command: "ping"}
	reqBytes, _ := json.Marshal(pingReq)
	if _, err := m.stdin.Write(append(reqBytes, '\n')); err != nil {
		m.isReady = false
		return err
	}

	line, err := m.stdout.ReadString('\n')
	if err == nil {
		var res JobResult
		if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &res); err == nil && res.Status == "pong" {
			return nil
		}
	}
	return errors.New("ping response invalid")
}

// Close gracefully terminates the worker.
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	return m.terminateSubprocess()
}

func (m *Manager) terminateSubprocess() error {
	m.isReady = false
	if m.stdin != nil {
		exitReq := JobRequest{Command: "unload"}
		b, _ := json.Marshal(exitReq)
		_, _ = m.stdin.Write(append(b, '\n'))
		_ = m.stdin.Close()
	}

	if m.cmd != nil && m.cmd.Process != nil {
		done := make(chan error, 1)
		go func() { done <- m.cmd.Wait() }()

		select {
		case <-time.After(2 * time.Second):
			_ = m.cmd.Process.Kill()
		case <-done:
		}
	}
	m.cmd = nil
	m.stdin = nil
	m.stdout = nil
	return nil
}

// GetInfo returns the current active device, model name, and engine.
func (m *Manager) GetInfo() (device string, model string, isReady bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.device, m.modelName, m.isReady && m.cmd != nil && m.cmd.Process != nil
}

// GetActiveEngine returns the current engine ("ipex" or "openvino").
func (m *Manager) GetActiveEngine() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.config.ActiveEngine == "" {
		return "ipex"
	}
	return m.config.ActiveEngine
}

// GetConfig returns the manager's current configuration.
func (m *Manager) GetConfig() Config {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.config
}

// ScanAvailableModels detects checkpoints based on the engineFilter ("ipex", "openvino", or "" for all).
func (m *Manager) ScanAvailableModels(modelsDir string, engineFilter string) []ModelInfo {
	m.mu.Lock()
	activePath := m.config.ModelPath
	isReady := m.isReady && m.cmd != nil && m.cmd.Process != nil
	activeEngine := m.config.ActiveEngine
	m.mu.Unlock()

	models := make([]ModelInfo, 0)
	seenPaths := make(map[string]bool)

	// 1. Scan IPEX (.safetensors) models if filter is empty or "ipex"
	if engineFilter == "" || engineFilter == "all" || engineFilter == "ipex" {
		searchDirs := []string{modelsDir, "models/Stable-diffusion", "models"}
		for _, dir := range searchDirs {
			if dir == "" {
				continue
			}
			if _, err := os.Stat(dir); os.IsNotExist(err) {
				continue
			}
			_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
				if err != nil || info == nil || info.IsDir() {
					return nil
				}
				// Skip OpenVINO folder when scanning safetensors
				if strings.Contains(path, "models/OpenVINO") {
					return nil
				}
				if strings.HasSuffix(strings.ToLower(info.Name()), ".safetensors") {
					absPath, err := filepath.Abs(path)
					if err != nil {
						absPath = path
					}
					if seenPaths[absPath] {
						return nil
					}
					seenPaths[absPath] = true

					name := strings.TrimSuffix(info.Name(), ".safetensors")
					fileSize := info.Size()
					if fi, err := os.Stat(path); err == nil && fi != nil {
						fileSize = fi.Size()
					}
					sizeGB := float64(fileSize) / (1024 * 1024 * 1024)
					models = append(models, ModelInfo{
						Name:     name,
						Filename: info.Name(),
						Path:     absPath,
						SizeGB:   math.Round(sizeGB*10) / 10,
						IsActive: absPath == activePath && isReady && activeEngine == "ipex",
						Engine:   "ipex",
					})
				}
				return nil
			})
		}
	}

	// 2. Scan OpenVINO models if filter is empty or "openvino"
	if engineFilter == "" || engineFilter == "all" || engineFilter == "openvino" {
		ovDir := "models/OpenVINO"
		if entries, err := os.ReadDir(ovDir); err == nil {
			for _, entry := range entries {
				fullPath := filepath.Join(ovDir, entry.Name())
				absPath, err := filepath.Abs(fullPath)
				if err != nil {
					absPath = fullPath
				}

				if entry.IsDir() {
					// Check if this directory contains OpenVINO files (.xml or model_index.json)
					hasXML := false
					var totalBytes int64 = 0
					_ = filepath.Walk(fullPath, func(p string, fi os.FileInfo, e error) error {
						if e == nil && fi != nil && !fi.IsDir() {
							totalBytes += fi.Size()
							if strings.HasSuffix(strings.ToLower(fi.Name()), ".xml") || fi.Name() == "model_index.json" {
								hasXML = true
							}
						}
						return nil
					})

					if hasXML && !seenPaths[absPath] {
						seenPaths[absPath] = true
						sizeGB := float64(totalBytes) / (1024 * 1024 * 1024)
						models = append(models, ModelInfo{
							Name:     entry.Name(),
							Filename: entry.Name(),
							Path:     absPath,
							SizeGB:   math.Round(sizeGB*10) / 10,
							IsActive: absPath == activePath && isReady && activeEngine == "openvino",
							Engine:   "openvino",
						})
					}
				} else if strings.HasSuffix(strings.ToLower(entry.Name()), ".xml") {
					// Loose single XML model
					if !seenPaths[absPath] {
						seenPaths[absPath] = true
						fi, _ := entry.Info()
						var sz int64 = 0
						if fi != nil {
							sz = fi.Size()
						}
						sizeGB := float64(sz) / (1024 * 1024 * 1024)
						name := strings.TrimSuffix(entry.Name(), ".xml")
						models = append(models, ModelInfo{
							Name:     name,
							Filename: entry.Name(),
							Path:     absPath,
							SizeGB:   math.Round(sizeGB*10) / 10,
							IsActive: absPath == activePath && isReady && activeEngine == "openvino",
							Engine:   "openvino",
						})
					}
				}
			}
		}
	}

	return models
}
