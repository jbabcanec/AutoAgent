import type { ActionClass, ModelRequest, ProviderDescriptor, RunCreateRequest, ToolInvocation } from "./contracts.js";

const ACTION_CLASSES: ActionClass[] = ["read", "write", "exec", "external", "deploy"];

export function validateProviderDescriptor(provider: ProviderDescriptor): string[] {
  const errors: string[] = [];
  if (!provider.id.trim()) errors.push("provider.id is required");
  if (!provider.displayName.trim()) errors.push("provider.displayName is required");
  if (!provider.baseUrl.startsWith("http")) errors.push("provider.baseUrl must start with http");
  return errors;
}

export function validateModelRequest(request: ModelRequest): string[] {
  const errors: string[] = [];
  if (!request.providerId.trim()) errors.push("providerId is required");
  if (!request.model.trim()) errors.push("model is required");
  if (request.messages.length === 0) errors.push("messages cannot be empty");
  return errors;
}

export function validateToolInvocation(invocation: ToolInvocation): string[] {
  const errors: string[] = [];
  if (!invocation.toolName.trim()) errors.push("toolName is required");
  if (!ACTION_CLASSES.includes(invocation.actionClass)) errors.push("actionClass is invalid");
  return errors;
}

export function validateRunCreateRequest(request: RunCreateRequest): string[] {
  const errors: string[] = [];
  if (!request.projectId.trim()) errors.push("projectId is required");
  if (!request.actorId.trim()) errors.push("actorId is required");
  if (!request.objective.trim()) errors.push("objective is required");
  if (request.selectedDirectories.length === 0) errors.push("at least one selected directory is required");
  errors.push(...validateProviderDescriptor(request.provider));
  return errors;
}
