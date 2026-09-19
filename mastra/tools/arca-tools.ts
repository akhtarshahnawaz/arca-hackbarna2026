import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { MASS_ALERT_POLICY, massAlertBlockedReason } from "../../lib/alert-policy";
import { formatCoordinatorBriefing, formatResidentAlert } from "../../lib/briefing";
import {
  looksLikePhoneId,
  matchKnownSite,
  PHONE_IS_NOT_A_SITE_REFUSAL,
  resolveCallPermission,
  UNKNOWN_SITE_REFUSAL,
} from "../../lib/call-gate";
import {
  formatCoordinatorCallStatus,
  modelMustEchoCallStatus,
  SAY_THIS_EXACTLY_AWAITING_APPROVE,
} from "../../lib/call-status";
import { mostUrgent } from "../../lib/crosscheck";
import { getCommandState } from "../../lib/command";
import { retryPolicyCopy } from "../../lib/contact-policy";
import { demoSites } from "../../lib/demo-data";
import { phoneOnFileFor } from "../../lib/demo-cast";
import { coordinatorToolRefusal } from "../../lib/telegram-access";
import {
  afterLookupChoices,
  afterRequestChoices,
  briefingChoices,
  formatCta,
} from "../../lib/coordinator-cta";
import {
  getVoiceCall,
  listOptedInResidents,
  saveAlertRequest,
  saveProtectiveAction,
  saveReportedConfirmation,
  upsertResident,
} from "../../lib/db";
import { structurePhoneReport } from "../../lib/nebius-parse";
import {
  actionEffectCopy,
  actionLabel,
  arcaMayCall,
  isProtectiveAction,
} from "../../lib/protective-action";
import { ensembleReachCopy } from "../../lib/ranking";
import { transcribeAudio } from "../../lib/slng";
import {
  backupChatId,
  coordinatorChatId,
  downloadTelegramFile,
  sendTelegramMessage,
} from "../../lib/telegram";
import {
  approveSiteCall,
  denySiteCall,
  findAwaitingApprovalCall,
  requestSiteCall,
  sendApprovedTelegramVoice,
} from "../../lib/voice-calls";

function locked<I, O>(fn: (input: I) => Promise<O>) {
  return async (input: I, context: { requestContext?: { get?: (key: string) => unknown } }) => {
    const refused = coordinatorToolRefusal(context?.requestContext);
    if (refused) return refused;
    return fn(input);
  };
}

export const getBriefingTool = createTool({
  id: "get-briefing",
  description:
    "Coordinator briefing: Font-rubí / demo fire, simulation status, ranked call list with ensemble language. Use this on /start, /briefing, or when asked who to call.",
  inputSchema: z.object({
    zone: z.string().optional().describe("Optional zone label. Demo uses Bages / Font-rubí."),
  }),
  execute: locked(async () => {
    const state = await getCommandState();
    const cta = formatCta(briefingChoices());
    return {
      text: formatCoordinatorBriefing(state),
      fire: state.fire.name,
      municipality: state.fire.municipality,
      simulation: "DEMO ensemble — not a live Deepfire perimeter",
      rankedCount: state.sites.length,
      watchCount: state.watch.length,
      phoneOnFile: false,
      cta,
      instruction:
        "Present the numbered choices from cta.choiceList. Do not ask a free-text yes/no about calling.",
    };
  }),
});

export const getActiveFiresTool = createTool({
  id: "get-active-fires",
  description: "Active fire / hotspot status for the coordinator zone. Hotspots are not perimeters.",
  inputSchema: z.object({
    zone: z.string().optional(),
  }),
  execute: locked(async () => {
    const state = await getCommandState();
    const deepfire = state.sources.find((source) => source.id === "deepfire");
    return {
      fire: state.fire.name,
      municipality: state.fire.municipality,
      mode: state.fire.mode,
      hotspots: state.hotspots.length,
      deepfire: deepfire?.detail ?? "no Deepfire status",
      note: "Hotspot points are not fire boundaries. Do not infer arrival from distance rings.",
    };
  }),
});

