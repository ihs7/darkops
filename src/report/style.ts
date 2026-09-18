import { styleText } from "node:util";

export type Tone = "dim" | "bold" | "green" | "yellow" | "red" | "cyan";

export function paint(tone: Tone, text: string, color: boolean): string {
  if (!color || text.length === 0) return text;
  try {
    return styleText(tone, text, { validateStream: false });
  } catch {
    return text;
  }
}
