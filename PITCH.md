# ARCA pitch

> Deepfire tells us where the fire may go. ARCA tells us who needs help first.

The formula ranks automatically. The LLM explains. A human approves any outbound contact. That is the system deciding, with supervision. The model never reorders the list. The coordinator does not tap-rank twenty sites.

**Contact policy** is `config/contact-policy.json`. The dashboard chip reads that file: **Contact policy: human approval required.** The auto-veto window in the same file is `enabled: false` — next step, not this demo.

## 60 seconds

In a wildfire, people don't refuse to leave because they're stupid. They refuse because the dog is family, and the sheep are the rent. In one US survey, a third of people said their pets were a reason not to evacuate. And a farmer with 400 sheep needs hours that a family with a car doesn't.

Emergency teams already have fire data. Deepfire predicts where the fire goes, hour by hour. What nobody hands the coordinator is the list: who's inside that shape, how long each one needs to get out, and who's already running late.

**[Telegram]** That's ARCA. Ten Deepfire simulations; care homes, schools, farms, registered pet owners. Rank by spare time = time until fire minus time to evacuate. Plain math, not AI vibes.

**[list]** Coordinator sees why, calls the farm (or ARCA calls after Approve), logs "200 sheep, one truck." List updates.

**[Approve]** Residents warned only when a human says yes, with a shelter that takes their dog.

Deepfire tells us where the fire may go. ARCA tells us who needs help first.

## Six beats

1. **Animals.** People stay for the dog and the flock. A third of people in one US survey named pets as a reason not to evacuate. A farmer with 400 sheep needs hours a family with a car does not.

2. **The missing list.** Teams already have fire data. Deepfire draws the shape hour by hour, as an ensemble — not a flat three hours. Nobody hands the coordinator who is inside, how long they need, and who is already late.

3. **ARCA.** Ten Deepfire runs. Care homes, schools, farms, registered pet owners. Rank by spare time. Plain math.

4. **Who decides.** Code ranks. The LLM explains why. A human Approves any outbound contact — Telegram or Vonage Voice. The model does not reorder the list.

5. **The call.** Coordinator sees why, phones the farm, or taps Call then Approve. One Approve covers the retry plan (max 3). Log “200 sheep, one truck.” If they say 200 then correct to 300, ARCA saves 300.

6. **Approve.** Residents are warned only when a human says yes, with a shelter from coordinator config that takes their dog — not a live OSM protectora scrape.