export const rankSitesTool = createTool({
  id: "rank-sites",
  description:
    "Return the current ranked list. You never invent a new order. Filter likely/possible first; watch is separate.",
  inputSchema: z.object({}),
  execute: locked(async () => {
    const state = await getCommandState();
    return {
      ranked: state.sites.map((site) => ({
        rank: site.rank,
        code: site.code,
        kind: site.kind,
        ensemble: ensembleReachCopy(site.runsReach, site.ensembleMembers, site.tArrival),
        spareTime: site.spareTime,
        protectiveAction: site.protectiveAction,
        phoneOnFile: phoneOnFileFor(site.code),
        confirmationStatus: site.confirmationStatus ?? (site.confirmedAt ? "reported" : null),
      })),
      watch: state.watch.map((site) => ({
        code: site.code,
        ensemble: ensembleReachCopy(site.runsReach, site.ensembleMembers, site.tArrival),
        protectiveAction: site.protectiveAction,
        phoneOnFile: phoneOnFileFor(site.code),
      })),
      note: "A phone is a site only when it matches an env-backed seed number. Do not invent a mapping.",
    };
  }),
});

export const lookupSiteTool = createTool({
  id: "lookup-site",
  description:
    "Look up one site from the shared command list by code, id, or an env-backed phone on file. Never invent a phone↔site mapping.",
  inputSchema: z.object({
    siteId: z.string().describe("Site code or id from the ranked list, e.g. REGA-B-1842"),
  }),
  execute: locked(async (input) => {
    const seeded = matchKnownSite(demoSites(), input.siteId);
    if (looksLikePhoneId(input.siteId) && !seeded) {
      return {
        found: false,
        phoneOnFile: false,
        reason: PHONE_IS_NOT_A_SITE_REFUSAL,
        cta: formatCta(briefingChoices()),
      };
    }
    const state = await getCommandState();
    const site = matchKnownSite(
      [...state.sites, ...state.watch],
      seeded?.code ?? input.siteId,
    );
    if (!site) {
      return {
        found: false,
        phoneOnFile: false,
        reason: UNKNOWN_SITE_REFUSAL,
        cta: formatCta(briefingChoices()),
      };
    }
    const mayCall = arcaMayCall(site.protectiveAction);
    const cta = formatCta(afterLookupChoices(mayCall));
    const onFile = phoneOnFileFor(site.code);
    return {
      found: true,
      id: site.id,
      code: site.code,
      kind: site.kind,
      municipality: site.municipality,
      protectiveAction: site.protectiveAction,
      decisionLabel: site.protectiveAction ? actionLabel[site.protectiveAction] : "none — call locked",
      mayCall,
      phoneOnFile: onFile,
      ensemble: ensembleReachCopy(site.runsReach, site.ensembleMembers, site.tArrival),
      spareTime: site.spareTime,
      shelterHint: site.shelterHint,
      note: onFile
        ? "A number is on file from env. The coordinator can leave the call field blank. Do not read the digits aloud."
        : "No phone on file. Coordinator must type the number. Do not invent a mapping.",
      cta,
      instruction:
        "Present the numbered choices. If mayCall is false, do not offer a free-text call.",
    };
  }),
});

export const setProtectiveActionTool = createTool({
  id: "set-protective-action",
  description:
    "Save Monitor, Latent, Confine, or Evacuate for a known site in the same database the map uses. Call stays locked until Confine or Evacuate.",
  inputSchema: z.object({
    siteId: z.string().describe("Site code from the ranked list"),
    action: z.enum(["monitor", "latent", "confine", "evacuate"]),
  }),
  execute: locked(async (input) => {
    const state = await getCommandState();
    const site = matchKnownSite([...state.sites, ...state.watch], input.siteId);
    if (!site) {
      return { saved: false, reason: UNKNOWN_SITE_REFUSAL, phoneOnFile: false };
    }
    if (!isProtectiveAction(input.action)) {
      return { saved: false, reason: "Action must be monitor, latent, confine, or evacuate." };
    }
    await saveProtectiveAction({ siteId: site.code, action: input.action });
    const mayCall = arcaMayCall(input.action);
    return {
      saved: true,
      siteId: site.code,
      action: input.action,
      decisionLabel: actionLabel[input.action],
      mayCall,
      effect: actionEffectCopy(input.action),
      phoneOnFile: phoneOnFileFor(site.code),
      cta: formatCta(afterLookupChoices(mayCall)),
    };
  }),
});

