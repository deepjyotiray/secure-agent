import os
import sys
import re
import logging
import gc
from typing import List, Optional

from flask import Flask, request, jsonify
from mlx_lm import load, generate


# -----------------------------
# Configuration
# -----------------------------
MODEL_NAME = os.getenv("MLX_MODEL", "mlx-community/Mistral-7B-Instruct-v0.3-4bit")
PORT = int(os.getenv("MLX_PORT", 5001))
HOST = "127.0.0.1"

MAX_OUTPUT_CHARS = 20000  # hard safety cap

REPETITION_PATTERN = re.compile(r"(.{2,20}?)\1{10,}")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 2MB request cap


# -----------------------------
# Model Loader
# -----------------------------
def load_model():
    try:
        logger.info(f"Loading model: {MODEL_NAME}")
        model, tokenizer = load(MODEL_NAME)
        logger.info("Model loaded successfully")
        return model, tokenizer
    except Exception:
        logger.exception("Model load failed")
        sys.exit(1)


model, tokenizer = load_model()


# -----------------------------
# Memory-efficient cleaners
# -----------------------------
def remove_prompt_echo(output: str, prompt: str) -> str:
    if not prompt:
        return output

    idx = output.find(prompt)
    if idx != -1:
        return output[idx + len(prompt):]

    stripped = prompt.strip()
    idx = output.find(stripped)
    if idx != -1:
        return output[idx + len(stripped):]

    return output


def apply_stop_sequences(output: str, stops: List[str]) -> str:
    if not stops:
        return output

    min_idx = None
    for stop in stops:
        if not stop:
            continue
        idx = output.find(stop)
        if idx != -1:
            if min_idx is None or idx < min_idx:
                min_idx = idx

    return output[:min_idx] if min_idx is not None else output


def trim_repetition(output: str) -> str:
    # Only check if large enough (avoid regex cost + memory scan)
    if len(output) < 200:
        return output

    match = REPETITION_PATTERN.search(output)
    if match:
        pattern_len = len(match.group(1))
        cutoff = match.start() + pattern_len * 2
        return output[:cutoff]

    return output


def clean_output(raw_output: str, prompt: str, stops: List[str]) -> str:
    if not raw_output:
        return raw_output

    output = raw_output

    # Step 1: remove prompt echo (no split)
    output = remove_prompt_echo(output, prompt)

    # Step 2: remove instruction tokens
    inst_idx = output.find("[/INST]")
    if inst_idx != -1:
        output = output[inst_idx + 7:]

    # Step 3: apply stop sequences (single pass)
    output = apply_stop_sequences(output, stops)

    # Step 4: trim runaway repetition
    output = trim_repetition(output)

    # Step 5: hard cap (VERY important for RAM)
    if len(output) > MAX_OUTPUT_CHARS:
        output = output[:MAX_OUTPUT_CHARS]

    return output.strip() or raw_output


# -----------------------------
# Validation
# -----------------------------
def validate(data):
    if not data:
        return None, "Missing JSON"

    prompt = data.get("prompt")
    if not isinstance(prompt, str):
        return None, "Invalid prompt"

    max_tokens = data.get("max_tokens", 1000)
    if not isinstance(max_tokens, int) or max_tokens <= 0:
        return None, "Invalid max_tokens"

    stops = data.get("stop", [])
    if not isinstance(stops, list):
        return None, "Invalid stop"

    return (prompt, max_tokens, stops), None


# -----------------------------
# Routes
# -----------------------------
@app.route("/generate", methods=["POST"])
def generate_text():
    data = request.get_json(silent=True, cache=False)  # 🔥 disable caching

    validated, error = validate(data)
    if error:
        return jsonify({"error": error}), 400

    prompt, max_tokens, stops = validated

    try:
        raw_output = generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=max_tokens,
            verbose=False
        )

        output = clean_output(raw_output, prompt, stops)

        # 🔥 optional GC only for large responses
        if len(output) > 5000:
            gc.collect()

        return jsonify({"response": output})

    except Exception as e:
        logger.exception("Generation failed")
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": MODEL_NAME})


# -----------------------------
# Entry
# -----------------------------
if __name__ == "__main__":
    app.run(host=HOST, port=PORT)