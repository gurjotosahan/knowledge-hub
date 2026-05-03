export interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
  webUrl?: string;
  parentReference?: { driveId: string; id: string };
  // Injected by mock only — bypasses binary download + extraction
  mockSlides?: Array<{ number: number; text: string }>;
}

export interface GraphDrive {
  id: string;
  name: string;
  driveType: string;
  webUrl?: string;
}

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  driveId: string;
  mockMode: boolean;
}
