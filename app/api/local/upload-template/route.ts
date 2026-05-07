import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const TEMPLATE_DIR = join(tmpdir(), "kh-templates");

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await mkdir(TEMPLATE_DIR, { recursive: true });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!/\.pptx$/i.test(file.name)) {
      return NextResponse.json({ error: "Only PPTX files are supported" }, { status: 415 });
    }

    const safeName = file.name.replace(/[^\w.-]+/g, "-");
    const dest = join(TEMPLATE_DIR, `${Date.now()}-${safeName}`);
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(dest, buf);

    return NextResponse.json({ path: dest, name: file.name, sizeBytes: buf.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
