export class ProcessedEventStore {
  private readonly processed = new Set<string>();

  has(eventId: string): boolean {
    return this.processed.has(eventId);
  }

  add(eventId: string): void {
    this.processed.add(eventId);
  }

  reset(): void {
    this.processed.clear();
  }
}
