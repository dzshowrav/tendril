export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: number;
}

/**
 * Non-blocking Input Queue.
 * Allows user to type subsequent prompts while the agent is running,
 * and edit/reorder/delete queued items before dispatch.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 9).
 */
export class InputQueue {
  private queue: QueuedMessage[] = [];

  public enqueue(text: string): QueuedMessage {
    const msg: QueuedMessage = {
      id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: text.trim(),
      createdAt: Date.now(),
    };
    this.queue.push(msg);
    return msg;
  }

  public dequeue(): QueuedMessage | undefined {
    return this.queue.shift();
  }

  public peek(): QueuedMessage | undefined {
    return this.queue[0];
  }

  public getAll(): QueuedMessage[] {
    return [...this.queue];
  }

  public size(): number {
    return this.queue.length;
  }

  public isEmpty(): boolean {
    return this.queue.length === 0;
  }

  public updateMessage(id: string, newText: string): boolean {
    const item = this.queue.find((m) => m.id === id);
    if (item) {
      item.text = newText.trim();
      return true;
    }
    return false;
  }

  public remove(id: string): boolean {
    const idx = this.queue.findIndex((m) => m.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  public clear(): void {
    this.queue = [];
  }
}
