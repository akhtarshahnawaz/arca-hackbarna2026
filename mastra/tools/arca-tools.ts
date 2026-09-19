import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { MASS_ALERT_POLICY, massAlertBlockedReason } from "../../lib/alert-policy";
import { formatCoordinatorBriefing, formatResidentAlert } from "../../lib/briefing";
import { getCommandState } from "../../lib/command";
import {
  listOptedInResidents,
  saveAlertRequest,
  saveReportedConfirmation,
  upsertResident,
} from "../../lib/db";
import { ensembleReachCopy } from "../../lib/ranking";
import {
  backupChatId,
  coordinatorChatId,
  sendTelegramMessage,
} from "../../lib/telegram";

export const getBriefingTool = createTool({
  id: "get-briefing",
  description:
    "Coordinator briefing: Font-rubí / demo fire, simulation status, ranked call list with ensemble language. Use this on /start, /briefing, or when asked who to call.",
  inputSchema: z.object({
    zone: z.string().optional().describe("Optional zone label. Demo uses Bages / Font-rubí."),
  }),
  execute: async () => {
    const state = await getCommandState();
    return {
      text: formatCoordinatorBriefing(state),
      fire: state.fire.name,
      municipality: state.fire.municipality,
      simulation: "DEMO ensemble — not a live Deepfire perimeter",
      rankedCount: state.sites.length,
      watchCount: state.watch.length,
    };
  },
});

export const getActiveFiresTool = createTool({
  id: "get-active-fires",
  description: "Active fire / hotspot status for the coordinator zone. Hotspots are not perimeters.",
  inputSchema: z.object({
    zone: z.string().optional(),
  }),
  execute: async () => {
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
  },
});

export const rankSitesTool = createTool({
  id: "rank-sites",
  description:
    "Return the current ranked list. You never invent a new order. Filter likely/possible first; watch is separate.",
  inputSchema: z.object({}),
  execute: async () => {
    const state = await getCommandState();
    return {
      ranked: state.sites.map((site) => ({
        rank: site.rank,
        code: site.code,
        kind: site.kind,
        ensemble: ensembleReachCopy(site.runsReach, site.ensembleMembers, site.tArrival),
        spareTime: site.spareTime,
        confirmationStatus: site.confirmationStatus ?? (site.confirmedAt ? "reported" : null),
      })),
      watch: state.watch.map((site) => ({
        code: site.code,
        ensemble: ensembleReachCopy(site.runsReach, site.ensembleMembers, site.tArrival),
      })),
    };
  },
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
  execute: async (input) => {
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
  },
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
  execute: async (input) => {
    await saveAlertRequest({
      zone: input.zone,
      message: input.message ?? "",
      status: "approved",
    });

    const state = await getCommandState();
    const residents = await listOptedInResidents();
    const top = state.sites[0];
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
  },
});

export const escalateCoordinatorTool = createTool({
  id: "escalate-coordinator",
  description:
    "If resident-alert Approve is still pending, nudge the coordinator and backup contact. Do not mass-alert residents.",
  inputSchema: z.object({
    pendingMinutes: z.number().nonnegative(),
    reason: z.string().optional(),
  }),
  execute: async (input) => {
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
  },
});
