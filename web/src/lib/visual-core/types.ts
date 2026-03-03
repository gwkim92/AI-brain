export type Jarvis3DBaseMode =
  | "default"
  | "stream"
  | "risk"
  | "sdf_brain"
  | "sdf_infinity"
  | "sdf_eye"
  | "sdf_crystal"
  | "multi_attractor"
  | "cinematic_dof";

export type Jarvis3DOverlayFx = "event_ripple";

export type Jarvis3DMode = Jarvis3DBaseMode | Jarvis3DOverlayFx;

export type Jarvis3DSignalSnapshot = {
  runningCount: number;
  blockedCount: number;
  failedCount: number;
  pendingApprovalCount: number;
  focusedWidget: string | null;
};

export type Jarvis3DScene = {
  baseMode: Jarvis3DBaseMode;
  overlayFx: Jarvis3DOverlayFx[];
  reason: string;
  priority: number;
  signals: Jarvis3DSignalSnapshot;
};
