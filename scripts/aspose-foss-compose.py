#!/usr/bin/env python3
"""Merge slides using Aspose.Slides FOSS (MIT license, no watermark).

Reads JSON spec from stdin:
    { "templatePath": "...", "slides": [{"filePath","slideNumber"}], "outputPath": "..." }

"Plain" mode: slides are cloned into the template's existing master/layout chain.
No new masters are copied from source decks — this avoids the broken-rels repair
errors caused by the FOSS library's cross-presentation master cloning.
"""
import json
import sys
import os
import importlib.metadata


def _foss_site() -> str:
    """Locate the aspose/slides_foss package directory."""
    try:
        dist = importlib.metadata.distribution("aspose-slides-foss")
        return str(dist.locate_file("aspose"))
    except Exception:
        import site
        for sp in site.getsitepackages():
            candidate = os.path.join(sp, "aspose")
            if os.path.isdir(os.path.join(candidate, "slides_foss")):
                return candidate
        return ""


def main() -> int:
    spec = json.loads(sys.stdin.read())
    template_path = spec["templatePath"]
    slide_specs = spec["slides"]
    output_path = spec["outputPath"]

    foss_site = _foss_site()
    if foss_site and foss_site not in sys.path:
        sys.path.insert(0, foss_site)

    import slides_foss as slides
    import slides_foss.export as export

    with slides.Presentation(template_path) as dst:
        # Remove all existing template slides (keep masters/layouts intact).
        while dst.slides.length > 0:
            dst.slides.remove_at(0)

        # Pick the first layout from the template's master chain.
        # Passing dest_layout to add_clone bypasses _clone_master_chain_for_slide
        # so no new masters are added — slides are hosted by the template's own master.
        dest_layout = None
        try:
            layouts = list(dst.layout_slides)
            if layouts:
                dest_layout = layouts[0]
        except Exception:
            pass

        sources: dict[str, object] = {}
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

        dst.save(output_path, export.SaveFormat.PPTX)

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"aspose-foss-compose error: {exc}", file=sys.stderr)
        sys.exit(1)
