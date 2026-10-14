package engine_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"go-sd/engine"
)

func TestEmbeddedEngine_EndToEndGeneration(t *testing.T) {
	pythonPath := ".venv/bin/python"
	modelPath := "models/Stable-diffusion/juggernautXL_version2.safetensors"

	if _, err := os.Stat(pythonPath); os.IsNotExist(err) {
		t.Skip("Python venv not found, skipping integration test")
	}
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		t.Skip("Juggernaut XL model not found, skipping integration test")
	}

	workerScript, err := filepath.Abs("worker.py")
	if err != nil {
		t.Fatalf("failed to get absolute path of worker.py: %v", err)
	}

	cfg := engine.Config{
		PythonPath:   pythonPath,
		WorkerScript: workerScript,
		ModelPath:    modelPath,
		Device:       "xpu",
	}

	mgr := engine.NewManager(cfg)

	// Context with timeout for model loading (up to 2 minutes on first load)
	startCtx, startCancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer startCancel()

	t.Log("Starting embedded engine and loading Juggernaut XL onto Intel Arc XPU...")
	if err := mgr.Start(startCtx); err != nil {
		t.Fatalf("engine failed to start: %v", err)
	}
	defer mgr.Close()

	device, model, ready := mgr.GetInfo()
	t.Logf("Engine ready! Device: %s, Model: %s, Ready: %v", device, model, ready)

	// Ping test
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer pingCancel()
	if err := mgr.Ping(pingCtx); err != nil {
		t.Fatalf("ping failed: %v", err)
	}
	t.Log("Ping successful!")

	// End-to-end image generation
	outputDir, err := filepath.Abs("../output")
	if err != nil {
		outputDir = "/tmp"
	}
	_ = os.MkdirAll(outputDir, 0755)
	outputPath := filepath.Join(outputDir, "test_dire_wolf.jpg")

	req := engine.JobRequest{
		ID:             "test_job_wolf_001",
		Prompt:         "wax crayon drawing of an armored dire wolf with broadsword, isolated on white background, sharp lines, detailed",
		NegativePrompt: "blurry, low quality, watermark, deformed, noisy background",
		Width:          1024,
		Height:         1024,
		Steps:          20,
		CFGScale:       6.0,
		Seed:           1173852140,
		OutputPath:     outputPath,
	}

	genCtx, genCancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer genCancel()

	t.Log("Generating 1024x1024 image via embedded worker...")
	res, err := mgr.Generate(genCtx, req)
	if err != nil {
		t.Fatalf("image generation failed: %v", err)
	}

	t.Logf("Generation completed! Status: %s, Elapsed: %.2fs, File: %s", res.Status, res.ElapsedSeconds, res.OutputPath)

	info, err := os.Stat(res.OutputPath)
	if err != nil {
		t.Fatalf("output file does not exist on disk: %v", err)
	}
	if info.Size() == 0 {
		t.Fatal("output file is 0 bytes")
	}

	t.Logf("Success! Generated image size: %d bytes (%.2f KB)", info.Size(), float64(info.Size())/1024.0)
}