export const recordConfirmationTool = createTool({
  id: "record-confirmation",
  description:
    "Log a coordinator field report after they called a site. Example: farmer says 200 sheep, has a truck. Stored as reported, not verified. Ranking recalculates on the next briefing.",
  inputSchema: z.object({
    siteId: z.string().describe("Site code such as REGA-B-1842"),
    species: z.string().describe("sheep, goats, dogs, horses, …"),
    count: z.number().int().nonnegative(),
    hasTransport: z
      .boolean()
      .nullable()
      .describe("true if they have a truck/trailer/car, false if not, null if unknown"),
  }),
  execute: locked(async (input) => {
    const saved = await saveReportedConfirmation({
      siteId: input.siteId,
      species: input.species,
      count: input.count,
      hasTransport: input.hasTransport,
    });
    const state = await getCommandState();
    const site = [...state.sites, ...state.watch].find(
      (item) =>
        item.code.toLowerCase() === input.siteId.toLowerCase() ||
        item.id.toLowerCase() === input.siteId.toLowerCase(),
    );
    return {
      status: saved.source,
      reportedAt: saved.reportedAt,
      note: "Logged as reported, not verified. Registry capacity is unchanged.",
      rank: site?.rank ?? null,
      code: site?.code ?? input.siteId,
      ensemble: site
        ? ensembleReachCopy(site.runsReach, site.ensembleMembers, site.tArrival)
        : null,
      spareTime: site?.spareTime ?? null,
    };
  }),
});

export const registerResidentTool = createTool({
  id: "register-resident",
  description:
    "Opt-in a resident who messaged the bot: address, animals, transport. They receive a Telegram alert only after coordinator Approve.",
  inputSchema: z.object({
    telegramId: z.string().describe("Telegram chat id of the resident"),
    address: z.string(),
    animals: z.string().describe("Short animal list, e.g. 2 dogs"),
    hasTransport: z.boolean(),
    lat: z.number().optional(),
    lon: z.number().optional(),
  }),
  execute: async (input) => {
    await upsertResident({
      telegramId: input.telegramId,
      address: input.address,
      animals: [{ label: input.animals }],
      hasTransport: input.hasTransport,
      lat: input.lat ?? null,
      lon: input.lon ?? null,
    });
    return {
      saved: true,
      telegramId: input.telegramId,
      note: "Registered. No alert is sent until a coordinator Approves alertResidents.",
    };
  },
});

export const alertResidentsTool = createTool({
  id: "alert-residents",
  description:
    "Send the coordinator-approved resident notice. Mass-alert is risky. This tool always waits for Approve/Deny. Never auto-send because 30 minutes passed.",
  requireApproval: true,
  inputSchema: z.object({
    zone: z.string().describe("Zone label, e.g. Bages or Font-rubí"),
    message: z
      .string()
      .optional()
      .describe("Optional extra sentence. Ensemble fire window is attached automatically."),
  }),
  execute: locked(async (input) => {
    await saveAlertRequest({
      zone: input.zone,
      message: input.message ?? "",
      status: "approved",
    });

    const state = await getCommandState();
    const residents = await listOptedInResidents();
    // Not `state.sites[0]`: that is the top *row*, which the cross-check
    // re-sort redefines as "most corroborated". A mass alert has to carry the
    // arrival window of the site soonest out of time.
    const top = mostUrgent(state.sites);
    const fireWindow = top
      ? ensembleReachCopy(top.runsReach, top.ensembleMembers, top.tArrival)
      : `In this ${state.fire.ensembleMembers}-run DEMO ensemble, treat arrival as uncertain.`;
    const shelter = top?.shelterHint ?? "Ask the coordinator for a shelter that takes animals.";

    const text = formatResidentAlert({
      fireWindow,
      shelterHint: shelter,
      municipality: state.fire.municipality,
    });
    const body = input.message ? `${text}\n${input.message}` : text;

    const deliveries = [];
    for (const resident of residents) {
      deliveries.push(await sendTelegramMessage(resident.telegramId, body));
      await sendApprovedTelegramVoice({
        chatId: resident.telegramId,
        town: state.fire.municipality,
        extra: fireWindow,
      });
    }

    return {
      policy: massAlertBlockedReason(),
      requireApproval: MASS_ALERT_POLICY.requireCoordinatorApproval,
      registered: residents.length,
      sent: deliveries.filter((item) => item.ok).length,
      failed: deliveries.filter((item) => !item.ok).map((item) => item.detail),
      preview: body,
      note:
        residents.length === 0
          ? "No opted-in Telegram residents yet. Preview only. Demo household codes are not messaged."
          : "Sent only to opted-in residents who already started the bot.",
    };
  }),
});

