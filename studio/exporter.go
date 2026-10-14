package studio

import (
	"archive/zip"
	"encoding/csv"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Exporter manages asset packaging for digital storefronts.
type Exporter struct {
	outputDir string
}

// NewExporter initializes an exporter instance.
func NewExporter(outputDir string) *Exporter {
	return &Exporter{outputDir: outputDir}
}

// Export packages selected images into a platform bundle.
func (e *Exporter) Export(req ExportRequest) (*ExportResult, error) {
	bundleID := fmt.Sprintf("bundle_%d", time.Now().Unix())
	bundleDir := filepath.Join(e.outputDir, "bundles", bundleID)
	if err := os.MkdirAll(bundleDir, 0755); err != nil {
		return nil, fmt.Errorf("creating bundle directory failed: %w", err)
	}

	tags := generateTags(req.Title, req.CustomTags)
	description := generateDescription(req.Title, req.Platform, len(req.SelectedFiles))
	coverPath, err := e.createCoverImage(bundleDir, req.SelectedFiles, req.Platform)
	if err != nil {
		return nil, fmt.Errorf("generating cover image failed: %w", err)
	}

	csvPath := ""
	if req.Platform == "etsy" {
		csvPath, err = e.generateEtsyCSV(bundleDir, req, tags, description)
		if err != nil {
			return nil, fmt.Errorf("generating etsy csv failed: %w", err)
		}
	}

	licensePath, err := e.writeLicenseFile(bundleDir, req.Title)
	if err != nil {
		return nil, fmt.Errorf("writing license failed: %w", err)
	}

	zipFilename := fmt.Sprintf("%s.zip", bundleID)
	zipPath := filepath.Join(bundleDir, zipFilename)
	filesToZip := append([]string{licensePath}, req.SelectedFiles...)
	if err := createZipArchive(zipPath, filesToZip); err != nil {
		return nil, fmt.Errorf("creating zip archive failed: %w", err)
	}

	return e.buildResult(bundleID, req, zipFilename, coverPath, csvPath, tags, description), nil
}

func (e *Exporter) buildResult(
	bundleID string,
	req ExportRequest,
	zipFilename, coverPath, csvPath string,
	tags []string,
	desc string,
) *ExportResult {
	coverURL := ""
	if coverPath != "" {
		coverURL = fmt.Sprintf("/output/bundles/%s/%s", bundleID, filepath.Base(coverPath))
	}
	csvURL := ""
	if csvPath != "" {
		csvURL = fmt.Sprintf("/output/bundles/%s/%s", bundleID, filepath.Base(csvPath))
	}

	return &ExportResult{
		Platform:    req.Platform,
		BundleName:  bundleID,
		ZipFilename: zipFilename,
		ZipURL:      fmt.Sprintf("/output/bundles/%s/%s", bundleID, zipFilename),
		CoverURL:    coverURL,
		CSVURL:      csvURL,
		ItemCount:   len(req.SelectedFiles),
		Tags:        tags,
		Title:       req.Title,
		Description: desc,
		CreatedAt:   time.Now(),
	}
}

func (e *Exporter) createCoverImage(bundleDir string, images []string, platform string) (string, error) {
	if len(images) == 0 {
		return "", nil
	}

	width, height := 2000, 2000
	if platform == "gumroad" || platform == "shopify" {
		width, height = 1920, 1080
	}

	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	bgColor := color.RGBA{R: 24, G: 24, B: 28, A: 255}
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{bgColor}, image.Point{}, draw.Src)

	if err := renderCoverCollage(canvas, images, width, height); err != nil {
		return "", err
	}

	destPath := filepath.Join(bundleDir, "cover_mockup.jpg")
	out, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	return destPath, jpeg.Encode(out, canvas, &jpeg.Options{Quality: 92})
}

func renderCoverCollage(canvas *image.RGBA, images []string, totalW, totalH int) error {
	count := len(images)
	if count > 4 {
		count = 4
	}

	gridCols := 1
	if count > 1 {
		gridCols = 2
	}
	gridRows := (count + gridCols - 1) / gridCols

	cellW := (totalW - 80) / gridCols
	cellH := (totalH - 80) / gridRows

	for idx := 0; idx < count; idx++ {
		row := idx / gridCols
		col := idx % gridCols
		destX := 40 + col*cellW
		destY := 40 + row*cellH

		if err := pasteThumbnail(canvas, images[idx], destX, destY, cellW-20, cellH-20); err != nil {
			return err
		}
	}
	return nil
}

