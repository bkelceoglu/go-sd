package studio

import (
	"time"

	"go-sd/engine"
)

// GenerationRequest specifies user input for creating digital artwork.
type GenerationRequest struct {
	Prompt         string  `json:"prompt"`
	NegativePrompt string  `json:"negative_prompt"`
	PresetID       string  `json:"preset_id"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	Steps          int     `json:"steps"`
	CFGScale       float64 `json:"cfg_scale"`
	Seed           int64   `json:"seed"`
	BatchCount     int     `json:"batch_count"`
}

// GeneratedImage represents metadata of an image rendered by the engine.
type GeneratedImage struct {
	ID             string    `json:"id"`
	Filename       string    `json:"filename"`
	URL            string    `json:"url"`
	Prompt         string    `json:"prompt"`
	NegativePrompt string    `json:"negative_prompt"`
	Seed           int64     `json:"seed"`
	Width          int       `json:"width"`
	Height         int       `json:"height"`
	Steps          int       `json:"steps"`
	CFGScale       float64   `json:"cfg_scale"`
	ElapsedSeconds float64   `json:"elapsed_seconds"`
	CreatedAt      time.Time `json:"created_at"`
}

// ExportRequest defines packaging requirements for online marketplaces.
type ExportRequest struct {
	Platform      string   `json:"platform"` // etsy, gumroad, shopify, raw
	Title         string   `json:"title"`
	SelectedFiles []string `json:"selected_files"`
	Price         float64  `json:"price"`
	CustomTags    string   `json:"custom_tags"`
}

// ExportResult contains generated bundle artifacts and download links.
type ExportResult struct {
	Platform    string    `json:"platform"`
	BundleName  string    `json:"bundle_name"`
	ZipFilename string    `json:"zip_filename"`
	ZipURL      string    `json:"zip_url"`
	CoverURL    string    `json:"cover_url,omitempty"`
	CSVURL      string    `json:"csv_url,omitempty"`
	ItemCount   int       `json:"item_count"`
	Tags        []string  `json:"tags"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

// SystemStatus provides telemetry on the engine and GPU device.
type SystemStatus struct {
	Ready           bool               `json:"ready"`
	Device          string             `json:"device"`
	Model           string             `json:"model"`
	StatusMsg       string             `json:"status_msg"`
	AvailableModels []engine.ModelInfo `json:"available_models,omitempty"`
}

// ModelLoadRequest specifies which model to load.
type ModelLoadRequest struct {
	ModelPath string `json:"model_path"`
}
