export interface HealthStatus {
  service: string;
  status: "ok";
  timestamp: string;
}

export function getControlPlaneHealth(): HealthStatus {
  return {
    service: "@autoagent/control-plane",
    status: "ok",
    timestamp: new Date().toISOString()
  };
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  reason: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
}

export class ApprovalQueue {
  private readonly requests = new Map<string, ApprovalRequest>();

  public enqueue(runId: string, reason: string): ApprovalRequest {
    const request: ApprovalRequest = {
      id: `${runId}:${Date.now()}`,
      runId,
      reason,
      requestedAt: new Date().toISOString(),
      status: "pending"
    };
    this.requests.set(request.id, request);
    return request;
  }

  public resolve(requestId: string, approved: boolean): ApprovalRequest | undefined {
    const existing = this.requests.get(requestId);
    if (!existing) return undefined;
    existing.status = approved ? "approved" : "rejected";
    return existing;
  }
}
