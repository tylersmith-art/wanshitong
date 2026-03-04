import * as Calendar from "expo-calendar";
import { Platform } from "react-native";

export async function getCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === "granted";
}

export async function getOrCreateAppCalendar(): Promise<string> {
  const calendars = await Calendar.getCalendarsAsync(
    Calendar.EntityTypes.EVENT
  );
  const existing = calendars.find((c) => c.title === "Template App");
  if (existing) return existing.id;

  const defaultCalendarSource =
    Platform.OS === "ios"
      ? calendars.find((c) => c.source?.name === "iCloud")?.source
      : ({
          isLocalAccount: true,
          name: "Template App",
          type: Calendar.CalendarType.LOCAL as string,
        } as Calendar.Source);

  const calendarId = await Calendar.createCalendarAsync({
    title: "Template App",
    color: "#4f46e5",
    entityType: Calendar.EntityTypes.EVENT,
    source: defaultCalendarSource!,
    name: "template-app",
    ownerAccount: "Template App",
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });

  return calendarId;
}

export async function createEvent(
  title: string,
  startDate: Date,
  endDate: Date
): Promise<string> {
  const calendarId = await getOrCreateAppCalendar();
  return Calendar.createEventAsync(calendarId, {
    title,
    startDate,
    endDate,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
