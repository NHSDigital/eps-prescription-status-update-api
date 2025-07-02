// Dynamo TTL for entries
export const TTL_DELTA = 60 * 60 * 24 * 14 // Keep records for 2 weeks

// For making the notify requests
export const NOTIFY_REQUEST_MAX_ITEMS = 45000
export const NOTIFY_REQUEST_MAX_BYTES = 5 * 1024 * 1024 // 5 MB
export const DUMMY_NOTIFY_DELAY_MS = 150