func pasteThumbnail(canvas *image.RGBA, imgPath string, x, y, maxW, maxH int) error {
	file, err := os.Open(imgPath)
	if err != nil {
		return err
	}
	defer file.Close()

	src, _, err := image.Decode(file)
	if err != nil {
		return err
	}

	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()

	targetRect := image.Rect(x, y, x+maxW, y+maxH)
	drawNearestNeighbor(canvas, targetRect, src, srcW, srcH)
	return nil
}

func drawNearestNeighbor(dst *image.RGBA, dr image.Rectangle, src image.Image, sw, sh int) {
	dw := dr.Dx()
	dh := dr.Dy()

	for y := 0; y < dh; y++ {
		sy := (y * sh) / dh
		for x := 0; x < dw; x++ {
			sx := (x * sw) / dw
			dst.Set(dr.Min.X+x, dr.Min.Y+y, src.At(sx, sy))
		}
	}
}

func generateTags(title, custom string) []string {
	tagPool := []string{
		"digital clipart", "commercial license", "instant download",
		"high resolution", "sublimation design", "printable art",
		"craft supplies", "isolated white", "graphic set",
		"sticker design", "pod art", "vector style", "digital paper",
	}

	result := make([]string, 0, 13)
	if custom != "" {
		for _, t := range strings.Split(custom, ",") {
			t = strings.TrimSpace(t)
			if t != "" && len(result) < 13 {
				result = append(result, t)
			}
		}
	}

	for _, p := range tagPool {
		if len(result) >= 13 {
			break
		}
		if !containsTag(result, p) {
			result = append(result, p)
		}
	}
	return result
}

func containsTag(slice []string, val string) bool {
	for _, s := range slice {
		if strings.EqualFold(s, val) {
			return true
		}
	}
	return false
}

func generateDescription(title, platform string, count int) string {
	return fmt.Sprintf(`## %s - Digital Art Collection

Thank you for visiting! This premium bundle includes **%d commercial-grade illustrations** crafted at pristine resolution.

### What is Included:
- **%d High-Resolution Digital Files** (300 DPI, isolated subjects)
- Instant Digital Download (ZIP archive)
- Commercial Use License included for small businesses & print-on-demand

### Usage Terms:
- Permitted: Physical crafts, stickers, sublimation, apparel, wall prints, POD products.
- Prohibited: Reselling the raw digital files as standalone clipart packs.

Instant download available upon purchase. High resolution guaranteed.`,
		title, count, count)
}

func (e *Exporter) generateEtsyCSV(dir string, req ExportRequest, tags []string, desc string) (string, error) {
	csvPath := filepath.Join(dir, "etsy_listing_import.csv")
	file, err := os.Create(csvPath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	headers := []string{"Title", "Description", "Price", "Quantity", "Tags", "Materials", "Who Made It", "Is Supply", "When Made"}
	if err := writer.Write(headers); err != nil {
		return "", err
	}

	row := []string{
		req.Title,
		desc,
		fmt.Sprintf("%.2f", req.Price),
		"999",
		strings.Join(tags, ","),
		"Digital File, High Res JPG, Instant Download",
		"i_did",
		"true",
		"2020_2026",
	}
	return csvPath, writer.Write(row)
}

func (e *Exporter) writeLicenseFile(dir, title string) (string, error) {
	licPath := filepath.Join(dir, "COMMERCIAL_USE_LICENSE.txt")
	content := fmt.Sprintf(`COMMERCIAL USE LICENSE AGREEMENT
Bundle: %s
Date: %s

Grant of Rights:
The purchaser is granted a non-exclusive, non-transferable license to use the included digital artwork for:
1. Unlimited physical products (t-shirts, mugs, stickers, prints, totes).
2. Small business commercial usage and Print-on-Demand (POD).
3. Client work and finished digital compositions.

Restrictions:
1. You may NOT re-distribute, sub-license, or re-sell the raw image files.
2. You may NOT share the archive with third parties.

Enjoy your designs!`, title, time.Now().Format("2006-01-02"))

	return licPath, os.WriteFile(licPath, []byte(content), 0644)
}

func createZipArchive(zipPath string, files []string) error {
	out, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	defer out.Close()

	w := zip.NewWriter(out)
	defer w.Close()

	for _, file := range files {
		if err := addFileToZip(w, file); err != nil {
			return err
		}
	}
	return nil
}

func addFileToZip(w *zip.Writer, filePath string) error {
	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() {
		return err
	}

	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = filepath.Base(filePath)
	header.Method = zip.Deflate

	writer, err := w.CreateHeader(header)
	if err != nil {
		return err
	}

	_, err = io.Copy(writer, f)
	return err
}
