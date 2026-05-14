#!/usr/bin/env python3
"""Merge slides from multiple PPTX files using Aspose.Slides.

Reads JSON spec from stdin:
    { "templatePath": "...", "slides": [{"filePath","slideNumber"}], "outputPath": "..." }

"Plain" mode: slides are cloned into the template's existing master/layout chain
(same approach as aspose-foss-compose.py). This avoids the repair errors caused
by cross-presentation master cloning while keeping the commercial library's
superior XML handling.

Free tier inserts an "evaluation" watermark slide. To remove, set
ASPOSE_LICENSE_PATH to a .lic / .xml file before invocation.
"""
import json
import os
import sys


def load_license():
    path = os.environ.get("ASPOSE_LICENSE_PATH")
    if not path or not os.path.exists(path):
        return
    try:
        import aspose.slides as slides
        lic = slides.License()
        lic.set_license(path)
    except Exception as exc:  # noqa: BLE001
        print(f"warn: failed to apply Aspose license: {exc}", file=sys.stderr)


def main() -> int:
    spec = json.loads(sys.stdin.read())
    template_path = spec["templatePath"]
    slide_specs = spec["slides"]
    output_path = spec["outputPath"]

    import aspose.slides as slides

    load_license()

    # Open template (keeps its masters/layouts/theme as the destination scaffold).
    with slides.Presentation(template_path) as dst:
        # Drop existing template slides — user-picked entries replace them entirely.
        # If the user wants a template slide kept they pass it in `slides`.
        while dst.slides.length > 0:
            dst.slides.remove_at(0)

        # Pin all cloned slides to the template's first layout so no new master
        # chain is copied from source decks — avoids cross-presentation rels repair errors.
        dest_layout = None
        try:
            layouts = list(dst.layout_slides)
            if layouts:
                dest_layout = layouts[0]
        except Exception:
            pass

        # Group source decks by filePath so we open each once.
        sources: dict[str, "slides.Presentation"] = {}
        try:
            for item in slide_specs:
                fp = item["filePath"]
                idx = int(item["slideNumber"]) - 1
                if fp not in sources:
                    sources[fp] = slides.Presentation(fp)
                src = sources[fp]
                if 0 <= idx < src.slides.length:
                    if dest_layout is not None:
                        dst.slides.add_clone(src.slides[idx], dest_layout)
                    else:
                        dst.slides.add_clone(src.slides[idx])
        finally:
            for src in sources.values():
                src.__exit__(None, None, None)

        dst.save(output_path, slides.export.SaveFormat.PPTX)

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"aspose-compose error: {exc}", file=sys.stderr)
        sys.exit(1)
