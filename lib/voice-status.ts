import type { VoiceStatus } from "@/lib/types";

export function voiceWebhookBase(): string {
  return process.env.VONAGE_VOICE_WEBHOOK_URL?.trim() || "";
}

export function isPublicWebhookUrl(url = voiceWebhookBase()): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return false;
  }
}

export function slngConfigured(): boolean {
  return Boolean(process.env.SLNG_API_KEY?.trim());
}

export function vonageConfigured(): boolean {
  return Boolean(
    process.env.VONAGE_APPLICATION_ID?.trim() &&
      process.env.VONAGE_PRIVATE_KEY_PATH?.trim() &&
      process.env.VONAGE_FROM_NUMBER?.trim(),
  );
}

export function getVoiceStatus(): VoiceStatus {
  const slng = slngConfigured();
  const vonage = vonageConfigured();
  const webhookPublic = isPublicWebhookUrl();
  const missing: string[] = [];
  if (!vonage) missing.push("needs Vonage number / application key");
  if (!slng) missing.push("needs SLNG key");
  if (!webhookPublic) missing.push("Vonage cannot hit localhost — set VONAGE_VOICE_WEBHOOK_URL to ngrok or a deploy");

  const canPlaceLiveCall = vonage && slng && webhookPublic;
  return {
    vonageConfigured: vonage,
    slngConfigured: slng,
    webhookPublic,
    canPlaceLiveCall,
    banner: canPlaceLiveCall
      ? null
      : `Call still shows. Live dial is stubbed: ${missing.join("; ")}.`,
  };
}

export function last4(number: string): string {
  const digits = number.replace(/\D/g, "");
  return digits.slice(-4) || "????";
}
