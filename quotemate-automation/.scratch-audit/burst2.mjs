// lib/roofing/pricing.ts
function pitchBucketFromDegrees(deg) {
  if (!Number.isFinite(deg) || deg <= 0 || deg >= 80) return "unknown";
  if (deg < 20) return "shallow";
  if (deg <= 25) return "standard";
  if (deg <= 35) return "steep";
  return "very_steep";
}

// lib/sms/roofing-intake.ts
var AU_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"];
var ROOFING_KEYWORDS = [
  "re-roof",
  "reroof",
  "re roof",
  "roof replacement",
  "replace the roof",
  "new roof",
  "roofing",
  "roof leak",
  "leaking roof",
  "roof repair",
  "roof restoration",
  "gutter",
  "downpipe",
  "down pipe",
  "ridge cap",
  "ridge caps",
  "valley iron",
  "roof flashing",
  "whirlybird",
  "whirly bird",
  "colorbond roof",
  "tile roof",
  "tiled roof",
  "metal roof",
  "eaves",
  "fascia",
  "sarking",
  // "roofer" is a tradesperson noun — unlike bare "roof" it is never
  // incidental, so it needs no accompanying work verb. "Need a roofer" and
  // "roofer?" both reached the electrical dialog before 2026-07-22.
  "roofer"
];
var NOT_ROOFING = /\broof\s?(cavity|space|void)\b|\bin the roof\b|\bunder the roof\b/;
var ROOFING_WORK = /\b(quot\w*|estimat\w*|price[sd]?|pricing|cost\w*|how much|replac\w*|repair\w*|fix\w*|leak\w*|redo|redone|restor\w*|paint\w*|inspect\w*|broken|cracked|damaged|old|new|done|doing|need\w*|want\w*|look\w* at|sort\w* out|do you do)\b/;
function looksLikeRoofingEnquiry(text) {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return false;
  if (NOT_ROOFING.test(t)) return false;
  if (ROOFING_KEYWORDS.some((k) => t.includes(k))) return true;
  if (/\broofs?\b/.test(t) && ROOFING_WORK.test(t)) return true;
  return false;
}
var UNSURE = /\b(not sure|unsure|no idea|dunno|don'?t know|do not know|no clue|couldn'?t say|hard to say)\b/;
var GENERIC_METAL = /\bcolou?r[\s-]?bond\b|\bcolou?r[\s-]?blind\b|\b(metal|tin|steel|zincalume)\b/;
var CORRUGATED_WORDS = "corro|corrugated|custom ?orb|iron|galv|galvanised|galvanized|classic|wavy|wave|ripple[ds]?";
var TRIMDEK_WORDS = "trimdek|trim ?dek|flat panel[s]?|square rib[s]?";
var KLIPLOK_WORDS = "klip-?lok|kliplok|standing seam|concealed fix";
var SPANDEK_WORDS = "spandek|span ?deck";
var CORRUGATED = new RegExp(`\\b(${CORRUGATED_WORDS})\\b`);
var TRIMDEK = new RegExp(`\\b(${TRIMDEK_WORDS})\\b`);
var KLIPLOK = new RegExp(`\\b(${KLIPLOK_WORDS})\\b`);
var SPANDEK = new RegExp(`\\b(${SPANDEK_WORDS})\\b`);
var NAMED_PROFILE = new RegExp(
  `\\b(${[CORRUGATED_WORDS, TRIMDEK_WORDS, KLIPLOK_WORDS, SPANDEK_WORDS].join("|")})\\b`
);
function isAmbiguousMetal(text) {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return false;
  if (UNSURE.test(t)) return false;
  return GENERIC_METAL.test(t) && !NAMED_PROFILE.test(t);
}
function mapMaterial(text) {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (UNSURE.test(t)) return "unknown";
  if (/\b(asbestos|fibro|cement sheet|super ?six|fibrolite|ac sheet)\b/.test(t)) return "cement_sheet";
  if (/\b(slate|shingles?|asphalt|shake|thatch|polycarbonate|fibreglass)\b/.test(t)) return "unknown";
  if (KLIPLOK.test(t)) return "colorbond_kliplok";
  if (SPANDEK.test(t)) return "colorbond_spandek";
  if (CORRUGATED.test(t)) return "colorbond_corrugated";
  if (TRIMDEK.test(t)) return "colorbond_trimdek";
  if (GENERIC_METAL.test(t)) return null;
  if (/\b(terracotta|terra ?cotta|clay tile|clay tiles)\b/.test(t)) return "terracotta_tile";
  if (/\b(concrete tile|cement tile|concrete tiles)\b/.test(t)) return "concrete_tile";
  if (/\btiles?\b/.test(t)) return "concrete_tile";
  return null;
}
function mapPitch(text) {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (UNSURE.test(t)) return "unknown";
  const deg = t.match(/(\d{1,2}(?:\.\d+)?)\s*(?:°|deg\b|degs\b|degree|degrees)/);
  if (deg) return pitchBucketFromDegrees(Number(deg[1]));
  if (/\bnot\s+(too\s+|that\s+|very\s+|so\s+|really\s+)?steep\w*/.test(t)) return "standard";
  if (/\b(very|really|super|extremely)\s+steep\w*|\bnear vertical\b/.test(t)) return "very_steep";
  if (/\bsteep\w*|\bsharp\b|\bhigh[- ]?pitch/.test(t)) return "steep";
  if (/\b(flat|low|low pitch|low-pitched|shallow|barely|gentle|skillion)\b/.test(t)) return "shallow";
  if (/\b(standard|normal|average|medium|regular|typical|usual|moderate)\b/.test(t)) return "standard";
  return null;
}
function mapIntent(text) {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (/\bre-?roof/.test(t)) return "full_reroof";
  if (/\b(whole|entire|full|new)\s+roof/.test(t)) return "full_reroof";
  if (/\broofs?\s+replac\w*/.test(t)) return "full_reroof";
  if (/\breplac\w*\s+(the\s+|my\s+|our\s+|that\s+|existing\s+)*roof/.test(t)) return "full_reroof";
  if (/\b(all of it|replace it all|the lot|whole thing|whole lot)\b/.test(t)) return "full_reroof";
  if (/\b(leak|leaking|water coming|dripping)\b/.test(t)) return "leak_trace";
  if (/\b(gutters?|downpipes?|down ?pipes?)\b/.test(t)) return "gutter_replace";
  if (/\b(ridges?|caps?|repoint|rebed)\b/.test(t)) return "ridge_cap";
  if (/\b(flashings?)\b/.test(t)) return "flashing_repair";
  if (/\b(repairs?|patch|fix|broken|cracked|damaged|missing|few tiles)\b/.test(t)) return "patch_repair";
  if (/\breplac\w*/.test(t)) return "full_reroof";
  return null;
}
function parseYearBuilt(text) {
  const t = (text ?? "").toLowerCase();
  const decade = t.match(/\b(18|19|20)(\d0)s\b/);
  if (decade) {
    const y = Number(`${decade[1]}${decade[2]}`);
    if (y >= 1850 && y <= 2100) return y;
  }
  const m = t.match(/\b(18|19|20)\d{2}\b/);
  if (m) {
    const y = Number(m[0]);
    if (y >= 1850 && y <= 2100) return y;
  }
  return null;
}
function parsePostcode(text) {
  const all = (text ?? "").match(/\b\d{4}\b/g);
  return all && all.length > 0 ? all[all.length - 1] : null;
}
function parseAuState(text) {
  const up = (text ?? "").toUpperCase();
  for (const s of AU_STATES) {
    if (new RegExp(`\\b${s}\\b`).test(up)) return s;
  }
  return null;
}
var AFFIRM = /\b(yes|yep|yeah|yup|correct|right|that'?s right|that'?s it|confirmed|sure|ok|okay|👍)\b/;
var DENY = /\b(no|nope|nah|wrong|incorrect|not right|different)\b/;
function isAffirmative(text) {
  return AFFIRM.test((text ?? "").toLowerCase());
}
function isNegative(text) {
  return DENY.test((text ?? "").toLowerCase());
}
var STOP_RE = /\b(stop|cancel|cancelled|unsubscribe|quit|end this|end the|not interested|leave me alone|go away|never ?mind|forget it)\b/;
var FRUSTRATION_RE = /\b(f+u+c+k+|f\*+ck|fck|stfu|piss off|bugger off|bullsh|shut up)\b/;
function isStopRequest(text) {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return false;
  return STOP_RE.test(t) || FRUSTRATION_RE.test(t);
}
function extractStreetAddress(text) {
  const t = (text ?? "").trim();
  if (!t || isStopRequest(t)) return null;
  const m = t.match(/\d[\d/\-a-zA-Z]*\s+[A-Za-z].*/);
  if (!m) return null;
  const addr = m[0].trim().replace(/\s+/g, " ");
  return addr.length >= 6 ? addr : null;
}
function applyRoofingAnswer(slots, step, message) {
  const next = { ...slots };
  const msg = message ?? "";
  switch (step) {
    case "address": {
      const addr = extractStreetAddress(msg);
      if (addr) {
        next.address = addr;
        const pc = parsePostcode(msg);
        if (pc) next.postcode = pc;
        const st = parseAuState(msg);
        if (st) next.state = st;
        next.address_confirmed = false;
      }
      break;
    }
    case "confirm_address": {
      const barePostcode = msg.trim().match(/^(\d{4})$/);
      if (barePostcode && next.address) {
        next.postcode = barePostcode[1];
        if (!next.address.includes(barePostcode[1])) {
          next.address = `${next.address} ${barePostcode[1]}`;
        }
        break;
      }
      const corrected = extractStreetAddress(msg);
      if (corrected && corrected !== next.address) {
        next.address = corrected;
        next.postcode = parsePostcode(msg);
        next.state = parseAuState(msg);
        next.address_confirmed = false;
        break;
      }
      if (isAffirmative(msg) && !isNegative(msg)) {
        next.address_confirmed = true;
      } else if (isNegative(msg)) {
        next.address = null;
        next.postcode = null;
        next.state = null;
        next.address_confirmed = false;
      }
      break;
    }
    case "intent": {
      const v = mapIntent(msg);
      if (v) next.intent = v;
      break;
    }
    case "material": {
      const v = mapMaterial(msg);
      if (v) {
        next.material = v;
        next.metal_hint = false;
      } else if (isAmbiguousMetal(msg)) {
        next.metal_hint = true;
      }
      break;
    }
    case "material_profile": {
      const v = mapMaterial(msg);
      if (v) {
        next.material = v;
        next.metal_hint = false;
      } else {
        next.material = "unknown";
        next.metal_hint = false;
      }
      break;
    }
    case "pitch": {
      const v = mapPitch(msg);
      if (v) next.pitch = v;
      break;
    }
    default:
      break;
  }
  if (next.year_built == null) {
    const y = parseYearBuilt(msg);
    if (y != null) next.year_built = y;
  }
  return next;
}
var QUESTIONS = {
  address: "Happy to sort a roofing quote for you. What's the property address, including suburb and postcode?",
  confirm_address: "",
  // filled dynamically with the address read-back
  intent: "What do you need done? A full re-roof, a repair or patch, a leak traced, or gutters and downpipes?",
  material: "What's the roof made of? For example Colorbond or metal, concrete or terracotta tiles, or fibro / cement sheet.",
  material_profile: "Righto \u2014 which Colorbond profile is it? Corrugated (the classic wavy sheets) or Trimdek (flat panels with square ribs)? If you're not sure, just say so and we'll check it on site.",
  pitch: "Roughly how steep is the roof? Flat, standard, or steep?"
};
function nextRoofingStep(slots) {
  if (!slots.address) return { step: "address", question: QUESTIONS.address };
  if (!slots.address_confirmed) {
    return {
      step: "confirm_address",
      question: `Just to confirm, the property is "${slots.address}". Is that right? Reply yes or no.`
    };
  }
  if (!slots.intent) return { step: "intent", question: QUESTIONS.intent };
  if (slots.intent === "unknown") {
    return { step: "inspection", reason: "we couldn't confirm what work is needed" };
  }
  if (slots.material === "cement_sheet") {
    return { step: "inspection", reason: "cement sheet or fibro roofs may contain asbestos" };
  }
  if (slots.material === "unknown") {
    return { step: "inspection", reason: "we couldn't confirm the roof material" };
  }
  if (!slots.material && slots.metal_hint) {
    return { step: "material_profile", question: QUESTIONS.material_profile };
  }
  if (!slots.material) return { step: "material", question: QUESTIONS.material };
  if (slots.pitch === "very_steep" || slots.pitch === "unknown") {
    return { step: "inspection", reason: "the roof pitch is steep or unknown" };
  }
  if (!slots.pitch) return { step: "pitch", question: QUESTIONS.pitch };
  return { step: "ready" };
}

