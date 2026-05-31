export type PendingActionType = "create_event" | "delete_event";

export interface ActionPreview {
  title: string;
  summary: string;
  items: {
    label: string;
    value: string;
  }[];
  warnings?: string[];
}

export interface PendingAction {
  id: string;
  type: PendingActionType;
  status: "pending" | "confirmed" | "cancelled" | "executed";
  preview: ActionPreview;
  payload: unknown;
  createdAt: string;
}
