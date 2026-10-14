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

// Manager supervises the lifecycle of the headless diffusion micro-worker.
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
	return &Manager{
		config: cfg,
	}
}

// Start launches the worker subprocess and waits for the model ready signal.
func (m *Manager) Start(ctx context.Context) error {
	return m.LoadModel(ctx, m.config.ModelPath, nil)
}

// LoadModel starts or switches the worker subprocess with the specified model path.
func (m *Manager) LoadModel(ctx context.Context, modelPath string, onProgress func(ModelProgress)) error {
	m.mu.Lock()
	defer m.mu.Unlock()

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
			})
		}
		_ = m.terminateSubprocess()
	}

	if onProgress != nil {
		onProgress(ModelProgress{
			Status:     "loading",
			Percentage: 20,
			Message:    "Spawning diffusion worker on " + m.config.Device + "...",
			Model:      filepath.Base(m.config.ModelPath),
		})
	}

	args := []string{m.config.WorkerScript, "--model", m.config.ModelPath}
	if m.config.Device != "" {
		args = append(args, "--device", m.config.Device)
	}

	cmd := exec.Command(m.config.PythonPath, args...)
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
		return fmt.Errorf("launching worker process failed: %w", err)
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
			pctFloat, _ := raw["percentage"].(float64)
			pct := int(pctFloat)
			msg, _ := raw["message"].(string)

			if status == "loading" {
				if onProgress != nil {
					onProgress(ModelProgress{
						Status:     "loading",
						Percentage: pct,
						Message:    msg,
						Model:      filepath.Base(m.config.ModelPath),
						Device:     m.config.Device,
					})
				}
				continue
			}

			if status == "ready" {
				m.isReady = true
				m.device, _ = raw["device"].(string)
				m.modelName, _ = raw["model"].(string)
				if onProgress != nil {
					onProgress(ModelProgress{
						Status:     "ready",
						Percentage: 100,
						Message:    "Model loaded successfully on " + m.device,
						Model:      filepath.Base(m.modelName),
						Device:     m.device,
					})
				}
				readyChan <- nil
				return
			}

			if status == "fatal_error" {
				errMsg, _ := raw["error"].(string)
				readyChan <- fmt.Errorf("worker error: %s", errMsg)
				return
			}
		}
	}()

	select {
	case <-ctx.Done():
		m.terminateSubprocess()
		return ctx.Err()
	case err := <-readyChan:
		if err != nil {
			m.terminateSubprocess()
			return err
		}
		return nil
	}
}

// UnloadModel cleanly shuts down the worker and frees 100% of GPU/system RAM.
func (m *Manager) UnloadModel() error {
	return m.UnloadModelWithProgress(context.Background(), nil)
}

// UnloadModelWithProgress cleanly shuts down worker and streams progress milestones.
func (m *Manager) UnloadModelWithProgress(ctx context.Context, onProgress func(ModelProgress)) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.cmd == nil || m.cmd.Process == nil {
		m.isReady = false
		if onProgress != nil {
			onProgress(ModelProgress{
				Status:     "unloaded",
				Percentage: 100,
				Message:    "Standby: no active model in memory.",
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

// GetInfo returns the current active device and model name.
func (m *Manager) GetInfo() (device string, model string, isReady bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.device, m.modelName, m.isReady && m.cmd != nil && m.cmd.Process != nil
}

// GetConfig returns the manager's current configuration.
func (m *Manager) GetConfig() Config {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.config
}

// ScanAvailableModels detects .safetensors checkpoints in the given directory and standard paths.
func (m *Manager) ScanAvailableModels(modelsDir string) []ModelInfo {
	m.mu.Lock()
	activePath := m.config.ModelPath
	isReady := m.isReady && m.cmd != nil && m.cmd.Process != nil
	m.mu.Unlock()

	searchDirs := []string{modelsDir, "models/Stable-diffusion", "models"}
	seenPaths := make(map[string]bool)
	var models []ModelInfo

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
					IsActive: absPath == activePath && isReady,
				})
			}
			return nil
		})
	}
	return models
}
