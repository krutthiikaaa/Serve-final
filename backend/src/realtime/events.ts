/**
 * Realtime contract between services and the Socket.IO layer.
 *
 * Services never talk to Socket.IO directly. They collect RealtimeEvents while
 * performing a database transaction and publish them only AFTER the
 * transaction commits, so clients never observe uncommitted state.
 */

export type Room =
  | `student:${string}`
  | `staff:${string}`
  | `canteen:${string}`
  | `canteen-public:${string}`
  | `admin:${string}`
  | 'admin';

export const rooms = {
  student: (id: string): Room => `student:${id}`,
  staff: (id: string): Room => `staff:${id}`,
  /** Operational room for approved staff of a canteen (orders, menu). */
  canteen: (id: string): Room => `canteen:${id}`,
  /** Read-only room for anyone browsing a canteen (menu + status only, never orders). */
  canteenPublic: (id: string): Room => `canteen-public:${id}`,
  adminUser: (id: string): Room => `admin:${id}`,
  admins: (): Room => 'admin',
};

export type RealtimeEventName =
  | 'order:created'
  | 'order:status_updated'
  | 'order:cancelled'
  | 'menu:item_updated'
  | 'menu:availability_updated'
  | 'menu:price_updated'
  | 'menu:category_updated'
  | 'canteen:order_taking_updated'
  | 'change_request:created'
  | 'change_request:updated'
  | 'staff:approved'
  | 'staff:rejected'
  | 'staff:canteen_assignment_updated'
  | 'staff:deactivated'
  | 'notification:created';

export interface RealtimeEvent {
  name: RealtimeEventName;
  rooms: Room[];
  payload: Record<string, unknown>;
}

/** Server-side room membership changes that must follow a committed change. */
export type RoomCommand =
  | { type: 'staff-canteen-changed'; staffId: string; canteenId: string | null }
  | { type: 'disconnect-staff'; staffId: string };

export interface EventPublisher {
  publish(events: RealtimeEvent[]): void;
  apply(commands: RoomCommand[]): void;
}

/** Used where realtime is not wired (scripts, some unit tests). */
export const noopPublisher: EventPublisher = {
  publish: () => undefined,
  apply: () => undefined,
};

/** Accumulates side effects during a transaction; flushed after commit. */
export class Outbox {
  readonly events: RealtimeEvent[] = [];
  readonly commands: RoomCommand[] = [];

  emit(name: RealtimeEventName, targetRooms: Room[], payload: Record<string, unknown>): void {
    this.events.push({ name, rooms: [...new Set(targetRooms)], payload });
  }

  command(command: RoomCommand): void {
    this.commands.push(command);
  }

  flush(publisher: EventPublisher): void {
    publisher.apply(this.commands);
    publisher.publish(this.events);
  }
}