export const escalateCoordinatorTool = createTool({
  id: "escalate-coordinator",
  description:
    "If resident-alert Approve is still pending, nudge the coordinator and backup contact. Do not mass-alert residents.",
  inputSchema: z.object({
    pendingMinutes: z.number().nonnegative(),
    reason: z.string().optional(),
  }),
  execute: locked(async (input) => {
    const text = [
      "ARCA escalate — resident alert still waiting for Approve.",
      `Pending about ${input.pendingMinutes} minutes.`,
      input.reason ?? "Fire may have moved. Do not auto-blast residents.",
      massAlertBlockedReason(),
    ].join("\n");

    const targets = [coordinatorChatId(), backupChatId()].filter(
      (id): id is string => Boolean(id),
    );
    const deliveries = [];
    for (const chatId of targets) {
      deliveries.push(await sendTelegramMessage(chatId, text));
    }

    await saveAlertRequest({
      zone: "escalate",
      message: text,
      status: "escalated",
    });

    return {
      escalated: true,
      messaged: deliveries.filter((item) => item.ok).length,
      targets: targets.length,
      text,
      note:
        targets.length === 0
          ? "No COORDINATOR_TELEGRAM_CHAT_ID / TELEGRAM_BACKUP_CHAT_ID. Post this nudge in the current chat. Still do not alert residents."
          : "Nudge sent. Residents were not messaged.",
    };
  }),
});

