import { GatewayError } from "./errors";
import { parseInkAssessment } from "@core";
import type { JsonObject } from "./media";
import { Providers } from "./providers";
import type { GatewayConfig } from "./config";

export async function vision(
  input: JsonObject,
  providers: Providers,
  config: GatewayConfig,
  signal: AbortSignal,
) {
  if (config.demo)
    return {
      readback: ["1/2 + 1/4", "= 2/6"],
      legibility: "readable",
      observations: ["You are combining two fractions."],
      issues: [{
        evidence: "= 2/6",
        concern: "The parts being added are different sizes.",
        question: "How could you express both fractions using equal-sized parts?",
      }],
      nextStep: "Sketch the two fractions on matching strips before trying the addition again.",
      provider: "demo",
      source: "Scripted fraction review; not analysis of your drawing",
    };
  const raw = await providers.vision(
    'Help the learner inspect their drawing. The last image is their current work; an optional earlier image supplies the task. Return JSON {"readback":[string],"legibility":"readable"|"partial"|"unreadable","observations":[string],"issues":[{"evidence":string,"concern":string,"question":string}],"nextStep":string}. First read visible writing without correcting or completing it. Readback contains only current visible writing, at most 60 lines. Then give up to 4 neutral observations and up to 3 specific issues; each issue must quote an exact excerpt from readback as evidence, explain the concern briefly, and ask a question the learner can investigate. Never provide a final answer, corrected working, or a worked substitute example. A learner goal gives context but is not evidence of their work. Prior readback only helps compare recognition; never copy absent or covered writing. Messy, slow, incomplete, or blank work alone is not a mistake. If any required writing is ambiguous, choose partial and give no observations or issues. If no writing can be read, choose unreadable with empty readback, observations, and issues. The nextStep suggests one learner action without solving the task.',
    { goal: input.goal || "", previousLines: input.previousLines || [] },
    String(input.image),
    signal,
    input.context as string | undefined,
  );
  const assessment = parseInkAssessment(raw);
  if (!assessment)
    throw new GatewayError(502, "Drawing review returned invalid or ungrounded feedback. Check the image and try again.");
  return { ...assessment, provider: providers.provider };
}
