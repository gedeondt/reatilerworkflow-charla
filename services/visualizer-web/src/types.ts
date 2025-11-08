export type TraceView = {
  traceId: string;
  lastUpdatedAt: string;
  domains: {
    [domainName: string]: {
      events: {
        eventName: string;
        occurredAt: string;
      }[];
    };
  };
};
