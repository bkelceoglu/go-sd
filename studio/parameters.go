package studio

import (
	"fmt"
	"math/rand"
	"regexp"
	"strings"
	"time"
)

// StylePreset defines a prompt modifier recipe.
type StylePreset struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	PositiveSuffix string `json:"positive_suffix"`
	NegativePrompt string `json:"negative_prompt"`
}

// GetDefaultStylePresets returns popular, high-converting digital art presets.
func GetDefaultStylePresets() []StylePreset {
	return []StylePreset{
		{
			ID:             "wax_crayon",
			Name:           "Wax Crayon Drawing (High Texture)",
			PositiveSuffix: "wax crayon drawing, textured heavy paper, handcrafted art, vibrant colored wax, authentic naive stroke texture, isolated on pure white background",
			NegativePrompt: "photo, 3d render, blurry, smooth plastic, complex background, text, watermark, signature",
		},
		{
			ID:             "black_ink_vector",
			Name:           "Black Ink Minimalist Logo (Vector Art)",
			PositiveSuffix: "black ink minimalist logo, flowing artistic silhouette lines, elegant vector art, solid black ink, high contrast, flat modern graphic icon, isolated on solid white background",
			NegativePrompt: "circular frame, borders, plate, paper texture, realistic photo, shadows, gradient, 3D render, noise, blurry, draft",
		},
		{
			ID:             "vintage_watercolor",
			Name:           "Vintage Pastel Watercolor (Storybook Clipart)",
			PositiveSuffix: "delicate botanical watercolor illustration, soft vintage pastel palette, subtle wet paint bleeds, fine ink line contours, classic storybook art, isolated on pure white background",
			NegativePrompt: "dark, harsh shadows, oversaturated, 3d render, photo, border, frame, cropped, text, watermark",
		},
		{
			ID:             "sticker_diecut",
			Name:           "Die-Cut Glossy Sticker (White Border)",
			PositiveSuffix: "cute die-cut sticker, bold clean vector lines, vivid saturated colors, thick white sticker border outline, slight 3d pop effect, glossy finish, isolated on solid dark grey background",
			NegativePrompt: "blurry, realistic photo, pixelated, missing white border, cropped, noisy, watermark, text",
		},
		{
			ID:             "ukiyo_e_woodblock",
			Name:           "Japanese Ukiyo-e Woodblock Print",
			PositiveSuffix: "traditional Japanese ukiyo-e woodblock print, vintage Hokusai style, muted mineral pigment wash, elegant sumi-e outlines, fine aged washi paper texture, iconic oriental art composition",
			NegativePrompt: "modern photo, 3d cgi, glossy plastic, neon, modern typography, blurry, deformed, lowres",
		},
		{
			ID:             "linocut_blockprint",
			Name:           "Linocut & Blockprint Art (Rustic Relief)",
			PositiveSuffix: "artistic linocut relief print, bold relief carving cuts, rustic ink printmaking, handcrafted woodblock texture, stark monochrome or limited duo-tone palette, art gallery print",
			NegativePrompt: "smooth digital gradient, 3d render, photorealistic, blurry, noise, messy smudges, watermark",
		},
		{
			ID:             "alcohol_ink_gold",
			Name:           "Alcohol Ink & Liquid Gold (Fluid Art)",
			PositiveSuffix: "luxurious alcohol ink painting, dynamic fluid swirls, marbled translucent pigments, shimmering metallic gold leaf veins, ethereal liquid gradients, high-end fine art print",
			NegativePrompt: "muddy colors, pixelated, harsh digital lines, figurative, draft, lowres, text, watermark",
		},
		{
			ID:             "oil_impasto",
			Name:           "Impasto Oil Painting (Heavy Palette Knife)",
			PositiveSuffix: "masterpiece impasto oil painting, thick textural palette knife strokes, visible heavy canvas weave, rich vibrant oil colors, expressive dimensional brushwork, dramatic fine art lighting",
			NegativePrompt: "flat digital art, vector, smooth airbrush, 3d render, cartoon, blurry, low quality",
		},
		{
			ID:             "botanical_engraving",
			Name:           "Vintage Botanical & Scientific Engraving",
			PositiveSuffix: "19th century vintage botanical engraving, finely detailed copperplate etched lines, delicate hand-tinted watercolor wash, antique parchment background, archival naturalist book plate",
			NegativePrompt: "modern, neon colors, 3d render, photo, digital artifact, blurry, cartoon, watermark",
		},
		{
			ID:             "synthwave_neon",
			Name:           "Cyberpunk & Synthwave Neon Art",
			PositiveSuffix: "synthwave 80s retro aesthetics, glowing electric neon accents, cyan and magenta rim lighting, dark atmospheric reflective horizon, retro-futuristic digital art, 8k crisp details",
			NegativePrompt: "washed out, pastel, vintage paper, daytime sun, blurry, draft, watermark, low quality",
		},
		{
			ID:             "stained_glass",
			Name:           "Stained Glass Window (Gothic Cathedral)",
			PositiveSuffix: "gothic cathedral stained glass artwork, rich luminous colored glass panels, bold black lead caming outlines, radiant sunlight streaming through, jewel tones, decorative sacred art mosaic",
			NegativePrompt: "flat photo, plastic, smooth gradient, blurry, low contrast, washed out, text, watermark",
		},
		{
			ID:             "isometric_claymation",
			Name:           "Isometric 3D Cozy Clay (Claymation)",
			PositiveSuffix: "charming isometric 3d miniature scene, handcrafted polymer clay model, soft plasticine fingerprint textures, warm studio ambient occlusion, cute playful diorama, rendered in Octane",
			NegativePrompt: "flat 2d, sketch, realistic photograph, dark, scary, jagged edges, lowres, text",
		},
		{
			ID:             "retro_pop_art",
			Name:           "Retro 70s Pop Art Poster (Screenprint)",
			PositiveSuffix: "vintage 1970s pop art poster, silk-screen print halftone dot patterns, flat vibrant color blocking, groovy typography contours, retro mid-century modern aesthetic, bold graphic design",
			NegativePrompt: "subtle, realistic photo, 3d render, muddy gradients, dark gothic, blurry, lowres",
		},
		{
			ID:             "fantasy_concept_art",
			Name:           "Epic Dark Fantasy Concept Art",
			PositiveSuffix: "epic dark fantasy character concept art, ornate intricate armor detailing, cinematic volumetric lighting, mystical glowing embers, masterpiece digital oil painting, sharp focus, 8k",
			NegativePrompt: "cartoon, anime, deformed anatomy, blurry, low quality, oversaturated childish colors, watermark",
		},
		{
			ID:             "pixel_art_retro",
			Name:           "16-Bit Retro Pixel Art (Arcade Classic)",
			PositiveSuffix: "authentic 16-bit pixel art, classic retro gaming sprite, handcrafted dithering, vibrant limited color palette, clean grid pixel aesthetics, nostalgic arcade illustration",
			NegativePrompt: "smooth gradients, antialiased vectors, photorealistic, blurry, 3d render, text",
		},
		{
			ID:             "tarot_art_nouveau",
			Name:           "Mystical Tarot Card (Art Nouveau & Gold)",
			PositiveSuffix: "mystical vintage tarot card illustration, Alphonse Mucha Art Nouveau style, intricate ornamental gold filigree borders, celestial symbolism, elegant organic botanical curves, lithograph print",
			NegativePrompt: "modern photo, simplistic, 3d render, harsh modern lighting, deformed hands, blurry",
		},
		{
			ID:             "raw_custom",
			Name:           "Custom / No Preset (Raw User Prompt)",
			PositiveSuffix: "",
			NegativePrompt: "blurry, low quality, deformed, watermark, signature",
		},
	}
}