// lib/sms/roofing-receptionist.ts
var ANSWERABLE_STEPS = /* @__PURE__ */ new Set([
  "address",
  "confirm_address",
  "intent",
  "material",
  "material_profile",
  "pitch"
]);
var WRONG_BUILDING_REPROMPT = "No worries. What's the correct property address, with suburb and postcode?";
var ADDRESS_RETRY = "Sorry, I didn't catch a property address there. What's the address? Please include the street number, suburb and postcode.";
var ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
function parseStructureChoice(inbound, count) {
  const t = (inbound ?? "").toLowerCase();
  const secondary = t.match(/secondary\s*(?:structure|building)?\s*#?(\d{1,2})/);
  if (secondary) {
    const n = Number(secondary[1]) + 1;
    if (n >= 1 && n <= count) return n;
  }
  if (/\b(main dwelling|main house|main building|main structure|main roof|the main one|main one)\b/.test(t)) {
    return 1;
  }
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(t) && n <= count) return n;
  }
  const m = t.match(/\b#?(\d{1,2})\b/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= count) return n;
  }
  return null;
}
var FOLLOWUP_FILLER = /\b(and|the|a|an|number|numbers|no|nos|just|only|please|pls|thanks|thx|ta|too|one|ones|of|me|my|give|send|do|it|its|yes|yep|ok|okay|okey|sure|for|i|id|want|wanna|need|can|could|would|you|get|us|actually|quote|quotes|breakdown|breakdowns|estimate|estimates|pricing|price|prices|about|what|hey|hi|see|show|them|those|these|also)\b/g;
var PICK_TOKENS = /#?\d{1,2}|\b(first|second|third|fourth|fifth|all|both|everything|every|others?|rest|remaining|lot|buildings?|structures?|shed|garage|granny|flat|carport|outbuilding|dwelling)\b/g;
var STRUCTURE_CUE = /\b(building|buildings|structure|structures|shed|garage|granny|carport|outbuilding|dwelling|breakdown|re-?roof|roofs?)\b/;
function parseStructureFollowup(inbound, count, alreadyServed) {
  const t = (inbound ?? "").toLowerCase().trim();
  if (!t || count < 1) return null;
  const hasCue = STRUCTURE_CUE.test(t);
  const residue = t.replace(PICK_TOKENS, " ").replace(FOLLOWUP_FILLER, " ").replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
  const isPurePick = residue.length === 0;
  if (!hasCue && !isPurePick) return null;
  if (/\b(all|all of them|all of it|all of the|everything|all the buildings|all structures|both of them|both buildings|both)\b/.test(t)) {
    return "all";
  }
  if (/\b(the others?|the rest|remaining|other ones?|other buildings?)\b/.test(t)) {
    const served = new Set(alreadyServed ?? []);
    const rest = [];
    for (let i = 1; i <= count; i++) if (!served.has(i)) rest.push(i);
    return rest.length > 0 ? rest : null;
  }
  const nums = /* @__PURE__ */ new Set();
  for (const mm of t.matchAll(/#?(\d{1,2})/g)) {
    const n = Number(mm[1]);
    if (n >= 1 && n <= count) nums.add(n);
  }
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(t) && n <= count) nums.add(n);
  }
  if (nums.size > 0) return [...nums].sort((a, b) => a - b);
  if (count > 1 && /\b(shed|garage|granny flat|secondary|outbuilding|carport)\b/.test(t)) {
    const secondary = [];
    for (let i = 2; i <= count; i++) secondary.push(i);
    return secondary;
  }
  return null;
}
function missBudget(step) {
  return step === "address" ? 3 : 2;
}
function answerLanded(before, after, step) {
  switch (step) {
    case "address":
      return !!after.address;
    case "confirm_address":
      return after.address_confirmed === true || !after.address || after.address !== before.address || after.postcode !== before.postcode;
    case "intent":
      return !!after.intent;
    case "material":
      return !!after.material || after.metal_hint === true;
    case "material_profile":
      return !!after.material;
    case "pitch":
      return !!after.pitch;
    default:
      return true;
  }
}
function advanceRoofing(prev, inbound) {
  const rawLastStep = prev?.last_step ?? null;
  let slots = { ...prev?.slots ?? {} };
  if (isStopRequest(inbound)) {
    return { action: "cancel", slots };
  }
  if (rawLastStep === "await_booking") {
    return { action: "booking", slots, confirmed: isAffirmative(inbound) && !isNegative(inbound) };
  }
  if (rawLastStep === "confirm_roof") {
    const count = prev?.pending_structure_count ?? 1;
    if (isNegative(inbound)) {
      const reset = {
        ...slots,
        address: null,
        postcode: null,
        state: null,
        address_confirmed: false
      };
      return { action: "ask", slots: reset, step: "address", reply: WRONG_BUILDING_REPROMPT };
    }
    const choice = parseStructureChoice(inbound, count);
    if (choice != null && count > 1) {
      return { action: "send_saved", slots, structureChoices: [choice] };
    }
    if (count > 1 && parseStructureFollowup(inbound, count) === "all") {
      return { action: "send_saved", slots, structureChoices: null };
    }
    if (isAffirmative(inbound)) {
      return { action: "send_saved", slots, structureChoices: null };
    }
    return { action: "reconfirm", slots };
  }
  if (rawLastStep === "quoted") {
    const count = prev?.pending_structure_count ?? 1;
    const picks = parseStructureFollowup(inbound, count, prev?.last_served_structures ?? null);
    if (picks === "all") return { action: "send_saved", slots, structureChoices: null };
    if (picks && picks.length > 0) return { action: "send_saved", slots, structureChoices: picks };
    if (!looksLikeRoofingEnquiry(inbound)) return { action: "passthrough", slots };
  }
  let lastStep = rawLastStep;
  if (rawLastStep === "closed" || rawLastStep === "quoted") {
    slots = {};
    lastStep = null;
  }
  let nextSlots = slots;
  if (lastStep && ANSWERABLE_STEPS.has(lastStep)) {
    nextSlots = applyRoofingAnswer(slots, lastStep, inbound);
    if (answerLanded(slots, nextSlots, lastStep)) {
      delete nextSlots.misses;
    } else {
      const misses = (slots.misses ?? 0) + 1;
      if (misses >= missBudget(lastStep)) {
        delete nextSlots.misses;
        if (lastStep === "material") nextSlots.material = "unknown";
        else if (lastStep === "pitch") nextSlots.pitch = "unknown";
        else if (lastStep === "intent") nextSlots.intent = "unknown";
        else {
          return {
            action: "inspection",
            slots: nextSlots,
            reason: "we couldn't confirm the property address"
          };
        }
      } else {
        nextSlots = { ...nextSlots, misses };
        if (lastStep === "address") {
          return { action: "ask", slots: nextSlots, step: "address", reply: ADDRESS_RETRY };
        }
      }
    }
  } else {
    if (!nextSlots.intent) {
      const intent = mapIntent(inbound);
      if (intent) nextSlots.intent = intent;
    }
    if (!nextSlots.address) {
      const addr = extractStreetAddress(inbound);
      if (addr) {
        nextSlots.address = addr;
        const pc = parsePostcode(inbound);
        if (pc) nextSlots.postcode = pc;
        const st = parseAuState(inbound);
        if (st) nextSlots.state = st;
        nextSlots.address_confirmed = false;
      }
    }
    if (!nextSlots.material) {
      const m = mapMaterial(inbound);
      if (m) nextSlots.material = m;
      else if (isAmbiguousMetal(inbound)) nextSlots.metal_hint = true;
    }
    if (nextSlots.year_built == null) {
      const y = parseYearBuilt(inbound);
      if (y != null) nextSlots.year_built = y;
    }
  }
  const next = nextRoofingStep(nextSlots);
  if (next.step === "ready") return { action: "measure", slots: nextSlots };
  if (next.step === "inspection") {
    return { action: "inspection", slots: nextSlots, reason: next.reason ?? "on-site inspection required" };
  }
  return { action: "ask", slots: nextSlots, step: next.step, reply: next.question ?? "" };
}
function isActiveRoofingFlow(prev) {
  if (!prev || !prev.slots) return false;
  const step = prev.last_step ?? null;
  return step !== null && step !== "closed";
}
function shouldEngageRoofing(prev, inbound, followupPinActive, roofingOnly = false) {
  const canResume = isActiveRoofingFlow(prev) && !followupPinActive;
  if (canResume) return true;
  if (looksLikeRoofingEnquiry(inbound)) return true;
  return roofingOnly && !followupPinActive;
}

// .scratch-audit/burst2.ts
function latestInbound(turns) {
  return [...turns].reverse().find((t) => t.direction === "inbound")?.body ?? "";
}
function run(label, turns) {
  const inbound = latestInbound(turns);
  const engage = shouldEngageRoofing(null, inbound, false, true);
  const d = advanceRoofing(null, inbound);
  console.log(`
${label}`);
  console.log("  all inbound texts:", JSON.stringify(turns.filter((t) => t.direction === "inbound").map((t) => t.body)));
  console.log("  receptionist sees:", JSON.stringify(inbound));
  console.log("  action/step:", d.action, d.step ?? "", "|", d.reply ?? d.reason ?? "");
  console.log("  harvested slots:", JSON.stringify(d.slots));
}
run('Opening burst: address in msg2, "asap" trails', [
  { direction: "inbound", body: "hi" },
  { direction: "inbound", body: "need a reroof at 12 Smith St Bondi NSW 2026" },
  { direction: "inbound", body: "asap please" }
]);
run("Single opening message (harvest works)", [
  { direction: "inbound", body: "need a reroof at 12 Smith St Bondi NSW 2026 asap please" }
]);
