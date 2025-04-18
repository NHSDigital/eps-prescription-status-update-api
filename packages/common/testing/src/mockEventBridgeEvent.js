export const mockEventBridgeEvent = {
    id: "test-event-1234",
    version: "0",
    account: "123456789012",
    time: new Date().toISOString(),
    region: "eu-west-2",
    resources: [],
    source: "aws.events",
    "detail-type": "Scheduled Event",
    detail: "This is a test event payload"
}