var wildcardRegex = regexp.MustCompile(`\{([^{}]+)\}`)

// ExpandWildcards processes `{option1|option2|option3}` syntax in prompts.
func ExpandWildcards(prompt string, rng *rand.Rand) string {
	if rng == nil {
		rng = rand.New(rand.NewSource(time.Now().UnixNano()))
	}

	result := wildcardRegex.ReplaceAllStringFunc(prompt, func(match string) string {
		inner := strings.Trim(match, "{}")
		options := strings.Split(inner, "|")
		if len(options) == 0 {
			return match
		}
		choice := strings.TrimSpace(options[rng.Intn(len(options))])
		return choice
	})

	return result
}

// BuildPrompt applies selected preset to the user's base prompt.
func BuildPrompt(userPrompt string, presetID string) (finalPrompt string, negativePrompt string) {
	presets := GetDefaultStylePresets()
	var selected *StylePreset
	for _, p := range presets {
		if p.ID == presetID {
			selected = &p
			break
		}
	}
	if selected == nil {
		selected = &presets[0]
	}

	if selected.PositiveSuffix != "" {
		finalPrompt = fmt.Sprintf("%s, %s", strings.TrimSpace(userPrompt), selected.PositiveSuffix)
	} else {
		finalPrompt = strings.TrimSpace(userPrompt)
	}
	negativePrompt = selected.NegativePrompt
	return finalPrompt, negativePrompt
}
