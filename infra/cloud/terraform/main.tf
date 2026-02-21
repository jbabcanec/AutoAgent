terraform {
  required_version = ">= 1.6.0"
}

variable "project_id" {
  type        = string
  description = "Cloud project identifier."
}

variable "region" {
  type        = string
  description = "Deployment region."
  default     = "us-central1"
}

output "notes" {
  value = "Provision a managed Kubernetes cluster and apply manifests in infra/cloud/k8s."
}
