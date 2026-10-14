#!/usr/bin/env python3
"""
Headless Micro-Worker for Stable Diffusion XL / Juggernaut XL.
Communicates with the Go orchestrator via stdin/stdout JSON-RPC.
Zero WebUI, zero Gradio, zero HTTP server overhead.
"""

import sys
import json
import time
import os
import argparse

def select_device():
    try:
        import torch
        if hasattr(torch, "xpu") and torch.xpu.is_available():
            return "xpu", torch.bfloat16
        if torch.cuda.is_available():
            return "cuda", torch.float16
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps", torch.float16
    except Exception:
        pass
    import torch
    return "cpu", torch.float32

def main():
    parser = argparse.ArgumentParser(description="Headless SDXL Worker")
    parser.add_argument("--model", type=str, required=True, help="Path to .safetensors model")
    parser.add_argument("--device", type=str, default="", help="Device override (xpu, cuda, cpu)")
    args = parser.parse_args()

    import torch
    from diffusers import StableDiffusionXLPipeline, EulerAncestralDiscreteScheduler

    detected_device, dtype = select_device()
    target_device = args.device if args.device else detected_device

    # Send initial loading signal
    sys.stdout.write(json.dumps({
        "status": "loading",
        "percentage": 15,
        "message": "Initializing PyTorch IPEX runtime...",
        "model": args.model,
        "device": target_device
    }) + "\n")
    sys.stdout.flush()

    try:
        sys.stdout.write(json.dumps({
            "status": "loading",
            "percentage": 30,
            "message": "Reading safetensors checkpoint & components...",
            "model": args.model,
            "device": target_device
        }) + "\n")
        sys.stdout.flush()

        pipe = StableDiffusionXLPipeline.from_single_file(
            args.model,
            torch_dtype=dtype,
            use_safetensors=True
        )
        pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)

        sys.stdout.write(json.dumps({
            "status": "loading",
            "percentage": 75,
            "message": f"Transferring UNet & VAE pipeline to {target_device}...",
            "model": args.model,
            "device": target_device
        }) + "\n")
        sys.stdout.flush()

        pipe.to(target_device)
        
        # Memory and attention optimizations for Intel Arc XPU
        if target_device == "xpu":
            try:
                sys.stdout.write(json.dumps({
                    "status": "loading",
                    "percentage": 90,
                    "message": "Configuring VAE tiling & attention slicing for Arc GPU...",
                    "model": args.model,
                    "device": target_device
                }) + "\n")
                sys.stdout.flush()

                pipe.enable_attention_slicing()
                if hasattr(pipe, "vae") and pipe.vae is not None:
                    pipe.vae.enable_slicing()
                    pipe.vae.enable_tiling()
            except Exception:
                pass

        sys.stdout.write(json.dumps({
            "status": "ready",
            "percentage": 100,
            "message": f"Engine active on {target_device}",
            "model": args.model,
            "device": target_device,
            "dtype": str(dtype)
        }) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(json.dumps({
            "status": "fatal_error",
            "error": str(e)
        }) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    import gc
    import io
    import base64
    from PIL import Image

    latent_factors_cache = {}

    def latents_to_b64_preview(latents_tensor):
        try:
            dev = latents_tensor.device
            if dev not in latent_factors_cache:
                latent_factors_cache[dev] = torch.tensor([
                    [-0.064,  0.113,  0.029],
                    [-0.015,  0.031,  0.033],
                    [ 0.076, -0.068, -0.054],
                    [-0.036,  0.036,  0.070],
                ], dtype=torch.float32, device=dev)

            latent_slice = latents_tensor[0].permute(1, 2, 0).to(torch.float32)
            rgb = torch.matmul(latent_slice, latent_factors_cache[dev])
            rgb = (rgb - rgb.min()) / (rgb.max() - rgb.min() + 1e-5)
            rgb = (rgb * 255).clamp(0, 255).to(torch.uint8).cpu().numpy()

            img = Image.fromarray(rgb).resize((128, 128), Image.Resampling.BILINEAR)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=60)
            return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")
        except Exception:
            return None

    # Listen on stdin for generation requests
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            sys.stdout.write(json.dumps({"status": "error", "error": f"Invalid JSON: {e}"}) + "\n")
            sys.stdout.flush()
            continue

        if req.get("command") == "exit":
            sys.stdout.write(json.dumps({"status": "exiting"}) + "\n")
            sys.stdout.flush()
            break

        if req.get("command") == "unload":
            del pipe
            pipe = None
            if target_device == "xpu" and hasattr(torch, "xpu"):
                torch.xpu.empty_cache()
            gc.collect()
            sys.stdout.write(json.dumps({"status": "unloaded"}) + "\n")
            sys.stdout.flush()
            break

        if req.get("command") == "ping":
            sys.stdout.write(json.dumps({"status": "pong", "device": target_device}) + "\n")
            sys.stdout.flush()
            continue

        req_id = req.get("id", "job_unknown")
        prompt = req.get("prompt", "")
        negative_prompt = req.get("negative_prompt", "")
        width = int(req.get("width", 1024))
        height = int(req.get("height", 1024))
        steps = int(req.get("steps", 20))
        cfg_scale = float(req.get("cfg_scale", 6.0))
        seed = int(req.get("seed", -1))
        output_path = req.get("output_path", "")

        if not output_path:
            output_path = f"/tmp/sd_{req_id}_{int(time.time())}.jpg"

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        t0 = time.time()
        try:
            generator = None
            actual_seed = seed
            if seed >= 0:
                generator = torch.Generator(device="cpu").manual_seed(seed)
            else:
                actual_seed = torch.randint(0, 2**32 - 1, (1,)).item()
                generator = torch.Generator(device="cpu").manual_seed(actual_seed)

            def on_step_end(pipe_inst, step_index, timestep, callback_kwargs):
                step_curr = step_index + 1
                pct = int((step_curr / steps) * 100)
                preview_b64 = None

                # Generate live preview every 2 steps or on boundary
                if step_curr % 2 == 0 or step_curr == 1 or step_curr == steps:
                    latents_val = callback_kwargs.get("latents", None)
                    if latents_val is not None:
                        preview_b64 = latents_to_b64_preview(latents_val)

                msg = {
                    "status": "progress",
                    "id": req_id,
                    "step": step_curr,
                    "total_steps": steps,
                    "percentage": pct
                }
                if preview_b64:
                    msg["preview"] = preview_b64

                sys.stdout.write(json.dumps(msg) + "\n")
                sys.stdout.flush()
                return callback_kwargs

            with torch.inference_mode():
                result = pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    num_inference_steps=steps,
                    guidance_scale=cfg_scale,
                    width=width,
                    height=height,
                    generator=generator,
                    callback_on_step_end=on_step_end,
                    callback_on_step_end_tensor_inputs=["latents"]
                )

                img = result.images[0]
                img.save(output_path, quality=95)

            elapsed = time.time() - t0

            # Reclaim GPU unified memory
            if target_device == "xpu" and hasattr(torch, "xpu"):
                torch.xpu.empty_cache()
            gc.collect()

            sys.stdout.write(json.dumps({
                "id": req_id,
                "status": "success",
                "output_path": output_path,
                "elapsed_seconds": round(elapsed, 2),
                "seed": actual_seed,
                "width": width,
                "height": height
            }) + "\n")
            sys.stdout.flush()

        except Exception as e:
            if target_device == "xpu" and hasattr(torch, "xpu"):
                torch.xpu.empty_cache()
            gc.collect()

            sys.stdout.write(json.dumps({
                "id": req_id,
                "status": "error",
                "error": str(e),
                "elapsed_seconds": round(time.time() - t0, 2)
            }) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
