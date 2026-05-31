import { toast } from "sonner";
import { normalizeError } from "./normalizeError";
import type { NormalizeErrorOptions, UserFacingError } from "./types";

export interface ShowUserErrorOptions extends NormalizeErrorOptions {
  duration?: number;
  log?: boolean;
}

export function showUserError(error: unknown, options: ShowUserErrorOptions = {}): UserFacingError {
  const userError = normalizeError(error, options);
  const duration = options.duration ?? 4200;

  if (userError.severity === "info") {
    toast.info(userError.message, { description: userError.title, duration });
  } else if (userError.severity === "warning") {
    toast.warning(userError.message, { description: userError.title, duration });
  } else {
    toast.error(userError.message, { description: userError.title, duration });
  }

  if (options.log !== false && process.env.NODE_ENV !== "production") {
    // Keep raw provider/backend detail out of user-facing UI but available in dev tools.
    console.warn("[UserFacingError]", userError);
  }

  return userError;
}
