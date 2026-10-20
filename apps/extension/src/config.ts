declare const __FOCAL_ORIGIN__: string | undefined;

/** focal website / API origin, injected at build time (FOCAL_ORIGIN). */
export const FOCAL_ORIGIN: string =
  typeof __FOCAL_ORIGIN__ === "string" && __FOCAL_ORIGIN__ ? __FOCAL_ORIGIN__ : "http://localhost:3000";

export const FOCAL_HOSTS: string[] = [new URL(FOCAL_ORIGIN).hostname, "focal.ai"];
