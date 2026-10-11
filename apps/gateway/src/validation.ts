import { parseAction, parseAgentRequest, parseTaskAssessmentRequest, type Action, type AgentRequest, type TaskAssessmentRequest } from "@core";
import {
  isImage,
  isNumber,
  isObject,
  isText,
  isWebUrl,
  requireInput,
  requireObject,
  stringList,
} from "./media";
const maybe = (value: unknown, check: (value: unknown) => boolean) =>
  value === undefined || check(value);
/** Core parsers are shared with the extension, so wire contracts cannot drift. */
export function validAction(value: unknown): value is Action {
  return parseAction(value) !== null;
}
export function validateAgent(value: unknown): AgentRequest {
  const request = parseAgentRequest(value);
  requireInput(request !== null, "Invalid agent request: missing, malformed, or oversized fields.");
  requireInput(isWebUrl(request.page.url), "Agent requests need an accessible HTTP(S) page.");
  return request;
}
export function validateTaskAssessment(value: unknown): TaskAssessmentRequest {
  const request = parseTaskAssessmentRequest(value);
  requireInput(request !== null, "Invalid project progress assessment.");
  requireInput(isWebUrl(request.page.url), "Project assessment needs an accessible HTTP(S) page.");
  return request;
}
export function validateRoute(path: string, value: unknown) {
  const input = requireObject(value);
  if (path === "/api/agent") {
    validateAgent(input);
    return input;
  }
  switch (path) {
    case "/api/task/assess":
      validateTaskAssessment(input);
      break;
    case "/api/cancel":
      requireInput(isText(input.requestId, 128) && !!input.requestId);
      break;
    case "/api/learn/plan":
      requireInput(isText(input.goal ?? input.topic, 2000) && !!(input.goal ?? input.topic));
      break;
    case "/api/learn/judge":
      requireInput(isText(input.goal ?? input.problem, 5000) && isText(input.working, 20_000));
      break;
    case "/api/learn/teachback":
      requireInput(isText(input.concept, 2000) && isText(input.explanation, 10_000));
      break;
    case "/api/video":
      requireInput(
        isWebUrl(input.url) &&
          maybe(input.title, (v) => isText(v, 3000)) &&
          maybe(input.question, (v) => isText(v, 3000)) &&
          maybe(
            input.segments,
            (v) =>
              Array.isArray(v) &&
              v.length <= 6000 &&
              v.every(
                (segment) =>
                  isObject(segment) &&
                  isText(segment.text, 2000) &&
                  isNumber(segment.start) &&
                  isNumber(segment.end, Number(segment.start)),
              ),
          ) &&
          maybe(
            input.chapters,
            (v) =>
              Array.isArray(v) &&
              v.length <= 200 &&
              v.every(
                (chapter) =>
                  isObject(chapter) && isNumber(chapter.start) && isText(chapter.title, 1000),
              ),
          ),
      );
      break;
    case "/api/ink":
    case "/api/notebook":
      requireInput(
        isImage(input.image) &&
          maybe(input.context, isImage) &&
          maybe(input.previousLines, (v) => stringList(v)) &&
          maybe(input.rung, (v) => isNumber(v, 1, 5)),
      );
      break;
    case "/api/character":
      requireInput(isImage(input.image) && maybe(input.description, (v) => isText(v, 2000)));
      break;
    case "/api/lookup":
      requireInput(isText(input.query, 1000) && !!input.query.trim());
      break;
    default:
      requireInput(false, "Unknown API route.");
  }
  return input;
}
