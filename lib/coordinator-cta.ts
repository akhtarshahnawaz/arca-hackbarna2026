export type CoordinatorChoice = {
  id: string;
  label: string;
};

export const CTA_PROMPT =
  "What next? Pick one of these choices. Do not ask a yes/no like “Would you like to call this site now?”";

export function briefingChoices(): CoordinatorChoice[] {
  return [
    { id: "lookup_site", label: "Look up a site" },
    { id: "set_confine", label: "Set Confine" },
    { id: "set_evacuate", label: "Set Evacuate" },
    {
      id: "request_call",
      label: "Request a call (Approve button comes next — typing Call is not approval)",
    },
    { id: "log_report", label: "Log a farmer report" },
  ];
}

export function afterLookupChoices(mayCall: boolean): CoordinatorChoice[] {
  if (!mayCall) {
    return [
      { id: "set_confine", label: "Set Confine" },
      { id: "set_evacuate", label: "Set Evacuate" },
      { id: "lookup_site", label: "Look up another site" },
    ];
  }
  return [
    {
      id: "request_call",
      label: "Request a call (Approve button comes next — typing Call is not approval)",
    },
    { id: "lookup_site", label: "Look up another site" },
    { id: "log_report", label: "Log a farmer report" },
  ];
}

export function afterRequestChoices(): CoordinatorChoice[] {
  return [
    {
      id: "wait_approve",
      label: "Tap Approve on the approval card (Telegram Approve/Deny or Studio Approve)",
    },
    { id: "deny", label: "Deny / cancel" },
  ];
}

export function formatCta(choices: CoordinatorChoice[]): {
  prompt: string;
  choices: CoordinatorChoice[];
  choiceList: string;
} {
  return {
    prompt: CTA_PROMPT,
    choices,
    choiceList: [CTA_PROMPT, ...choices.map((choice, index) => `${index + 1}. ${choice.label}`)].join(
      "\n",
    ),
  };
}
