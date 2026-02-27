export type EventTypeId = "meeting" | "focus" | "personal" | "travel" | "other";

export interface EventType {
  id: EventTypeId;
  label: string;
  color: string;
  googleColorId: string;
}

export const EVENT_TYPES: EventType[] = [
  { id: "meeting", label: "Meeting", color: "#4f8cff", googleColorId: "9" },
  { id: "focus", label: "Focus", color: "#21b6a8", googleColorId: "10" },
  { id: "personal", label: "Personal", color: "#f59e0b", googleColorId: "6" },
  { id: "travel", label: "Travel", color: "#ec4899", googleColorId: "11" },
  { id: "other", label: "Other", color: "#9ca3af", googleColorId: "8" }
];

export const EVENT_TYPE_BY_ID = Object.fromEntries(EVENT_TYPES.map((item) => [item.id, item])) as Record<
  EventTypeId,
  EventType
>;

export interface CalendarSummary {
  id: string;
  summary: string;
  description?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  primary?: boolean;
  accessRole?: string;
}

export interface GoogleReminder {
  method: "email" | "popup";
  minutes: number;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: string[];
  recurrence: string[];
  reminders: {
    useDefault: boolean;
    overrides: GoogleReminder[];
  };
  eventType: EventTypeId;
  color: string;
  colorId: string;
}

export interface GoogleEventPayload {
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: string[];
  recurrence: string[];
  reminders: {
    useDefault: boolean;
    overrides: GoogleReminder[];
  };
  eventType: EventTypeId;
  colorId: string;
  timeZone: string;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  isUnread: boolean;
}

export interface GmailMessageDetail extends GmailMessageSummary {
  to: string;
  body: string;
}
