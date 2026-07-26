export interface InputSummary {
  textPreview: string;
  textBytes: number;
  params: unknown;
  redacted: boolean;
}

export interface OutputSummary {
  textPreview: string;
  textBytes: number;
  redacted: boolean;
}

export interface HistoryEntry {
  id: string;
  toolId: string;
  timestamp: string; // ISO 8601
  inputSummary: InputSummary;
  outputSummary: OutputSummary;
  success: boolean;
  error?: string;
  durationMs: number;
}
