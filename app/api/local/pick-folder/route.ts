import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

async function pickFolder() {
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Choose your Knowledge Hub document source")',
    ]);
    return stdout.trim().replace(/\/$/, "");
  }

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      '$dialog.Description = "Choose your Knowledge Hub document source"',
      "$dialog.ShowNewFolderButton = $false",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }",
    ].join("; ");
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-STA",
      "-Command",
      script,
    ]);
    return stdout.trim();
  }

  const { stdout } = await execFileAsync("zenity", [
    "--file-selection",
    "--directory",
    "--title=Choose your Knowledge Hub document source",
  ]);
  return stdout.trim().replace(/\/$/, "");
}

export async function POST() {
  try {
    const folderPath = await pickFolder();
    if (!folderPath) {
      return NextResponse.json({ cancelled: true });
    }
    return NextResponse.json({ folderPath });
  } catch (err) {
    const message = String(err);
    if (/user canceled|cancelled|canceled/i.test(message)) {
      return NextResponse.json({ cancelled: true });
    }

    return NextResponse.json(
      { error: `Folder picker failed: ${message}` },
      { status: 500 }
    );
  }
}
