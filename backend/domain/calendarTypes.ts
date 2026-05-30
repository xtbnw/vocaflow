import { z } from "zod";

const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const CalendarEventSourceSchema = z.enum([
  "voice",
  "text",
  "demo",
  "manual",
]);

export const CalendarEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  startAt: IsoDateTimeSchema,
  endAt: IsoDateTimeSchema,
  location: z.string().optional(),
  notes: z.string().optional(),
  reminderMinutesBefore: z.number().int().nonnegative().optional(),
  reminderTriggered: z.boolean().optional(),
  source: CalendarEventSourceSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const CommandInputSourceSchema = z.enum(["voice", "text", "demo"]);

export const CommandInputSchema = z.object({
  text: z.string().min(1),
  source: CommandInputSourceSchema,
  currentTime: IsoDateTimeSchema,
  timezone: z.string().min(1),
});

export const CreateEventArgsSchema = z.object({
  title: z.string().min(1),
  startAt: IsoDateTimeSchema,
  endAt: IsoDateTimeSchema.optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  reminderMinutesBefore: z.number().int().nonnegative().optional(),
});

export const QueryEventsArgsSchema = z.object({
  rangeStartAt: IsoDateTimeSchema,
  rangeEndAt: IsoDateTimeSchema,
  keyword: z.string().optional(),
});

export const DeleteEventArgsSchema = z.object({
  eventIds: z.array(z.string().min(1)).min(1),
});

export const CommandToolNameSchema = z.enum([
  "create_event",
  "query_events",
  "delete_event",
  "unknown",
]);

const ParsedCommandMetadataSchema = z.object({
  confidence: z.number().min(0).max(1).optional(),
  missingFields: z.array(z.string().min(1)).optional(),
  clarificationQuestion: z.string().optional(),
});

export const ParsedCommandSchema = z.discriminatedUnion("tool", [
  ParsedCommandMetadataSchema.extend({
    tool: z.literal("create_event"),
    arguments: CreateEventArgsSchema,
  }),
  ParsedCommandMetadataSchema.extend({
    tool: z.literal("query_events"),
    arguments: QueryEventsArgsSchema,
  }),
  ParsedCommandMetadataSchema.extend({
    tool: z.literal("delete_event"),
    arguments: DeleteEventArgsSchema,
  }),
  ParsedCommandMetadataSchema.extend({
    tool: z.literal("unknown"),
    arguments: z.unknown(),
  }),
]);

export type CalendarEventSource = z.infer<typeof CalendarEventSourceSchema>;
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type CommandInputSource = z.infer<typeof CommandInputSourceSchema>;
export type CommandInput = z.infer<typeof CommandInputSchema>;
export type CreateEventArgs = z.infer<typeof CreateEventArgsSchema>;
export type QueryEventsArgs = z.infer<typeof QueryEventsArgsSchema>;
export type DeleteEventArgs = z.infer<typeof DeleteEventArgsSchema>;
export type CommandToolName = z.infer<typeof CommandToolNameSchema>;
export type ParsedCommand = z.infer<typeof ParsedCommandSchema>;
