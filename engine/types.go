package engine

// JobRequest represents a generation task sent to the worker.
type JobRequest struct {
	ID             string  `json:"id"`
	Prompt         string  `json:"prompt"`
	NegativePrompt string  `json:"negative_prompt"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	Steps          int     `json:"steps"`
	CFGScale       float64 `json:"cfg_scale"`
	Seed           int64   `json:"seed"`
	OutputPath     string  `json:"output_path"`
	Command        string  `json:"command,omitempty"`
}

// JobResult represents the response returned by the worker.
type JobResult struct {
	ID             string  `json:"id"`
	Status         string  `json:"status"`
	OutputPath     string  `json:"output_path,omitempty"`
	ElapsedSeconds float64 `json:"elapsed_seconds,omitempty"`
	Seed           int64   `json:"seed,omitempty"`
	Width          int     `json:"width,omitempty"`
	Height         int     `json:"height,omitempty"`
	Error          string  `json:"error,omitempty"`
	Device         string  `json:"device,omitempty"`
	Model          string  `json:"model,omitempty"`
	Engine         string  `json:"engine,omitempty"`
}

// JobProgress represents streaming step updates from the worker.
type JobProgress struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Step       int    `json:"step"`
	TotalSteps int    `json:"total_steps"`
	Percentage int    `json:"percentage"`
	Preview    string `json:"preview,omitempty"`
}

// Config specifies the runtime settings for the embedded engine.
type Config struct {
	PythonPath         string `json:"python_path"`
	WorkerScript       string `json:"worker_script"`
	OpenVINOPythonPath string `json:"openvino_python_path"`
	OpenVINOWorker     string `json:"openvino_worker"`
	ModelPath          string `json:"model_path"`
	Device             string `json:"device"`
	ActiveEngine       string `json:"active_engine"` // "ipex" | "openvino"
}

// ModelProgress represents streaming progress when loading or unloading a model.
type ModelProgress struct {
	Status     string `json:"status"`
	Percentage int    `json:"percentage"`
	Message    string `json:"message"`
	Model      string `json:"model,omitempty"`
	Device     string `json:"device,omitempty"`
	Engine     string `json:"engine,omitempty"`
	Error      string `json:"error,omitempty"`
}

// ModelInfo describes a detected safetensors or OpenVINO checkpoint on disk.
type ModelInfo struct {
	Name     string  `json:"name"`
	Filename string  `json:"filename"`
	Path     string  `json:"path"`
	SizeGB   float64 `json:"size_gb"`
	IsActive bool    `json:"is_active"`
	Engine   string  `json:"engine"` // "ipex" | "openvino"
}
