export type CalendarEventSource = "voice" | "text" | "demo" | "manual";

export type CalendarEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location?: string;
  notes?: string;
  reminderMinutesBefore?: number;
  reminderTriggered?: boolean;
  source: CalendarEventSource;
  createdAt: string;
  updatedAt: string;
};

export type CommandInputSource = "voice" | "text" | "demo";

export type CommandInput = {
  text: string;
  source: CommandInputSource;
  currentTime: string;
  timezone: string;
};

export type CreateEventArgs = {
  title: string;
  startAt: string;
  endAt?: string;
  location?: string;
  notes?: string;
  reminderMinutesBefore?: number;
};

export type QueryEventsArgs = {
  rangeStartAt: string;
  rangeEndAt: string;
  keyword?: string;
};

export type FindEventsForDeleteArgs = {
  rangeStartAt?: string;
  rangeEndAt?: string;
  keyword?: string;
};

export type CommandToolName =
  | "create_event"
  | "query_events"
  | "find_events_for_delete"
  | "unknown";

type ParsedCommandBase<TTool extends CommandToolName, TArguments> = {
  tool: TTool;
  arguments: TArguments;
  confidence?: number;
  missingFields?: string[];
  clarificationQuestion?: string;
};

export type ParsedCommand =
  | ParsedCommandBase<"create_event", CreateEventArgs>
  | ParsedCommandBase<"query_events", QueryEventsArgs>
  | ParsedCommandBase<"find_events_for_delete", FindEventsForDeleteArgs>
  | ParsedCommandBase<"unknown", unknown>;
