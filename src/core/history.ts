/**
 * Holds the current value of something plus undo and redo stacks.
 * Values are treated as immutable: every change is a new object, which
 * is what makes undo a matter of keeping the old references around.
 */
export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private gestureStart: T | null = null;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(private value: T) {}

  get current(): T {
    return this.value;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Applies a change as one undoable step. Setting the same value is a no-op. */
  set(next: T): void {
    if (next === this.value) return;
    this.undoStack.push(this.value);
    this.redoStack = [];
    this.value = next;
    this.emit();
  }

  /**
   * A gesture is a run of small changes, such as a drag, that should
   * undo as a single step. Call beginGesture, then preview any number
   * of times, then endGesture.
   */
  beginGesture(): void {
    this.gestureStart = this.value;
  }

  preview(next: T): void {
    if (next === this.value) return;
    this.value = next;
    this.emit();
  }

  endGesture(): void {
    const start = this.gestureStart;
    this.gestureStart = null;
    if (start === null || start === this.value) return;
    this.undoStack.push(start);
    this.redoStack = [];
    this.emit();
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (previous === undefined) return;
    this.redoStack.push(this.value);
    this.value = previous;
    this.emit();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.value);
    this.value = next;
    this.emit();
  }

  /** Calls `listener` after every change. Returns a function that unsubscribes. */
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.value);
  }
}
