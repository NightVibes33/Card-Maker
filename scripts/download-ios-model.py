from __future__ import annotations

import hashlib
import shutil
import urllib.request
from pathlib import Path

from huggingface_hub import hf_hub_download


REPOSITORY = "onnx-community/ormbg-ONNX"
REVISION = "034e2d884afbab897e10e78fc5bb566b29533fd6"
ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "public" / "models" / REPOSITORY
FILES = (
    "README.md",
    "config.json",
    "preprocessor_config.json",
    "onnx/model_quantized.onnx",
)
EXPECTED_MODEL_SHA256 = "ffbcae62a7b675d616e64cb392ee028786c4cf74f83596590fba13733ef00171"


def main() -> None:
    for filename in FILES:
        cached_file = Path(
            hf_hub_download(
                repo_id=REPOSITORY,
                filename=filename,
                revision=REVISION,
            )
        )
        output_file = DESTINATION / filename
        output_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cached_file, output_file)

    model_file = DESTINATION / "onnx" / "model_quantized.onnx"
    digest = hashlib.sha256(model_file.read_bytes()).hexdigest()
    if digest != EXPECTED_MODEL_SHA256:
        raise RuntimeError(f"Unexpected cutout model SHA-256: {digest}")

    print(f"Bundled verified {REPOSITORY} model ({model_file.stat().st_size:,} bytes)")

    license_url = "https://www.apache.org/licenses/LICENSE-2.0.txt"
    request = urllib.request.Request(license_url, headers={"User-Agent": "CardMaker-iOS-Build/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        license_text = response.read()
    if b"Apache License" not in license_text or b"Version 2.0" not in license_text:
        raise RuntimeError("Could not verify the Apache License 2.0 text for the bundled model.")
    (DESTINATION / "LICENSE.txt").write_bytes(license_text)
    (DESTINATION / "NOTICE.txt").write_text(
        "This app includes the ORMBG ONNX background-removal model.\n"
        "Model: https://huggingface.co/onnx-community/ormbg-ONNX\n"
        f"Pinned revision: {REVISION}\n"
        "The model is identified by its publisher as Apache-2.0 licensed. "
        "See LICENSE.txt and README.md in this directory.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
