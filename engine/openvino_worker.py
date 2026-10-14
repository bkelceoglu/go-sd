#!/usr/bin/env python3
"""
Headless Micro-Worker for OpenVINO GenAI Text2Image.
Communicates with the Go orchestrator via stdin/stdout JSON-RPC.
Direct Intel Arc GPU (XMX) acceleration. Zero PyTorch overhead.
"""

import sys
import json
import time
import os
import argparse
import numpy as np
from PIL import Image

def main():
    parser = argparse.ArgumentParser(description="Headless OpenVINO GenAI Worker")
    parser.add_argument("--model", type=str, required=True, help="Path to OpenVINO IR model directory")
    parser.add_argument("--device", type=str, default="GPU", help="Device override (GPU, NPU, CPU)")
    args = parser.parse_args()

    target_device = args.device.upper() if args.device else "GPU"

    # Send initial loading signal
    sys.stdout.write(json.dumps({
        "status": "loading",
        "percentage": 20,
        "message": f"Initializing OpenVINO runtime on {target_device}...",
        "model": os.path.basename(args.model),
        "device": f"Intel Arc ({target_device})"
    }) + "\n")
    sys.stdout.flush()

    try:
        import openvino_genai as ov_genai

        sys.stdout.write(json.dumps({
            "status": "loading",
            "percentage": 50,
            "message": f"Compiling OpenVINO graphs for Intel Arc {target_device}...",
            "model": os.path.basename(args.model),
            "device": f"Intel Arc ({target_device})"
        }) + "\n")
        sys.stdout.flush()

        pipe = ov_genai.Text2ImagePipeline(args.model, target_device)

        sys.stdout.write(json.dumps({
            "status": "ready",
            "percentage": 100,
            "message": f"OpenVINO model loaded successfully on {target_device}",
            "model": os.path.basename(args.model),
            "device": f"Intel Arc GPU ({target_device})"
        }) + "\n")
        sys.stdout.flush()

    except Exception as e:
        sys.stdout.write(json.dumps({
            "status": "error",
            "message": f"OpenVINO initialization failed: {str(e)}",
            "error": str(e)
        }) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    # Command loop
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue

        cmd = req.get("command")
        if cmd == "unload":
            try:
                del pipe
            except Exception:
                pass
            sys.stdout.write(json.dumps({
                "status": "unloaded",
                "percentage": 100,
                "message": "Intel Arc VRAM flushed (0 MB)"
            }) + "\n")
            sys.stdout.flush()
            sys.exit(0)

        if cmd == "status":
            sys.stdout.write(json.dumps({
                "status": "ready",
                "model": os.path.basename(args.model),
                "device": f"Intel Arc GPU ({target_device})"
            }) + "\n")
            sys.stdout.flush()
            continue

        # Inference request
        job_id = req.get("id", f"job_{int(time.time()*1000)}")
        prompt = req.get("prompt", "")
        neg_prompt = req.get("negative_prompt", "")
        width = req.get("width", 1024)
        height = req.get("height", 1024)
        steps = req.get("steps", 20)
        cfg_scale = req.get("cfg_scale", 7.0)
        seed = req.get("seed", 42)
        output_path = req.get("output_path", "output/image.png")

        t0 = time.time()
        try:
            kwargs = {
                "width": width,
                "height": height,
                "num_inference_steps": steps,
                "guidance_scale": cfg_scale,
                "rng_seed": seed,
            }
            if neg_prompt:
                kwargs["negative_prompt"] = neg_prompt

            res = pipe.generate(prompt, **kwargs)
            elapsed = time.time() - t0

            # Convert ov.Tensor to PIL Image
            raw_data = res.data
            if len(raw_data.shape) == 4:
                raw_data = raw_data[0]
            img = Image.fromarray(raw_data)
            os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
            img.save(output_path, quality=95)

            sys.stdout.write(json.dumps({
                "id": job_id,
                "status": "success",
                "output_path": output_path,
                "elapsed_seconds": round(elapsed, 2),
                "seed": seed,
                "width": width,
                "height": height,
                "model": os.path.basename(args.model),
                "device": f"Intel Arc ({target_device})"
            }) + "\n")
            sys.stdout.flush()

        except Exception as e:
            sys.stdout.write(json.dumps({
                "id": job_id,
                "status": "error",
                "error": str(e)
            }) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