export const requestSiteCallTool = createTool({
  id: "request-site-call",
  description:
    "Queue a Voice call as awaiting_approval. Does not place or approve the call. Typing Call is not approval. Requires Confine or Evacuate already saved. Uses the env-backed site phone if toNumber is omitted.",
  inputSchema: z.object({
    siteId: z.string().describe("Site code from the ranked list, e.g. REGA-B-1842"),
    toNumber: z
      .string()
      .optional()
      .describe("Number typed this turn, or omit to use the env-backed phone on file. Never invent a number."),
  }),
  execute: locked(async (input) => {
    const permission = await resolveCallPermission(input.siteId);
    if (!permission.ok) {
      return {
        refused: true,
        placed: false,
        status: "refused",
        reason: permission.reason,
        action: permission.action,
        phoneOnFile: phoneOnFileFor(permission.siteId),
        cta: formatCta(afterLookupChoices(false)),
        coordinatorMustRepeatVerbatim: `SAY_THIS_EXACTLY: ${permission.reason}`,
      };
    }
    try {
      const requested = await requestSiteCall({
        siteId: permission.siteId,
        toNumber: input.toNumber ?? "",
      });
      const spoken = formatCoordinatorCallStatus({ status: requested.call.status });
      return {
        refused: false,
        requireApproval: false,
        call: requested.call,
        ...spoken,
        placed: false,
        modelMustSay: modelMustEchoCallStatus(spoken),
        detail: requested.detail,
        retryPolicy: retryPolicyCopy(),
        approval:
          "TYPING IS NOT APPROVAL. Next: invoke call-site so Mastra can show Approve/Deny. Do not treat the coordinator’s last message as approval.",
        cta: formatCta(afterRequestChoices()),
        phoneOnFile: phoneOnFileFor(permission.siteId),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Call request refused.";
      return {
        refused: true,
        placed: false,
        reason,
        phoneOnFile: phoneOnFileFor(permission.siteId),
        coordinatorMustRepeatVerbatim: `SAY_THIS_EXACTLY: ${reason}`,
        cta: formatCta(afterLookupChoices(false)),
      };
    }
  }),
});

export const callSiteTool = createTool({
  id: "call-site",
  description:
    "Place a pending Voice call after the coordinator taps Approve. requireApproval is on: Mastra shows Approve/Deny. Do not invoke this because they typed Call. First spoken sentence is the ARCA disclosure. One Approve covers the retry plan (max 3).",
  requireApproval: true,
  inputSchema: z.object({
    callId: z.string().optional().describe("Pending call id from request-site-call"),
    siteId: z.string().optional().describe("Site code of an existing awaiting_approval request"),
  }),
  execute: locked(async (input) => {
    const pending = input.callId
      ? await getVoiceCall(input.callId)
      : input.siteId
        ? await findAwaitingApprovalCall(input.siteId)
        : null;
    if (!pending) {
      const spoken = formatCoordinatorCallStatus({ status: "denied" });
      return {
        refused: true,
        reason:
          "No pending call waiting for Approve. Use request-site-call first. Typing Call is not approval.",
        ...spoken,
        placed: false,
        coordinatorMustRepeatVerbatim: SAY_THIS_EXACTLY_AWAITING_APPROVE,
        modelMustSay: modelMustEchoCallStatus({
          ...spoken,
          coordinatorMustRepeatVerbatim: SAY_THIS_EXACTLY_AWAITING_APPROVE,
        }),
        cta: formatCta(afterRequestChoices()),
      };
    }

    const permission = await resolveCallPermission(pending.siteId);
    if (!permission.ok) {
      return {
        refused: true,
        placed: false,
        reason: permission.reason,
        action: permission.action,
        coordinatorMustRepeatVerbatim: `SAY_THIS_EXACTLY: ${permission.reason}`,
        cta: formatCta(afterLookupChoices(false)),
      };
    }

    try {
      const placed = await approveSiteCall({ callId: pending.id });
      const spoken = formatCoordinatorCallStatus({
        stub: placed.stub,
        status: placed.call.status,
      });
      return {
        refused: false,
        requireApproval: true,
        call: placed.call,
        detail: placed.detail,
        retryPolicy: retryPolicyCopy(),
        phoneOnFile: phoneOnFileFor(permission.siteId),
        ...spoken,
        stub: placed.stub,
        modelMustSay: modelMustEchoCallStatus(spoken),
        policy:
          "ARCA may place this Voice call only because a human tapped Approve. Coordinator can still dial themselves. Empty 3s hangup is flagged, not looped.",
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Call was not placed.";
      return {
        refused: true,
        placed: false,
        reason,
        coordinatorMustRepeatVerbatim: `SAY_THIS_EXACTLY: ${reason}`,
        modelMustSay: modelMustEchoCallStatus({
          coordinatorMustRepeatVerbatim: `SAY_THIS_EXACTLY: ${reason}`,
          call_status: "CALL_FAILED_NO_LIVE_CALL",
          placed: false,
          stub: false,
          live: false,
        }),
      };
    }
  }),
  toModelOutput: (output) => {
    const record = output as { modelMustSay?: string; coordinatorMustRepeatVerbatim?: string };
    const line =
      record.modelMustSay ??
      record.coordinatorMustRepeatVerbatim ??
      "SAY_THIS_EXACTLY: Test mode, no call placed.";
    return `${line}\n${JSON.stringify(output)}`;
  },
});

export const denySiteCallTool = createTool({
  id: "deny-site-call",
  description: "Cancel a pending Voice request. Does not place a call.",
  inputSchema: z.object({
    callId: z.string().optional(),
    siteId: z.string().optional(),
  }),
  execute: locked(async (input) => {
    const pending = input.callId
      ? await getVoiceCall(input.callId)
      : input.siteId
        ? await findAwaitingApprovalCall(input.siteId)
        : null;
    if (!pending) {
      return { denied: false, reason: "No pending call to deny." };
    }
    const call = await denySiteCall(pending.id);
    const spoken = formatCoordinatorCallStatus({ status: call.status });
    return { denied: true, call, ...spoken, modelMustSay: modelMustEchoCallStatus(spoken) };
  }),
});

export const transcribeVoiceNoteTool = createTool({
  id: "transcribe-voice-note",
  description:
    "Telegram voice-note path when there is no phone. STT via SLNG, then Nebius structures the last-corrected count. Optional siteId saves it as reported, not verified.",
  inputSchema: z.object({
    fileId: z.string().describe("Telegram file_id of the voice note"),
    siteId: z.string().optional(),
  }),
  execute: async (input) => {
    const bytes = await downloadTelegramFile(input.fileId);
    if (!bytes) {
      return { ok: false, detail: "Could not download the Telegram voice note." };
    }
    const stt = await transcribeAudio({ bytes, mimeType: "audio/ogg" });
    const report = await structurePhoneReport(stt.transcript);
    if (input.siteId && report.species && report.count !== null) {
      await saveReportedConfirmation({
        siteId: input.siteId,
        species: report.species,
        count: report.count,
        hasTransport: report.truck,
        channel: "telegram",
        transcript: report.transcript,
        selfCorrected: report.self_corrected,
        discardedCount: report.discardedCount,
        correctionCopy: report.correctionCopy,
      });
    }
    return {
      ok: true,
      transcript: stt.transcript,
      report,
      fallback: stt.fallback,
      note: "Reported, not verified, if a siteId was given.",
    };
  },
});
