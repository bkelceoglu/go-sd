package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"go-sd/engine"
	"go-sd/studio"
)

func main() {
	port := flag.Int("port", 8080, "HTTP server listening port")
	pythonPath := flag.String("python", "/home/caveman/sdnext/.venv/bin/python", "Path to python executable with torch.xpu")
	modelPath := flag.String("model", "/home/caveman/sdnext/models/Stable-diffusion/juggernautXL_version2.safetensors", "Path to SDXL safetensors checkpoint")
	device := flag.String("device", "xpu", "Compute device (xpu, cuda, cpu)")
	flag.Parse()

	// Resolve directories
	rootDir, err := os.Getwd()
	if err != nil {
		log.Fatalf("Getting working directory failed: %v", err)
	}

	workerScript := filepath.Join(rootDir, "engine", "worker.py")
	webDir := filepath.Join(rootDir, "web")
	outputDir := filepath.Join(rootDir, "output")
	_ = os.MkdirAll(filepath.Join(outputDir, "images"), 0755)
	_ = os.MkdirAll(filepath.Join(outputDir, "bundles"), 0755)

	log.Printf("[GO-SD] Initializing Embedded Engine...")
	log.Printf("[GO-SD] Model: %s", *modelPath)
	log.Printf("[GO-SD] Device: %s", *device)

	engConfig := engine.Config{
		PythonPath:   *pythonPath,
		WorkerScript: workerScript,
		ModelPath:    *modelPath,
		Device:       *device,
	}

	mgr := engine.NewManager(engConfig)

	// Engine starts in on-demand standby mode (instant server boot with 0 MB VRAM)
	log.Printf("[GO-SD READY] Studio active in Standby mode. Model loading is on-demand via web UI.")

	exporter := studio.NewExporter(outputDir)
	server, err := studio.NewServer(mgr, exporter, webDir, outputDir)
	if err != nil {
		log.Fatalf("[GO-SD] Initializing studio server failed: %v", err)
	}

	mux := http.NewServeMux()
	server.RegisterRoutes(mux)

	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", *port),
		Handler: mux,
	}

	// Handle graceful shutdown
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("[GO-SD STUDIO] Server listening on http://localhost:%d", *port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[GO-SD] Server error: %v", err)
		}
	}()

	<-stopChan
	log.Println("[GO-SD] Shutting down gracefully...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	_ = httpServer.Shutdown(shutdownCtx)
	_ = mgr.Close()
	log.Println("[GO-SD] Engine stopped. Clean exit.")
}
