export class PendingMutationBusyError extends Error {
  constructor(operation, activeOperation) {
    super("Another queue operation is already running.");
    this.name = "PendingMutationBusyError";
    this.code = "pending_queue_busy";
    this.operation = operation;
    this.activeOperation = activeOperation || null;
  }
}

export class PendingMutationCoordinator {
  constructor() {
    this.active = null;
  }

  isBusy() {
    return Boolean(this.active);
  }

  status() {
    return this.active ? structuredClone(this.active) : null;
  }

  async run(operation, callback) {
    if (this.active) {
      throw new PendingMutationBusyError(operation, this.active.operation);
    }

    this.active = {
      operation,
      startedAt: new Date().toISOString(),
    };

    try {
      return await callback();
    } finally {
      this.active = null;
    }
  }
}

export function isPendingMutationBusy(error) {
  return error?.code === "pending_queue_busy";
}
