import type { NotificationPort } from './notification.port'
import { InMemoryNotificationPort } from './notification.port'

/**
 * The notification port the daily job uses. In this stand-alone engine there
 * are no platform users to send to, so it is empty and the job does nothing
 * (and remembers nothing). When the engine is built into the KSS platform,
 * this one function is replaced by an adapter that lists the real users with
 * their roles and writes into the platform's own notifications.
 */
export function getNotificationPort(): NotificationPort {
  return new InMemoryNotificationPort([])
}
